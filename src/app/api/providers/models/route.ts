import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId, setDefaultProviderId, getProvider, getModelsForProvider, getSetting } from '@/lib/db';
import { getContextWindow } from '@/lib/model-context';
import { getDefaultModelsForProvider, getEffectiveProviderProtocol, findPresetForLegacy } from '@/lib/provider-catalog';
import type { Protocol } from '@/lib/provider-catalog';
import type { ErrorResponse, ProviderModelGroup } from '@/types';
import { getOAuthStatus } from '@/lib/openai-oauth-manager';
import { readCCSwitchClaudeSettings } from '@/lib/cc-switch';

// OpenAI models available through ChatGPT Plus/Pro OAuth (Codex API)
// Reasoning effort defaults to 'medium' server-side (not user-configurable)
const OPENAI_OAUTH_MODELS = [
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
  contextWindow?: number;
  capabilities?: Record<string, unknown>;
  variants?: Record<string, unknown>;
}

function normalizeContextWindow(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getModelContextWindow(entry: ModelEntry): number | undefined {
  return normalizeContextWindow(entry.contextWindow)
    ?? normalizeContextWindow(entry.capabilities?.contextWindow)
    ?? getContextWindow(entry.value, { upstream: entry.upstreamModelId })
    ?? undefined;
}

function isCCSwitchProvider(provider: ReturnType<typeof getAllProviders>[number]): boolean {
  if (provider.provider_type === 'cc-switch') return true;
  const normalizedName = (provider.name || '').trim().toLowerCase();
  return normalizedName === 'cc switch' || normalizedName === 'cc-switch';
}

function hydrateCCSwitchProviderForModels(provider: ReturnType<typeof getAllProviders>[number]) {
  if (!isCCSwitchProvider(provider)) return provider;

  const resolved = readCCSwitchClaudeSettings();
  if (!resolved) return provider;

  const parseObj = (json: string | undefined | null): Record<string, string> => {
    if (!json) return {};
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, string>;
      }
    } catch {
      // Ignore invalid JSON and keep existing values.
    }
    return {};
  };

  const roleModels = parseObj(provider.role_models_json);
  const liveRoles: Record<string, string> = {};
  if (typeof resolved.roleModels.default === 'string' && resolved.roleModels.default.trim()) {
    liveRoles.default = resolved.roleModels.default.trim();
  } else if (typeof resolved.currentModel === 'string' && resolved.currentModel.trim()) {
    liveRoles.default = resolved.currentModel.trim();
  }
  if (typeof resolved.roleModels.sonnet === 'string' && resolved.roleModels.sonnet.trim()) {
    liveRoles.sonnet = resolved.roleModels.sonnet.trim();
  }
  if (typeof resolved.roleModels.opus === 'string' && resolved.roleModels.opus.trim()) {
    liveRoles.opus = resolved.roleModels.opus.trim();
  }
  if (typeof resolved.roleModels.haiku === 'string' && resolved.roleModels.haiku.trim()) {
    liveRoles.haiku = resolved.roleModels.haiku.trim();
  }

  const envOverrides = parseObj(provider.env_overrides_json || provider.extra_env);
  const liveModels = Array.isArray(resolved.models)
    ? resolved.models.map(v => v.trim()).filter(Boolean)
    : [];
  if (liveModels.length > 0) {
    envOverrides.model_names = liveModels.join(',');
  }

  // 中文注释：功能名称「CC Switch 模型列表实时同步」，用法是在读取 providers/models 时优先使用 ~/.claude/settings.json 的当前模型配置。
  return {
    ...provider,
    base_url: resolved.baseUrl,
    api_key: resolved.apiKey,
    role_models_json: JSON.stringify({ ...roleModels, ...liveRoles }),
    env_overrides_json: JSON.stringify(envOverrides),
  };
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

