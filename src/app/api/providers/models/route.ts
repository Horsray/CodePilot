import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId, setDefaultProviderId, getProvider, getModelsForProvider, getSetting } from '@/lib/db';
import { getContextWindow } from '@/lib/model-context';
import { getDefaultModelsForProvider, inferProtocolFromLegacy, findPresetForLegacy } from '@/lib/provider-catalog';
import { readCCSwitchClaudeSettings } from '@/lib/cc-switch';
import type { Protocol } from '@/lib/provider-catalog';
import type { ErrorResponse, ProviderModelGroup } from '@/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Default Claude model options (for the built-in 'env' provider)
const DEFAULT_MODELS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// CC-Switch model mapping
interface CCSwitchMapping {
  sonnet?: string;
  opus?: string;
  haiku?: string;
  default?: string;
}

function getCCSwitchModelMapping(): CCSwitchMapping | null {
  if (getSetting('cc_switch_enabled') !== 'true') return null;
  const settings = readCCSwitchClaudeSettings();
  if (!settings) return null;
  
  // Read the raw settings.json to get the actual model names
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const rawSettings = JSON.parse(content);
    const env = rawSettings.env || {};
    
    return {
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      default: env.ANTHROPIC_MODEL,
    };
  } catch {
    return null;
  }
}

interface ModelEntry {
  value: string;
  label: string;
  upstreamModelId?: string;
  capabilities?: Record<string, unknown>;
  variants?: Record<string, unknown>;
}

/**
 * Deduplicate models: if multiple aliases map to the same label, keep only the first one.
 */
function deduplicateModels(models: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const result: ModelEntry[] = [];
  for (const m of models) {
    if (!seen.has(m.label)) {
      seen.add(m.label);
      result.push(m);
    }
  }
  return result;
}

/** Media-only provider protocols — skip in chat model selector */
const MEDIA_PROTOCOLS = new Set<string>(['gemini-image']);
const MEDIA_PROVIDER_TYPES = new Set(['gemini-image']);

