import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId, setDefaultProviderId, getProvider, getModelsForProvider, getSetting } from '@/lib/db';
import { getContextWindow } from '@/lib/model-context';
import { getDefaultModelsForProvider, getEffectiveProviderProtocol, findPresetForLegacy } from '@/lib/provider-catalog';
import type { Protocol } from '@/lib/provider-catalog';
import type { ErrorResponse, ProviderModelGroup } from '@/types';
import { getOAuthStatus } from '@/lib/openai-oauth-manager';

// OpenAI models available through ChatGPT Plus/Pro OAuth (Codex API)
// Reasoning effort defaults to 'medium' server-side (not user-configurable)
const OPENAI_OAUTH_MODELS = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
];

// Default Claude model options (for the built-in 'env' provider).
// Capability metadata ensures `xhigh` appears in the effort dropdown even
// before SDK capability discovery populates getCachedModels('env').
// upstreamModelId mirrors provider-resolver.ts's envModels table so the
// chat-page context indicator can resolve alias-specific windows
// (env Opus alias = claude-opus-4-7 = 1M, vs Bedrock/Vertex opus = 200K).
const DEFAULT_MODELS = [
  {
    value: 'sonnet',
    label: 'Sonnet 4.6',
    upstreamModelId: 'claude-sonnet-4-20250514',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'opus',
    label: 'Opus 4.7',
    upstreamModelId: 'claude-opus-4-7',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'haiku',
    label: 'Haiku 4.5',
    upstreamModelId: 'claude-haiku-4-5-20251001',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
];

// Short alias → upstream ID map for cached SDK models that may only
// return bare aliases (sonnet/opus/haiku). Mirrors the env provider's
// alias table in provider-resolver.ts.
const ENV_ALIAS_TO_UPSTREAM: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-7',
  haiku: 'claude-haiku-4-5-20251001',
};

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
const MEDIA_PROTOCOLS = new Set<string>(['gemini-image', 'openai-image']);
const MEDIA_PROVIDER_TYPES = new Set(['gemini-image', 'openai-image']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeMedia = searchParams.get('includeMedia') === 'true';

    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];

    // 中文注释：功能名称「Claude Code 模型组固定展示」，用法是在单一路径产品里
    // 始终返回内置 Claude Code 模型组，不再受历史 cli_enabled 设置或旧回退模式影响。
    // 当 includeMedia=true 时跳过 env 组（只返回媒体提供商）。
    if (!includeMedia) {
    const envHasDirectCredentials = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      getSetting('anthropic_auth_token')
    );
    groups.push({
      provider_id: 'env',
      provider_name: 'Claude Code',
      provider_type: 'anthropic',
      ...(!envHasDirectCredentials ? { sdkProxyOnly: true } : {}),
      // Use upstreamModelId for context-window lookup so the bare `opus`
      // alias doesn't get clamped to the 200K Bedrock/Vertex value.
      models: DEFAULT_MODELS.map(m => {
        const cw = getContextWindow(m.value, { upstream: m.upstreamModelId });
        return cw != null ? { ...m, contextWindow: cw } : m;
      }),
    });

    // If SDK has discovered models, use them for the env group
    const envGroup = groups.find(g => g.provider_id === 'env');
    if (envGroup) {
      try {
        const { getCachedModels } = await import('@/lib/agent-sdk-capabilities');
        const sdkModels = getCachedModels('env');
        if (sdkModels.length > 0) {
          envGroup.models = sdkModels.map(m => {
            // SDK sometimes returns short aliases (e.g. 'opus') — map to
            // the concrete upstream so context window and downstream
            // sanitizer checks agree with the env provider's resolver.
            const upstream = ENV_ALIAS_TO_UPSTREAM[m.value];
            const cw = getContextWindow(m.value, { upstream });
            return {
              value: m.value,
              label: m.displayName,
              description: m.description,
              supportsEffort: m.supportsEffort,
              supportedEffortLevels: m.supportedEffortLevels,
              supportsAdaptiveThinking: m.supportsAdaptiveThinking,
              ...(upstream ? { upstreamModelId: upstream } : {}),
              ...(cw != null ? { contextWindow: cw } : {}),
            };
          });
        }
      } catch {
        // SDK capabilities not available, keep defaults
      }
    }
    } // end if (!includeMedia)

    // Build a group for each configured provider
    for (const provider of providers) {
      // Determine protocol — use new field if present, otherwise infer from legacy
      const protocol: Protocol = getEffectiveProviderProtocol(
        provider.provider_type,
        provider.protocol,
        provider.base_url,
      );

      // Filter by provider category
      const isMediaProvider = MEDIA_PROTOCOLS.has(protocol) || MEDIA_PROVIDER_TYPES.has(provider.provider_type);
      if (includeMedia && !isMediaProvider) continue;   // media request → only media providers
      if (!includeMedia && isMediaProvider) continue;    // chat request → skip media providers

      // Get models: DB provider_models first, then catalog defaults, then env fallback
      let rawModels: ModelEntry[];

      // Check for _custom_models in env_overrides_json — if present, use ONLY
      // those models (user-configured custom-media providers). Skip catalog
      // defaults and role_models injection to avoid showing hardcoded models
      // that don't exist on the user's relay platform.
      let hasCustomModels = false;
      try {
        const envObj = JSON.parse(provider.env_overrides_json || '{}');
        const parsedCustom = typeof envObj._custom_models === 'string' ? JSON.parse(envObj._custom_models) : envObj._custom_models;
        if (Array.isArray(parsedCustom) && parsedCustom.length > 0) {
          rawModels = parsedCustom
            .filter((cm: { modelId?: string }) => cm.modelId)
            .map((cm: { modelId: string; displayName?: string }) => ({
              value: cm.modelId,
              label: cm.displayName || cm.modelId,
            }));
          hasCustomModels = true;
        } else {
          rawModels = [];
        }
      } catch {
        rawModels = [];
      }

      if (!hasCustomModels) {
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
      const catalogModels = getDefaultModelsForProvider(protocol, provider.base_url, provider.provider_type);
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
        const catalogById = new Map(catalogRaw.map(m => [m.value, m]));
        // Merge catalog capabilities into DB models — DB capabilities take
        // priority for existing keys, catalog fills in missing ones (e.g. a
        // newly added supportsThinkingToggle). Without this, provider
        // capabilities added to the catalog never reach the frontend when
        // the provider_models table already has rows.
        const enhancedDbModels = dbModels.map(m => {
          const cat = catalogById.get(m.value);
          if (!cat?.capabilities) return m;
          return { ...m, capabilities: { ...(cat.capabilities as Record<string, unknown>), ...(m.capabilities || {}) } };
        });
        rawModels = [...enhancedDbModels, ...catalogRaw.filter(m => !dbIds.has(m.value))];
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
          let label = entry.id;
          if (provider.protocol === 'multi_head') {
            // For multi_head, entry.id is like "providerId:modelId"
            // We want to show only the "modelId" part
            const parts = entry.id.split(':');
            label = parts.length > 1 ? parts.slice(1).join(':') : entry.id;
            label = entry.role === 'default' ? label : `${label} (${entry.role})`;
          } else {
            label = entry.role === 'default' ? entry.id : `${entry.id} (${entry.role})`;
          }
          rawModels.unshift({ value: entry.id, label });
        }
      }
      } catch { /* ignore */ }

      // Legacy: inject ANTHROPIC_MODEL from env overrides if not already present
      // Also check upstreamModelId to avoid duplicates (e.g. catalog has modelId='sonnet'
      // with upstreamModelId='mimo-v2.5-pro', and env has ANTHROPIC_MODEL='mimo-v2.5-pro')
      try {
        const envOverrides = provider.env_overrides_json || provider.extra_env || '{}';
        const envObj = JSON.parse(envOverrides);
        if (envObj.ANTHROPIC_MODEL && !rawModels.some(m => m.value === envObj.ANTHROPIC_MODEL || m.upstreamModelId === envObj.ANTHROPIC_MODEL)) {
          rawModels.unshift({ value: envObj.ANTHROPIC_MODEL, label: envObj.ANTHROPIC_MODEL });
        }
      } catch { /* ignore */ }
      } // end if (!hasCustomModels)

      const models = deduplicateModels(rawModels).map(m => {
        // Pass upstream so alias windows resolve per provider:
        // first-party opus → 1M (Opus 4.7) vs Bedrock/Vertex opus → 200K
        // (Opus 4.6). The model API is per-provider, so the correct
        // upstream is whatever catalog declared for this provider group.
        const cw = getContextWindow(m.value, { upstream: m.upstreamModelId });
        // Lift effort/thinking capability flags from nested `capabilities` to top-level
        // so MessageInput / EffortSelectorDropdown can read them without unwrapping.
        const caps = (m.capabilities || {}) as Record<string, unknown>;
        const effortLift = {
          ...(caps.supportsEffort != null ? { supportsEffort: caps.supportsEffort as boolean } : {}),
          ...(caps.supportedEffortLevels != null ? { supportedEffortLevels: caps.supportedEffortLevels as string[] } : {}),
          ...(caps.supportsAdaptiveThinking != null ? { supportsAdaptiveThinking: caps.supportsAdaptiveThinking as boolean } : {}),
          ...(caps.supportsThinkingToggle != null ? { supportsThinkingToggle: caps.supportsThinkingToggle as boolean } : {}),
        };
        return {
          ...m,
          ...effortLift,
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

    // Add OpenAI OAuth virtual provider when authenticated (chat only)
    if (!includeMedia) {
    try {
      const oauthStatus = getOAuthStatus();
      if (oauthStatus.authenticated) {
        groups.push({
          provider_id: 'openai-oauth',
          provider_name: `OpenAI${oauthStatus.plan ? ` (${oauthStatus.plan})` : ''}`,
          provider_type: 'openai-oauth',
          models: OPENAI_OAUTH_MODELS,
        });
      }
    } catch { /* OpenAI OAuth module not available */ }
    } // end if (!includeMedia)

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