/** Media-only provider protocols — skip in chat model selector unless explicitly requested */
const MEDIA_PROTOCOLS = new Set<string>(['gemini-image']);
const MEDIA_PROVIDER_TYPES = new Set(['gemini-image', 'generic-image']);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const includeMedia = searchParams.get('includeMedia') === 'true';

    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];

    // Show the built-in Claude Code provider group unless user explicitly chose AI SDK only.
    // Auto and Claude Code modes both need Claude Code models visible.
    const runtimeSetting = getSetting('agent_runtime') || 'auto';
    const cliEnabled = runtimeSetting !== 'native';

    if (cliEnabled && !includeMedia) {
      // Mark as sdkProxyOnly if no direct API credentials exist — in that case
      // the env provider only works through the Claude Code SDK subprocess.
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
          const cw = getModelContextWindow(m);
          return cw != null ? { ...m, contextWindow: cw } : m;
        }),
      });
    }

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
            const cw = getModelContextWindow({ value: m.value, label: m.displayName, upstreamModelId: upstream });
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

    // Build a group for each configured provider
    for (const providerRaw of providers) {
      const provider = hydrateCCSwitchProviderForModels(providerRaw);
      // Determine protocol — use new field if present, otherwise infer from legacy
      const protocol: Protocol = getEffectiveProviderProtocol(
        provider.provider_type,
        provider.protocol,
        provider.base_url,
      );

      // Skip media-only providers in chat model selector unless explicitly requested
      if (!includeMedia && (MEDIA_PROTOCOLS.has(protocol) || MEDIA_PROVIDER_TYPES.has(provider.provider_type))) continue;

      // When includeMedia is true, only include media providers
      if (includeMedia && !MEDIA_PROTOCOLS.has(protocol) && !MEDIA_PROVIDER_TYPES.has(provider.provider_type)) continue;

      // Get models: DB provider_models first, then catalog defaults, then env fallback
      let rawModels: ModelEntry[];

      // 1) Check DB provider_models table
      let dbModels: ModelEntry[] = [];
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
      // Prefer preset-matched defaults (can be intentionally empty, e.g. cc-switch/custom providers).
      const matchedPreset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
      const catalogModels = matchedPreset
        ? matchedPreset.defaultModels
        : getDefaultModelsForProvider(protocol, provider.base_url, provider.provider_type);
      const catalogRaw = catalogModels.map(m => ({
        value: m.modelId,
        label: m.displayName,
        upstreamModelId: m.upstreamModelId,
        capabilities: m.capabilities as Record<string, unknown> | undefined,
      }));

      // Start with DB models + catalog defaults.
      if (dbModels.length > 0) {
        const dbIds = new Set(dbModels.map(m => m.value));
        rawModels = [...dbModels, ...catalogRaw.filter(m => !dbIds.has(m.value))];
      } else {
        rawModels = [...catalogRaw];
      }

      // Inject models from role_models_json into the list if not already present
      try {
        const rm = JSON.parse(provider.role_models_json || '{}');
        const roleEntries: { id: string; role: string }[] = [];
        for (const role of ['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus'] as const) {
          if (rm[role] && !roleEntries.some(e => e.id === rm[role])) {
            roleEntries.push({ id: rm[role], role });
          }
        }
        for (const entry of roleEntries) {
          if (!rawModels.some(m => m.value === entry.id || m.upstreamModelId === entry.id)) {
            const label = entry.role === 'default' ? entry.id : `${entry.id} (${entry.role})`;
            rawModels.unshift({ value: entry.id, label });
          }
        }
      } catch { /* ignore */ }

      // Legacy: inject ANTHROPIC_MODEL from env overrides if not already present
      try {
        const envOverrides = provider.env_overrides_json || provider.extra_env || '{}';
        const envObj = JSON.parse(envOverrides);
        if (envObj.ANTHROPIC_MODEL && !rawModels.some(m => m.value === envObj.ANTHROPIC_MODEL || m.upstreamModelId === envObj.ANTHROPIC_MODEL)) {
          rawModels.unshift({ value: envObj.ANTHROPIC_MODEL, label: envObj.ANTHROPIC_MODEL });
        }
      } catch { /* ignore */ }

      const models = deduplicateModels(rawModels).map(m => {
        // Pass upstream so alias windows resolve per provider:
        // first-party opus → 1M (Opus 4.7) vs Bedrock/Vertex opus → 200K
        // (Opus 4.6). The model API is per-provider, so the correct
        // upstream is whatever catalog declared for this provider group.
        const cw = getModelContextWindow(m);
        // Lift effort/thinking capability flags from nested `capabilities` to top-level
        // so MessageInput / EffortSelectorDropdown can read them without unwrapping.
        const caps = (m.capabilities || {}) as Record<string, unknown>;
        const effortLift = {
          ...(caps.supportsEffort != null ? { supportsEffort: caps.supportsEffort as boolean } : {}),
          ...(caps.supportedEffortLevels != null ? { supportedEffortLevels: caps.supportedEffortLevels as string[] } : {}),
          ...(caps.supportsAdaptiveThinking != null ? { supportsAdaptiveThinking: caps.supportsAdaptiveThinking as boolean } : {}),
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

    // Add OpenAI OAuth virtual provider when authenticated
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
    }

    // Determine default provider — auto-heal stale references on read
    let defaultProviderId = getDefaultProviderId();
    if (defaultProviderId && !getProvider(defaultProviderId)) {
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