export async function GET() {
  try {
    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];

    // Always show the built-in Claude Code provider group.
    // Mark it as sdkProxyOnly if no direct API credentials exist — in that case
    // the env provider only works through the Claude Code SDK subprocess, not the
    // Vercel AI SDK text generation path used by features like AI Describe.
    const envHasDirectCredentials = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      getSetting('anthropic_auth_token')
    );
    
    // Get cc-switch model mapping
    const ccSwitchMapping = getCCSwitchModelMapping();
    
    groups.push({
      provider_id: 'env',
      provider_name: 'Claude Code',
      provider_type: 'anthropic',
      ...(!envHasDirectCredentials ? { sdkProxyOnly: true } : {}),
      models: DEFAULT_MODELS.map(m => {
        const cw = getContextWindow(m.value);
        // Add cc-switch mapping info to label if available
        let label = m.label;
        if (ccSwitchMapping) {
          const mappedModel = ccSwitchMapping[m.value as keyof CCSwitchMapping];
          if (mappedModel) {
            label = `${m.label} → ${mappedModel}`;
          }
        }
        const result: ModelEntry = { ...m, label };
        if (cw != null) {
          (result as ModelEntry & { contextWindow: number }).contextWindow = cw;
        }
        return result;
      }),
    });

    // If SDK has discovered models, only use the mapped models from cc-switch
    // Skip SDK models to avoid duplicates and confusion
    try {
      const { getCachedModels } = await import('@/lib/agent-sdk-capabilities');
      const sdkModels = getCachedModels('env');
      if (sdkModels.length > 0) {
        // Create a map of SDK models by value for quick lookup
        const sdkModelMap = new Map(sdkModels.map(m => [m.value, m]));
        
        // Only show DEFAULT_MODELS with cc-switch mapping, skip all SDK-only models
        groups[0].models = DEFAULT_MODELS.map(m => {
          const cw = getContextWindow(m.value);
          const sdkModel = sdkModelMap.get(m.value);
          
          // Add cc-switch mapping info to label if available
          let label = m.label;
          if (ccSwitchMapping) {
            const mappedModel = ccSwitchMapping[m.value as keyof CCSwitchMapping];
            if (mappedModel) {
              // Shorten the model name for display
              const shortName = mappedModel.length > 25 ? mappedModel.slice(0, 22) + '...' : mappedModel;
              label = `${m.label} → ${shortName}`;
            }
          }
          
          const result: ModelEntry = {
            value: m.value,
            label,
            ...(sdkModel ? {
              supportsEffort: sdkModel.supportsEffort,
              supportedEffortLevels: sdkModel.supportedEffortLevels,
              supportsAdaptiveThinking: sdkModel.supportsAdaptiveThinking,
            } : {}),
            ...(cw != null ? { contextWindow: cw } : {}),
          };
          return result;
        });
      }
    } catch {
      // SDK capabilities not available, keep defaults
    }

    // Build a group for each configured provider
    for (const provider of providers) {
      // Determine protocol — use new field if present, otherwise infer from legacy
      const protocol: Protocol = (provider.protocol as Protocol) ||
        inferProtocolFromLegacy(provider.provider_type, provider.base_url);

      // Skip media-only providers in chat model selector
      if (MEDIA_PROTOCOLS.has(protocol) || MEDIA_PROVIDER_TYPES.has(provider.provider_type)) continue;

      // Get models: DB provider_models first, then catalog defaults, then env fallback
      let rawModels: ModelEntry[];

      // 1) Check DB provider_models table
      let dbModels: { value: string; label: string; upstreamModelId?: string; capabilities?: Record<string, unknown> }[] = [];
      try {
        const provModels = getModelsForProvider(provider.id);
        if (provModels.length > 0) {
          dbModels = provModels.map(m => {
            let caps: Record<string, unknown> | undefined;
            let vars: Record<string, unknown> | undefined;
            try { const p = JSON.parse(m.capabilities_json || '{}'); if (Object.keys(p).length > 0) caps = p; } catch { /* ignore */ }
            try { const v = JSON.parse(m.variants_json || '{}'); if (Object.keys(v).length > 0) vars = v; } catch { /* ignore */ }
            return {
              value: m.model_id,
              label: m.display_name || m.model_id,
              upstreamModelId: m.upstream_model_id || undefined,
              capabilities: caps,
              variants: vars,
            };
          });
        }
      } catch { /* table may not exist in old DBs */ }

      // 2) Catalog defaults
      const catalogModels = getDefaultModelsForProvider(protocol, provider.base_url);
      const catalogRaw = catalogModels.map(m => ({
        value: m.modelId,
        label: m.displayName,
        upstreamModelId: m.upstreamModelId,
        capabilities: m.capabilities as Record<string, unknown> | undefined,
      }));

      // Start with DB models + catalog defaults.
      // If both are empty (e.g. Volcengine where user must specify model names),
      // leave rawModels empty — do NOT fall back to DEFAULT_MODELS (Sonnet/Opus/Haiku).
      if (dbModels.length > 0) {
        const dbIds = new Set(dbModels.map(m => m.value));
        rawModels = [...dbModels, ...catalogRaw.filter(m => !dbIds.has(m.value))];
      } else {
        rawModels = [...catalogRaw];
      }

      // Inject models from role_models_json into the list if not already present
      // (e.g. user configured "ark-code-latest" for a Volcengine or anthropic-thirdparty provider)
      try {
        const rm = JSON.parse(provider.role_models_json || '{}');
        // Collect unique model IDs from all role fields (default, reasoning, small, haiku, sonnet, opus)
        const roleEntries: { id: string; role: string }[] = [];
        for (const role of ['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus'] as const) {
          if (rm[role] && !roleEntries.some(e => e.id === rm[role])) {
            roleEntries.push({ id: rm[role], role });
          }
        }
        // Add each role model to the list (default role first, so it appears at the top)
        for (const entry of roleEntries) {
          if (!rawModels.some(m => m.value === entry.id || m.upstreamModelId === entry.id)) {
            const label = entry.role === 'default' ? entry.id : `${entry.id} (${entry.role})`;
            rawModels.unshift({ value: entry.id, label });
          }
        }
      } catch { /* ignore */ }

      // Legacy: inject ANTHROPIC_MODEL from env overrides if not already present
      // Also check upstreamModelId to avoid duplicates (e.g. catalog has modelId='sonnet'
      // with upstreamModelId='mimo-v2-pro', and env has ANTHROPIC_MODEL='mimo-v2-pro')
      try {
        const envOverrides = provider.env_overrides_json || provider.extra_env || '{}';
        const envObj = JSON.parse(envOverrides);
        if (envObj.ANTHROPIC_MODEL && !rawModels.some(m => m.value === envObj.ANTHROPIC_MODEL || m.upstreamModelId === envObj.ANTHROPIC_MODEL)) {
          rawModels.unshift({ value: envObj.ANTHROPIC_MODEL, label: envObj.ANTHROPIC_MODEL });
        }
      } catch { /* ignore */ }

      const models = deduplicateModels(rawModels).map(m => {
        const cw = getContextWindow(m.value);
        return {
          ...m,
          ...(cw != null ? { contextWindow: cw } : {}),
        };
      });

      // Detect SDK-proxy-only providers via preset match
      const preset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
      const sdkProxyOnly = preset?.sdkProxyOnly === true;

      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        ...(sdkProxyOnly ? { sdkProxyOnly: true } : {}),
        models,
      });
    }

    // Determine default provider — auto-heal stale references on read
    let defaultProviderId = getDefaultProviderId();
    if (defaultProviderId && !getProvider(defaultProviderId)) {
      // Stale default (provider was deleted). Fix it now.
      const firstValid = groups.find(g => g.provider_id !== 'env');
      defaultProviderId = firstValid?.provider_id || '';
      setDefaultProviderId(defaultProviderId);
    }
    defaultProviderId = defaultProviderId || groups[0]?.provider_id || '';

    return NextResponse.json({
      groups,
      default_provider_id: defaultProviderId,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 }
    );
  }
}
