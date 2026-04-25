/**
 * Provider Resolver — unified provider/model resolution for all consumers.
 *
 * Every entry point (chat, bridge, onboarding, check-in, media plan) calls
 * this module instead of doing its own provider resolution. This guarantees
 * the same provider+model+protocol+env for the same inputs everywhere.
 */

import type { ApiProvider } from '@/types';
import {
  type Protocol,
  type AuthStyle,
  type CatalogModel,
  type RoleModels,
  inferProtocolFromLegacy,
  inferAuthStyleFromLegacy,
  getDefaultModelsForProvider,
  getEffectiveProviderProtocol,
  findPresetForLegacy,
} from './provider-catalog';
import {
  getProvider,
  getDefaultProviderId,
  getActiveProvider,
  getAllProviders,
  getSetting,
  getModelsForProvider,
  getProviderOptions,
} from './db';
import { ensureTokenFresh } from './openai-oauth-manager';
import { CODEX_API_ENDPOINT } from './openai-oauth';
import { hasClaudeSettingsCredentials, readClaudeSettingsEnv, readClaudeSettingsCredentials } from './claude-settings';

// ── Resolution result ───────────────────────────────────────────

export interface ResolvedProvider {
  /** The DB provider record (undefined = use env vars) */
  provider: ApiProvider | undefined;
  /** Wire protocol */
  protocol: Protocol;
  /** Auth style */
  authStyle: AuthStyle;
  /** Resolved model ID (internal/UI model ID) */
  model: string | undefined;
  /** Upstream model ID (what actually gets sent to the API — may differ from model) */
  upstreamModel: string | undefined;
  /** Display name for the model */
  modelDisplayName: string | undefined;
  /** Extra headers (parsed from headers_json or empty) */
  headers: Record<string, string>;
  /** Environment overrides (parsed from env_overrides_json / extra_env) */
  envOverrides: Record<string, string>;
  /** Role models mapping (parsed from role_models_json or inferred from catalog) */
  roleModels: RoleModels;
  /** Whether the provider has usable credentials */
  hasCredentials: boolean;
  /** Available models for this provider */
  availableModels: CatalogModel[];
  /** Settings sources for Claude Code SDK */
  settingSources: string[];
  /** Parent tier model — for multi_head, the target model for the parent's tier.
   *  Used by toClaudeCodeEnv() to set ANTHROPIC_MODEL correctly so SDK
   *  subprocesses and their sub-agents use the right model instead of the
   *  multi_head default. */
  parentTierModel?: string;
  /** Internal: true when resolved as OpenAI OAuth (Codex API) virtual provider */
  _openaiOAuth?: boolean;
  /** Internal: true when original provider was multi_head (preserved across recursive resolution) */
  _isMultiHead?: boolean;
}

// ── Public API ──────────────────────────────────────────────────

export interface ResolveOptions {
  /** Explicit provider ID from request (highest priority) */
  providerId?: string;
  /** Session's stored provider ID */
  sessionProviderId?: string;
  /** Requested model */
  model?: string;
  /** Session's stored model */
  sessionModel?: string;
  /** Use case — affects which role model to pick */
  useCase?: 'default' | 'reasoning' | 'small' | 'sonnet' | 'opus' | 'haiku';
}

/**
 * Resolve a provider + model for any consumer.
 *
 * Priority chain (same everywhere):
 * 1. Explicit providerId in request
 * 2. Session's provider_id
 * 3. Global default_provider_id
 * 4. Environment variables (resolvedProvider = undefined)
 *
 * Special value 'env' = use environment variables (skip DB lookup).
 */
export function resolveProvider(opts: ResolveOptions = {}): ResolvedProvider {
  const effectiveProviderId = opts.providerId || opts.sessionProviderId || '';

  let provider: ApiProvider | undefined;

  // Determine if the ID came from an explicit request (providerId) or
  // from the session — only explicit requests should skip the inactive check.
  const isExplicitRequest = !!opts.providerId;

  // Special virtual provider: OpenAI OAuth (Codex API)
  if (effectiveProviderId === 'openai-oauth') {
    return buildOpenAIOAuthResolution(opts);
  }

  if (effectiveProviderId && effectiveProviderId !== 'env') {
    // Look up the requested provider
    provider = getProvider(effectiveProviderId);

    // For non-explicit sources (session provider, fallback chain), skip
    // inactive providers — a stale session may point to a deactivated
    // provider (e.g. Google Gemini Image that was turned off).
    if (provider && !provider.is_active && !isExplicitRequest) {
      console.warn(`[provider-resolver] Provider "${provider.name}" (${effectiveProviderId}) is inactive, falling back`);
      provider = undefined;
    }

    if (!provider) {
      // Requested provider not found (or inactive session provider),
      // fall back to default → any active.
      //
      // NOTE: We intentionally do NOT check default_provider's is_active here.
      // is_active is a "currently selected" marker (see activateProvider in
      // db.ts — radio-button style, only one provider can have is_active=1),
      // NOT an enabled/disabled flag. A user setting default_provider_id is
      // an explicit choice that must be honored regardless of is_active.
      // Ignoring it here is the root cause of "Default provider X is inactive,
      // falling back" warnings that surface as "No provider credentials" for
      // users who set a default but never clicked Activate.
      const defaultId = getDefaultProviderId();
      if (defaultId && defaultId !== effectiveProviderId) {
        const defaultProvider = getProvider(defaultId);
        if (defaultProvider) provider = defaultProvider;
      }
      if (!provider) {
        provider = getActiveProvider();
      }
    }
  } else if (!effectiveProviderId) {
    // No provider specified — use global default.
    // See NOTE above: is_active is a UI selection marker, not an enable flag.
    // The user's default_provider_id is an explicit choice; honor it even if
    // the provider isn't currently the "active" one.
    const defaultId = getDefaultProviderId();
    if (defaultId) {
      const defaultProvider = getProvider(defaultId);
      if (defaultProvider) {
        provider = defaultProvider;
      }
    }
    // If no default configured, fall back to any provider that happens to be
    // marked active (backwards compat with pre-default_provider_id installs)
    if (!provider) {
      provider = getActiveProvider();
    }
  }
  // effectiveProviderId === 'env' → provider stays undefined

  return buildResolution(provider, opts);
}

/**
 * Resolve provider for the Claude Code SDK subprocess (used by claude-client.ts).
 * Uses the same resolution chain but also checks getActiveProvider() for backwards compat.
 *
 * Important: if resolveProvider() intentionally returned provider=undefined (e.g. user
 * selected 'env'), we respect that and do NOT fall back to getActiveProvider().
 *
 * NOTE: When the caller already resolved a provider upstream and hands it to
 * us, we trust it unconditionally. `is_active` is a radio-button "currently
 * selected" marker in the DB (see activateProvider in db.ts), not an
 * enable/disable flag — second-guessing the caller here would undo the
 * upstream resolution and surface false-positive "inactive, re-resolving"
 * warnings in doctor logs. Stale-session defense lives in resolveProvider()'s
 * session-provider branch, not here.
 */
export function resolveForClaudeCode(
  explicitProvider?: ApiProvider,
  opts: ResolveOptions = {},
): ResolvedProvider {
  if (explicitProvider) {
    return buildResolution(explicitProvider, opts);
  }
  const resolved = resolveProvider(opts);
  // Only fall back to getActiveProvider() when NO provider resolution was attempted
  // (i.e. no explicit ID, no session ID, no global default). If the resolver ran and
  // returned provider=undefined (env mode), respect that decision.
  if (!resolved.provider && !opts.providerId && !opts.sessionProviderId) {
    const defaultId = getDefaultProviderId();
    if (!defaultId) {
      // No default configured either — last resort backwards compat
      const active = getActiveProvider();
      if (active) return buildResolution(active, opts);
    }
  }
  return resolved;
}

// ── Claude Code env builder ─────────────────────────────────────

/**
 * Build environment variables for a Claude Code SDK subprocess.
 * Replaces the inline env-building logic in claude-client.ts.
 *
 * @param baseEnv - Process environment (usually { ...process.env })
 * @param resolved - Output from resolveProvider/resolveForClaudeCode
 * @returns Clean env suitable for the SDK subprocess
 */
export function toClaudeCodeEnv(
  baseEnv: Record<string, string>,
  resolved: ResolvedProvider,
): Record<string, string> {
  const env = { ...baseEnv };

  // Managed env vars that must be cleaned when switching providers to prevent leaks
  const MANAGED_ENV_KEYS = new Set([
    'API_TIMEOUT_MS',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
    'CLAUDE_CODE_SKIP_VERTEX_AUTH',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
    'CLAUDE_CODE_EFFORT_LEVEL',
    'ENABLE_TOOL_SEARCH',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'CLOUD_ML_REGION',
    'ANTHROPIC_PROJECT_ID',
    'GEMINI_API_KEY',
  ]);

  if (resolved.provider && resolved.hasCredentials) {
    // Clear all ANTHROPIC_* variables AND managed env vars to prevent cross-provider leaks
    for (const key of Object.keys(env)) {
      if (key.startsWith('ANTHROPIC_') || MANAGED_ENV_KEYS.has(key)) {
        delete env[key];
      }
    }

    // Inject auth based on style
    const apiKey = resolved.provider.api_key;
    if (apiKey) {
      switch (resolved.authStyle) {
        case 'auth_token':
          env.ANTHROPIC_AUTH_TOKEN = apiKey;
          env.ANTHROPIC_API_KEY = '';  // Explicitly empty — required by Ollama and other auth_token providers
          break;
        case 'api_key':
        default:
          // Only set ANTHROPIC_API_KEY (X-Api-Key header).
          // Do NOT set ANTHROPIC_AUTH_TOKEN — upstream Claude Code adds
          // Authorization: Bearer when it sees AUTH_TOKEN, which conflicts
          // with providers that expect API-key-only auth (e.g. Kimi).
          env.ANTHROPIC_API_KEY = apiKey;
          break;
      }
    }

    // Inject base URL
    if (resolved.provider.base_url) {
      env.ANTHROPIC_BASE_URL = resolved.provider.base_url;
    }

    // Inject role models as env vars
    // 多头路由的 roleModels 格式为 "providerId:modelId"，需要去掉 providerId 前缀
    // 只保留 modelId 部分，因为 Claude Code SDK 不认识 provider:model 格式
    // 统一转小写：API 端点通常要求小写模型 ID（如 mimo-v2.5-pro），大写会导致 400 错误
    const stripProviderPrefix = (v: string) => {
      const modelId = v.includes(':') ? v.split(':').slice(1).join(':') : v;
      return modelId.toLowerCase();
    };
    // 优先使用 roleModels.default（完整的上游模型 ID，如 "claude-sonnet-4-5"）
    // 其次使用 parentTierModel（多头路由目标模型，如 "MiMo-V2.5-Pro"）
    // 最后使用 upstreamModel（catalog 解析后的模型 ID）
    if (resolved.roleModels.default) {
      env.ANTHROPIC_MODEL = stripProviderPrefix(resolved.roleModels.default);
    } else if (resolved.parentTierModel) {
      env.ANTHROPIC_MODEL = resolved.parentTierModel.toLowerCase();
    } else if (resolved.upstreamModel) {
      env.ANTHROPIC_MODEL = resolved.upstreamModel;
    }
    if (resolved.roleModels.reasoning) {
      env.ANTHROPIC_REASONING_MODEL = stripProviderPrefix(resolved.roleModels.reasoning);
    } else if (resolved.roleModels.opus) {
      // Claude Code SDK uses ANTHROPIC_REASONING_MODEL for opus-equivalent agents (architect, planner, etc.)
      // Fallback to opus when reasoning is not explicitly configured
      env.ANTHROPIC_REASONING_MODEL = stripProviderPrefix(resolved.roleModels.opus);
    }
    if (resolved.roleModels.small) {
      env.ANTHROPIC_SMALL_FAST_MODEL = stripProviderPrefix(resolved.roleModels.small);
    }
    if (resolved.roleModels.haiku) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = stripProviderPrefix(resolved.roleModels.haiku);
      // Claude Code SDK uses ANTHROPIC_SMALL_FAST_MODEL for haiku-equivalent agents
      env.ANTHROPIC_SMALL_FAST_MODEL = stripProviderPrefix(resolved.roleModels.haiku);
    }
    if (resolved.roleModels.sonnet) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = stripProviderPrefix(resolved.roleModels.sonnet);
    }
    if (resolved.roleModels.opus) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = stripProviderPrefix(resolved.roleModels.opus);
    }

    // Inject extra headers
    for (const [k, v] of Object.entries(resolved.headers)) {
      if (v) env[k] = v;
    }

    // Inject env overrides (empty string = delete).
    // Skip auth-related keys — they were already correctly injected above based on authStyle.
    // Legacy extra_env often contains placeholder entries like {"ANTHROPIC_AUTH_TOKEN":""} or
    // {"ANTHROPIC_API_KEY":""} that would delete the freshly-injected credentials.
    const AUTH_ENV_KEYS = new Set([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
    ]);
    for (const [key, value] of Object.entries(resolved.envOverrides)) {
      if (AUTH_ENV_KEYS.has(key)) continue; // already handled by auth injection
      if (typeof value === 'string') {
        if (value === '') {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }
  } else if (!resolved.provider) {
    // No provider — preserve existing env, layer legacy DB settings, then
    // layer the Claude Code settings env allowlist. This keeps cc-switch auth
    // and model routing working even though the SDK fast path no longer
    // enables settingSources just to read ~/.claude/settings.json.
    const appToken = getSetting('anthropic_auth_token');
    const appBaseUrl = getSetting('anthropic_base_url');
    if (appToken) env.ANTHROPIC_AUTH_TOKEN = appToken;
    if (appBaseUrl) env.ANTHROPIC_BASE_URL = appBaseUrl;
    const claudeSettingsEnv = readClaudeSettingsEnv();
    if (claudeSettingsEnv) {
      for (const [key, value] of Object.entries(claudeSettingsEnv)) {
        if (value) env[key] = value;
      }
    }
  }

  // NOTE: We previously set CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1 here in an attempt
  // to tell the Agent SDK to strip ~/.claude/settings.json env overrides. That flag
  // does not exist in the current SDK (@anthropic-ai/claude-agent-sdk 0.2.62) — it
  // was either aspirational or came from an older SDK spec. Removing it avoids
  // shipping misleading dead code. The SDK already filters its own env blocklist
  // (model aliases, AWS/OTEL/Bedrock keys — see rG6 in cli.js), and when CodePilot
  // has an active provider, toClaudeCodeEnv() already deletes all ANTHROPIC_* keys
  // from baseEnv above before injecting the provider's values, so settings.json
  // env cannot override the provider's auth/baseUrl for authenticated users.
  // For env-mode (no active provider) users, we explicitly inject an allowlist
  // from settings.json above — that's how cc-switch integration works without
  // paying the first-turn cost of SDK settingSources.

  return env;
}

// ── AI SDK config builder ───────────────────────────────────────

export interface AiSdkConfig {
  /** Which AI SDK factory to use */
  sdkType: 'anthropic' | 'openai' | 'google' | 'bedrock' | 'vertex' | 'claude-code-compat';
  /** API key to pass to the SDK (mutually exclusive with authToken for Anthropic) */
  apiKey: string | undefined;
  /** Auth token (Bearer) for Anthropic auth_token providers (mutually exclusive with apiKey) */
  authToken: string | undefined;
  /** Base URL to pass to the SDK */
  baseUrl: string | undefined;
  /** The model ID to request (upstream/API model ID) */
  modelId: string;
  /** Extra headers to pass to the SDK client */
  headers: Record<string, string>;
  /** Extra env vars to inject into process.env before SDK call */
  processEnvInjections: Record<string, string>;
  /** Use OpenAI Responses API instead of Chat Completions (for Codex API) */
  useResponsesApi?: boolean;
}

/**
 * Build configuration for the Vercel AI SDK (used by text-generator.ts).
 * Replaces the inline provider-type branching in text-generator.ts.
 */
export function toAiSdkConfig(
  resolved: ResolvedProvider,
  modelOverride?: string,
): AiSdkConfig {
  // Resolve the upstream model ID (the actual API model name).
  // If modelOverride is given (from caller), check if it maps to a different upstream ID
  // in the provider's available models. This prevents callers from accidentally passing
  // the internal/UI model ID when the upstream API expects a different name.
  let modelId: string;
  if (modelOverride) {
    // 1. Try availableModels catalog (upstreamModelId)
    const catalogEntry = resolved.availableModels.find(m => m.modelId === modelOverride);
    modelId = catalogEntry?.upstreamModelId || modelOverride;

    // 2. If still a short alias, try roleModels (user-configured model mapping)
    const SHORT_ALIASES = new Set(['sonnet', 'opus', 'haiku']);
    if (SHORT_ALIASES.has(modelId)) {
      const roleMap: Record<string, string | undefined> = {
        sonnet: resolved.roleModels.sonnet,
        opus: resolved.roleModels.opus,
        haiku: resolved.roleModels.haiku,
      };
      const mapped = roleMap[modelId];
      if (mapped && !SHORT_ALIASES.has(mapped)) {
        modelId = mapped;
      }
    }

    // 3. Last resort for SINGLE-MODEL third-party providers: short alias →
    //    that single model. Third-party proxies (Kimi, GLM, OpenRouter relays,
    //    custom enterprise endpoints) usually do NOT accept bare "sonnet" /
    //    "opus" / "haiku" — they want fully-qualified model IDs. Sending the
    //    alias produces "model 'sonnet' not found" errors from the upstream
    //    (Sentry: HTTP 400/404/502 across multiple fingerprints, 310+ events
    //    over 14d).
    //
    //    IMPORTANT: We only fall back when the provider has EXACTLY ONE model
    //    in its catalog. Multi-model providers (e.g. OpenRouter with dozens
    //    of models) must NOT silently rewrite the user's chosen alias to
    //    "first model in list" — that's a hard-to-diagnose behavior change
    //    affecting both correctness and cost. For multi-model providers
    //    without a role mapping, we keep the alias and let upstream return
    //    its real "model not found" error so the user can see the problem
    //    and configure role_models_json properly.
    if (
      resolved.provider &&
      SHORT_ALIASES.has(modelId) &&
      resolved.availableModels.length === 1
    ) {
      const only = resolved.availableModels[0];
      const onlyUpstream = only.upstreamModelId || only.modelId;
      if (onlyUpstream && !SHORT_ALIASES.has(onlyUpstream)) {
        modelId = onlyUpstream;
      }
    }
  } else {
    modelId = resolved.upstreamModel || resolved.model || 'claude-sonnet-4-5-20250929';
  }
  const provider = resolved.provider;
  const protocol = resolved.protocol;
  const processEnvInjections: Record<string, string> = {};

  // For bedrock/vertex, inject env overrides into process.env
  if (protocol === 'bedrock' || protocol === 'vertex') {
    for (const [k, v] of Object.entries(resolved.envOverrides)) {
      if (typeof v === 'string' && v !== '') {
        processEnvInjections[k] = v;
      }
    }
  }

  const headers = resolved.headers;

  // OpenAI OAuth (Codex API) — special path using OAuth Bearer token.
  // The actual OAuth token is resolved in ai-provider.ts at model creation time
  // (via getOAuthCredentialsSync) because token refresh is async.
  if (resolved._openaiOAuth) {
    // Derive base URL: CODEX_API_ENDPOINT is the full /responses URL,
    // but @ai-sdk/openai appends /responses itself, so strip it.
    const codexBase = CODEX_API_ENDPOINT.replace(/\/responses\/?$/, '');
    return {
      sdkType: 'openai',
      apiKey: undefined,  // resolved at call time in ai-provider.ts
      authToken: undefined,
      baseUrl: codexBase,
      modelId,
      headers,
      processEnvInjections,
      useResponsesApi: true,
    };
  }

  // Resolve Anthropic auth credentials.
  // @ai-sdk/anthropic supports apiKey (x-api-key header) and authToken (Bearer header),
  // and they are mutually exclusive. We must pick the right one based on authStyle.
  const resolveAnthropicAuth = (): { apiKey: string | undefined; authToken: string | undefined } => {
    if (provider) {
      // Configured provider — use authStyle to decide
      if (resolved.authStyle === 'auth_token') {
        const token = provider.api_key || undefined;
        // 多头路由的目标 provider 可能没有自己的 api_key，fallback 到 settings.json / 环境变量
        if (!token) return resolveFallbackAuth();
        return { apiKey: undefined, authToken: token };
      }
      const key = provider.api_key || undefined;
      if (!key) return resolveFallbackAuth();
      return { apiKey: key, authToken: undefined };
    }
    return resolveFallbackAuth();
  };

  // Fallback auth: 环境变量 → ~/.claude/settings.json → legacy DB settings
  const resolveFallbackAuth = (): { apiKey: string | undefined; authToken: string | undefined } => {
    // ANTHROPIC_AUTH_TOKEN takes precedence (it's the Claude Code SDK auth path).
    const envAuthToken = process.env.ANTHROPIC_AUTH_TOKEN || getSetting('anthropic_auth_token');
    if (envAuthToken) {
      return { apiKey: undefined, authToken: envAuthToken };
    }
    const envApiKey = process.env.ANTHROPIC_API_KEY;
    if (envApiKey) {
      return { apiKey: envApiKey, authToken: undefined };
    }
    // 多头路由子Agent: 从 ~/.claude/settings.json 读取 cc-switch 管理的凭证
    const creds = readClaudeSettingsCredentials();
    if (creds?.authToken) return { apiKey: undefined, authToken: creds.authToken };
    if (creds?.apiKey) return { apiKey: creds.apiKey, authToken: undefined };
    return { apiKey: undefined, authToken: undefined };
  };

  // @ai-sdk/anthropic builds request URLs as `${baseURL}/messages`.
  // Its default is 'https://api.anthropic.com/v1', so if we pass
  // 'https://api.anthropic.com' (without /v1) the request goes to
  // /messages instead of /v1/messages and 404s.
  // Normalise here so callers don't need to know about the SDK's URL scheme.
  const normaliseAnthropicBaseUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    const cleaned = url.replace(/\/+$/, '');
    if (cleaned === 'https://api.anthropic.com') return 'https://api.anthropic.com/v1';
    return cleaned;
  };

  switch (protocol) {
    case 'anthropic': {
      const auth = resolveAnthropicAuth();
      const rawBaseUrl = provider?.base_url || process.env.ANTHROPIC_BASE_URL || getSetting('anthropic_base_url') || undefined;

      // Route third-party Anthropic proxies through ClaudeCodeCompatAdapter.
      // Only official api.anthropic.com uses @ai-sdk/anthropic directly.
      // All others go through the adapter because:
      // 1. sdkProxyOnly proxies (Zhipu, Kimi, etc.) require Claude Code wire format
      // 2. Unknown proxies are safer with the adapter (it's a superset of standard Messages API)
      // 3. @ai-sdk/anthropic has subtle incompatibilities with many proxies (URL handling, beta headers)
      let sdkType: AiSdkConfig['sdkType'] = 'anthropic';
      const effectiveBaseUrl = provider?.base_url || process.env.ANTHROPIC_BASE_URL;
      if (effectiveBaseUrl) {
        try {
          const hostname = new URL(effectiveBaseUrl).hostname;
          const isOfficial = hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com');
          if (!isOfficial) {
            sdkType = 'claude-code-compat';
          }
        } catch {
          sdkType = 'claude-code-compat'; // malformed URL → safer with adapter
        }
      }

      return {
        sdkType,
        ...auth,
        baseUrl: normaliseAnthropicBaseUrl(rawBaseUrl),
        modelId,
        headers,
        processEnvInjections,
      };
    }

    case 'openrouter':
      return {
        sdkType: 'openai',
        apiKey: provider?.api_key || undefined,
        authToken: undefined,
        baseUrl: provider?.base_url || 'https://openrouter.ai/api/v1',
        modelId,
        headers,
        processEnvInjections,
      };

    case 'openai-compatible':
      return {
        sdkType: 'openai',
        apiKey: provider?.api_key || undefined,
        authToken: undefined,
        baseUrl: provider?.base_url || undefined,
        modelId,
        headers,
        processEnvInjections,
      };

    case 'bedrock':
      // If base_url is set, route through OpenAI-compatible proxy; otherwise use native SDK
      if (provider?.base_url) {
        return {
          sdkType: 'openai',
          apiKey: provider.api_key || 'dummy',
          authToken: undefined,
          baseUrl: provider.base_url,
          modelId,
          headers,
          processEnvInjections,
        };
      }
      return {
        sdkType: 'bedrock',
        apiKey: undefined,
        authToken: undefined,
        baseUrl: undefined,
        modelId,
        headers,
        processEnvInjections,
      };

    case 'vertex':
      // If base_url is set, route through OpenAI-compatible proxy; otherwise use native SDK
      if (provider?.base_url) {
        return {
          sdkType: 'openai',
          apiKey: provider.api_key || 'dummy',
          authToken: undefined,
          baseUrl: provider.base_url,
          modelId,
          headers,
          processEnvInjections,
        };
      }
      return {
        sdkType: 'vertex',
        apiKey: undefined,
        authToken: undefined,
        baseUrl: undefined,
        modelId,
        headers,
        processEnvInjections,
      };

    case 'google':
    case 'gemini-image':
      return {
        sdkType: 'google',
        apiKey: provider?.api_key || undefined,
        authToken: undefined,
        baseUrl: provider?.base_url || undefined,
        modelId,
        headers,
        processEnvInjections,
      };

    case 'openai-image':
      return {
        sdkType: 'openai',
        apiKey: provider?.api_key || undefined,
        authToken: undefined,
        baseUrl: provider?.base_url || undefined,
        modelId,
        headers,
        processEnvInjections,
      };

    default: {
      const auth = resolveAnthropicAuth();
      return {
        sdkType: 'anthropic',
        ...auth,
        baseUrl: normaliseAnthropicBaseUrl(provider?.base_url),
        modelId,
        headers,
        processEnvInjections,
      };
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────

// OpenAI Codex API models available through ChatGPT Plus/Pro OAuth
const OPENAI_CODEX_MODELS: CatalogModel[] = [
  { modelId: 'gpt-5.5', displayName: 'GPT-5.5' },
  { modelId: 'gpt-5.4', displayName: 'GPT-5.4' },
  { modelId: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini' },
  { modelId: 'gpt-5.3-codex', displayName: 'GPT-5.3-Codex' },
  { modelId: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3-Codex-Spark' },
];

/**
 * Build resolution for the virtual OpenAI OAuth provider.
 * Uses OAuth Bearer token + Codex API endpoint.
 */
function buildOpenAIOAuthResolution(opts: ResolveOptions): ResolvedProvider {
  const model = opts.model || opts.sessionModel || 'gpt-5.5';

  const catalogEntry = OPENAI_CODEX_MODELS.find(m => m.modelId === model);

  return {
    provider: undefined,
    protocol: 'openai-compatible',
    authStyle: 'api_key',
    model,
    upstreamModel: model,
    modelDisplayName: catalogEntry?.displayName || model,
    headers: {},
    envOverrides: {},
    roleModels: { default: model },
    hasCredentials: true, // OAuth token checked at call time
    availableModels: OPENAI_CODEX_MODELS,
    settingSources: [],
    _openaiOAuth: true, // marker for toAiSdkConfig
  } as ResolvedProvider;
}

function buildResolution(
  provider: ApiProvider | undefined,
  opts: ResolveOptions,
): ResolvedProvider {
  if (!provider) {
    // Environment-based provider (no DB record) — credentials come from shell env,
    // legacy DB settings, or ~/.claude/settings.json (managed by cc-switch etc.).
    // When only settings.json has creds, we must still flag hasCredentials=true
    // so ai-provider.ts's guard doesn't preemptively abort before the SDK
    // subprocess receives the allowlisted settings env.
    const envHasCredentials = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      getSetting('anthropic_auth_token') ||
      hasClaudeSettingsCredentials()
    );
    // Read user-configured global default model — only use it if it's an env-provider model
    const globalDefaultModel = getSetting('global_default_model') || undefined;
    const globalDefaultProvider = getSetting('global_default_model_provider') || undefined;
    // Only apply global default when it belongs to the env provider (or no provider is specified)
    const applicableGlobalDefault = (globalDefaultModel && (!globalDefaultProvider || globalDefaultProvider === 'env'))
      ? globalDefaultModel : undefined;
    const model = opts.model || opts.sessionModel || applicableGlobalDefault || getSetting('default_model') || undefined;

    // Env mode uses short aliases (sonnet/opus/haiku) in the UI.
    // Map them to full Anthropic model IDs so toAiSdkConfig can resolve correctly.
    const envModels: CatalogModel[] = [
      {
        modelId: 'sonnet',
        upstreamModelId: 'claude-sonnet-4-20250514',
        displayName: 'Sonnet 4.6',
        capabilities: {
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'max'],
          supportsAdaptiveThinking: true,
        },
      },
      {
        modelId: 'opus',
        upstreamModelId: 'claude-opus-4-7',
        displayName: 'Opus 4.7',
        capabilities: {
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supportsAdaptiveThinking: true,
        },
      },
      {
        modelId: 'haiku',
        upstreamModelId: 'claude-haiku-4-5-20251001',
        displayName: 'Haiku 4.5',
        capabilities: {
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
        },
      },
    ];

    // Resolve upstream model from the alias table
    const catalogEntry = model ? envModels.find(m => m.modelId === model) : undefined;

    // Enable full Claude Code capabilities (CLAUDE.md, skills, hooks, auto-memory,
    // OMC) when the user has direct Anthropic credentials in their shell environment.
    // These are real terminal Claude Code users who expect the same experience.
    // cc-switch users (who get creds from ~/.claude/settings.json) keep [] for
    // fast-start — CodePilot manages their auth and MCP injection.
    const hasDirectAnthropicCreds = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN
    );
    const envSettingSources = hasDirectAnthropicCreds
      ? ['user', 'project', 'local']
      : [];

    return {
      provider: undefined,
      protocol: 'anthropic',
      authStyle: 'api_key',
      model,
      upstreamModel: catalogEntry?.upstreamModelId || model,
      modelDisplayName: catalogEntry?.displayName,
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: envHasCredentials,
      availableModels: envModels,
      settingSources: envSettingSources,
    };
  }

  // Determine protocol (new field or infer from legacy)
  const protocol = inferProtocolFromProvider(provider);
  const authStyle = inferAuthStyleFromProvider(provider);

  // Parse JSON fields
  const headers = safeParseJson(provider.headers_json);
  const envOverrides = safeParseJson(provider.env_overrides_json || provider.extra_env);
  let roleModels = safeParseJson(provider.role_models_json) as RoleModels;

  // Fall back to catalog preset's defaultRoleModels when DB has no role mappings.
  // This ensures sdkProxyOnly providers (MiniMax, Xiaomi MiMo, etc.) get correct
  // ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_*_MODEL env vars even when role_models_json
  // was saved as '{}' by the preset connect dialog.
  if (!roleModels.default && !roleModels.sonnet) {
    const preset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
    if (preset?.defaultRoleModels) {
      roleModels = { ...preset.defaultRoleModels, ...roleModels };
    }
  }

  // Get available models: DB provider_models take priority, then catalog defaults
  let availableModels = getDefaultModelsForProvider(protocol, provider.base_url, provider.provider_type);
  try {
    const dbModels = getModelsForProvider(provider.id);
    if (dbModels.length > 0) {
      // Convert DB rows to CatalogModel and merge (DB models override catalog by modelId)
      const dbCatalog: CatalogModel[] = dbModels.map(m => ({
        modelId: m.model_id,
        upstreamModelId: m.upstream_model_id || undefined,
        displayName: m.display_name || m.model_id,
        capabilities: safeParseCapabilities(m.capabilities_json),
      }));
      // Merge: DB models first, then catalog models not already in DB
      const dbIds = new Set(dbCatalog.map(m => m.modelId));
      availableModels = [...dbCatalog, ...availableModels.filter(m => !dbIds.has(m.modelId))];
    }
  } catch { /* provider_models table may not exist in old DBs */ }

  // Read per-provider options
  const providerOpts = getProviderOptions(provider.id);

  // Read global default model — only use it if it belongs to THIS provider
  const globalDefaultModel = getSetting('global_default_model') || undefined;
  const globalDefaultProvider = getSetting('global_default_model_provider') || undefined;
  const applicableGlobalDefault = (globalDefaultModel && globalDefaultProvider === provider.id)
    ? globalDefaultModel : undefined;

  // Resolve model — priority:
  //   1. Explicit request model (opts.model)
  //   2. Session's stored model (opts.sessionModel)
  //   3. Global default model (only if it belongs to this provider)
  //   4. Provider's roleModels.default (preset default, e.g. "ark-code-latest")
  //   5. Global default_model setting (legacy)
  const requestedModel = opts.model || opts.sessionModel || applicableGlobalDefault || roleModels.default || getSetting('default_model') || undefined;
  let model = requestedModel;
  let upstreamModel: string | undefined;
  let modelDisplayName: string | undefined;
  // 多头路由：追踪父级实际使用的模型，用于 toClaudeCodeEnv() 设置 ANTHROPIC_MODEL
  let parentTierModel: string | undefined;

  // If a use case is specified, check role models for that use case
  if (opts.useCase && opts.useCase !== 'default' && roleModels[opts.useCase]) {
    model = roleModels[opts.useCase];
  }

  // Handle Multi-Head Router Logic
  if (protocol === 'multi_head') {
    // Since the UI now sends the actual mapped string (e.g. "providerId:modelId")
    // or falls back to 'orchestrator'/'default' if nothing was selected.
    if (!model || model === 'orchestrator') {
      model = roleModels.default;
    }
    
    // The "model" at this point is a mapped string like "providerId:modelId"
    // e.g. "anthropic:claude-3-5-sonnet"
    if (model && model.includes(':')) {
      const [targetProviderId, ...targetModelParts] = model.split(':');
      const targetModelId = targetModelParts.join(':');

      // Prevent infinite recursion by removing providerId and setting explicitly
      const newOpts: ResolveOptions = {
        providerId: targetProviderId,
        model: targetModelId,
      };

      // 递归解析目标 provider，但保留多头路由的 roleModels
      // 这样 toClaudeCodeEnv() 能正确设置每个层级的模型映射（sonnet→MiniMax, haiku→oLMX 等）
      const targetResolved = resolveProvider(newOpts);

      // 保留 roleModels 的 providerId:modelId 格式
      // toClaudeCodeEnv() 用 stripProviderPrefix() 会自动去掉 providerId 前缀
      // resolveAgentModel() 需要 providerId:modelId 格式来提取目标 provider
      targetResolved.roleModels = {
        default: targetResolved.upstreamModel || roleModels.default,
        reasoning: roleModels.reasoning,
        small: roleModels.small,
        haiku: roleModels.haiku,
        sonnet: roleModels.sonnet,
        opus: roleModels.opus,
      };
      // 保存父级实际使用的模型，让 toClaudeCodeEnv() 设置正确的 ANTHROPIC_MODEL
      // 这样 SDK 子进程及其子 agent 会使用正确的模型，而不是多头路由的默认模型
      targetResolved.parentTierModel = targetModelId;
      targetResolved._isMultiHead = true;
      return targetResolved;
    } else {
      // 模型名称不包含 ':'，可能是直接的模型名（如 "MiMo-V2.5-Pro"）
      // 从 roleModels 中找到匹配的 tier，递归解析到目标 provider
      // 这样子Agent能拿到目标 provider 的 api_key 和 base_url
      if (model) {
        for (const v of Object.values(roleModels)) {
          if (v && v.includes(':')) {
            const mId = v.split(':').slice(1).join(':');
            if (mId === model) {
              // 找到匹配的 tier，提取目标 provider 信息并递归解析
              const [targetProviderId, ...targetModelParts] = v.split(':');
              const targetModelId = targetModelParts.join(':');
              console.log(`[provider-resolver] multi_head direct model "${model}" matched tier → provider=${targetProviderId.slice(0,12)}... model=${targetModelId}`);
              const targetResolved = resolveProvider({ providerId: targetProviderId, model: targetModelId });
              // 保留 roleModels 的 providerId:modelId 格式（同 model.includes(':') 分支）
              targetResolved.roleModels = {
                default: targetResolved.upstreamModel || roleModels.default,
                reasoning: roleModels.reasoning,
                small: roleModels.small,
                haiku: roleModels.haiku,
                sonnet: roleModels.sonnet,
                opus: roleModels.opus,
              };
              targetResolved.parentTierModel = targetModelId;
              targetResolved._isMultiHead = true;
              return targetResolved;
            }
          }
        }
      }
      console.warn('[provider-resolver] multi_head provider requested but no valid provider:model mapping found for model:', model);
    }
  }

  // Find display name and upstream model ID from catalog
  if (model && availableModels.length > 0) {
    const catalogEntry = availableModels.find(m => m.modelId === model);
    if (catalogEntry) {
      modelDisplayName = catalogEntry.displayName;
      // upstreamModelId is what actually gets sent to the API (may differ from the UI model ID)
      upstreamModel = catalogEntry.upstreamModelId || model;
    }
  }
  // If no catalog entry, upstream = model (identity mapping)
  if (!upstreamModel && model) {
    upstreamModel = model;
  }

  // Ensure roleModels.default reflects the upstream model for the current request,
  // so toClaudeCodeEnv() sets ANTHROPIC_MODEL to the correct upstream ID.
  // Only override when the request explicitly specifies a model (opts.model) and
  // we found a different upstream ID via catalog lookup.
  if (upstreamModel && opts.model && upstreamModel !== roleModels.default) {
    roleModels = { ...roleModels, default: upstreamModel };
  }

  // 多头路由：将所有 roleModels 值解析为 upstream model ID
  // roleModels 格式为 "providerId:modelId"，需要：
  // 1. 去掉 providerId 前缀
  // 2. 查找目标 provider 的 catalog，解析为 upstream model ID（小写格式）
  // 这样 toClaudeCodeEnv() 设置 ANTHROPIC_DEFAULT_*_MODEL 时使用正确的 API 模型 ID
  const resolveRoleModelUpstream = (value: string | undefined): string | undefined => {
    if (!value || typeof value !== 'string') return value;
    let modelId = value;
    if (modelId.includes(':')) {
      const parts = modelId.split(':');
      const targetProviderId = parts[0];
      modelId = parts.slice(1).join(':');
      try {
        // 通过 resolveProvider 获取目标 provider 的 upstreamModel
        // 它会自动查 provider_models 表和 catalog
        const targetResolved = resolveProvider({ providerId: targetProviderId, model: modelId });
        if (targetResolved.upstreamModel) return targetResolved.upstreamModel;
      } catch { /* fallback to original modelId */ }
    }
    return modelId;
  };
  roleModels = {
    default: resolveRoleModelUpstream(roleModels.default),
    reasoning: resolveRoleModelUpstream(roleModels.reasoning),
    small: resolveRoleModelUpstream(roleModels.small),
    haiku: resolveRoleModelUpstream(roleModels.haiku),
    sonnet: resolveRoleModelUpstream(roleModels.sonnet),
    opus: resolveRoleModelUpstream(roleModels.opus),
  };

  // Has credentials?
  // 多头路由的目标 provider 可能没有自己的 api_key，但环境变量中可能有凭证
  // 当 provider 有 base_url 时（说明是有效的目标端点），也检查环境变量
  const hasCredentials = !!(provider.api_key) || authStyle === 'env_only' ||
    (!!provider.base_url && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || hasClaudeSettingsCredentials()));

  // Full capabilities mode: let the SDK subprocess load user/project/local
  // settings so CLAUDE.md, skills, hooks, auto-memory, and OMC all work.
  //
  // Enabled by default for official Anthropic API endpoints.
  // For third-party proxies (Kimi, GLM, OpenRouter), can be force-enabled
  // via the 'sdk_full_capabilities' setting. The shadow HOME mechanism
  // already strips ANTHROPIC_* keys from user settings.json to prevent
  // credential leakage, but project-level ANTHROPIC_BASE_URL could still
  // conflict — users enabling this for third-party providers should ensure
  // their project .claude/settings.json doesn't set ANTHROPIC_BASE_URL.
  const baseUrl = provider.base_url || '';
  const isOfficialAnthropic = !baseUrl ||
    baseUrl.includes('api.anthropic.com') ||
    baseUrl.endsWith('.anthropic.com');
  const forceFullCapabilities = getSetting('sdk_full_capabilities') === 'true';
  const settingSources: string[] =
    (isOfficialAnthropic || forceFullCapabilities)
      ? ['user', 'project', 'local']
      : [];

  return {
    provider,
    protocol,
    authStyle,
    model,
    upstreamModel,
    modelDisplayName,
    headers,
    envOverrides,
    roleModels,
    hasCredentials,
    availableModels,
    settingSources,
    parentTierModel,
  };
}

/**
 * Determine protocol from a provider record.
 * Delegates to the shared getEffectiveProviderProtocol() so raw values that
 * aren't valid Protocol union members (legacy garbage, future unknown
 * strings) fall back to legacy inference instead of silently poisoning
 * downstream capability lookups.
 */
function inferProtocolFromProvider(provider: ApiProvider): Protocol {
  return getEffectiveProviderProtocol(
    provider.provider_type,
    provider.protocol,
    provider.base_url,
  );
}

function inferAuthStyleFromProvider(provider: ApiProvider): AuthStyle {
  // Check preset match first — pass protocol to avoid cross-protocol fuzzy mismatches
  const protocol = inferProtocolFromProvider(provider);
  const preset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
  if (preset) return preset.authStyle;

  return inferAuthStyleFromLegacy(provider.provider_type, provider.extra_env);
}

function safeParseJson(json: string | undefined | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* ignore */ }
  return {};
}

function safeParseCapabilities(json: string | undefined | null): CatalogModel['capabilities'] {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* ignore */ }
  return undefined;
}

// ApiProvider now includes protocol, headers_json, env_overrides_json, role_models_json
// directly — no type augmentation needed.

// ── Auxiliary model routing ─────────────────────────────────────
//
// Auxiliary tasks (context compression, short summaries, vision,
// web extract, etc.) should use a small/fast model to save cost.
// This section implements the 5-step resolution chain documented in
// docs/research/hermes-agent-analysis.md §3.2:
//
//   1. Per-task env override (AUXILIARY_<TASK>_PROVIDER + _MODEL)
//   2. Main provider's roleModels.small (if not sdkProxyOnly)
//   3. Main provider's roleModels.haiku (if not sdkProxyOnly)
//   4. First other non-sdkProxyOnly provider with .small or .haiku
//   5. Main provider + main model (ultimate floor — never returns null)
//
// CodePilot background: provider preset's roleModels.small slot is
// already populated for many providers (see provider-catalog.ts) and
// already consumed by toClaudeCodeEnv() to set ANTHROPIC_SMALL_FAST_MODEL
// for the SDK path. This routing extends the same slot to Native Runtime
// auxiliary tasks without hardcoding provider-specific model names.

export type AuxiliaryTask = 'compact' | 'vision' | 'summarize' | 'web_extract';

export type AuxiliaryResolutionSource =
  | 'env_override'
  | 'main_small'
  | 'main_haiku'
  | 'fallback_provider_small'
  | 'fallback_provider_haiku'
  | 'main_floor';

export interface AuxiliaryModelResolution {
  /** Provider ID — 'env' when no DB provider is configured (environment mode). */
  providerId: string;
  /** Upstream model ID to send to the API. May be empty string if nothing is configured. */
  modelId: string;
  /** Which resolution tier produced this result — for telemetry / debugging. */
  source: AuxiliaryResolutionSource;
}

/**
 * Context required by the pure routing function.
 * Everything is pre-fetched by resolveAuxiliaryModel() so the routing logic
 * itself performs no IO and is trivial to unit test.
 */
export interface AuxiliaryRoutingContext {
  /** Result of resolveProvider() — may have provider=undefined in env mode. */
  main: ResolvedProvider;
  /** Whether main provider is flagged sdkProxyOnly via its preset. */
  isMainSdkProxyOnly: boolean;
  /** Other configured providers with their roleModels and sdkProxyOnly flag. */
  others: ReadonlyArray<{
    id: string;
    roleModels: RoleModels;
    isSdkProxyOnly: boolean;
  }>;
  /** Per-task env override — env_override tier only applies when BOTH are set. */
  envOverride?: { providerId?: string; modelId?: string };
}

/**
 * Pure routing function — implements the 5-step resolution chain.
 *
 * Separated from the live wrapper so unit tests can feed in fixtures
 * without mocking DB / env. All dependencies come in via `ctx`.
 */
export function routeAuxiliaryModel(
  task: AuxiliaryTask,
  ctx: AuxiliaryRoutingContext,
): AuxiliaryModelResolution {
  void task; // per-task logic currently limited to env var name (handled in wrapper)

  // Tier 1: Per-task env override — requires both provider and model set.
  const env = ctx.envOverride;
  if (env?.providerId && env?.modelId) {
    return {
      providerId: env.providerId,
      modelId: env.modelId,
      source: 'env_override',
    };
  }

  const main = ctx.main;
  const mainId = main.provider?.id ?? 'env';

  // Tier 2: Main provider's small slot (if not sdkProxyOnly).
  if (!ctx.isMainSdkProxyOnly && main.roleModels.small) {
    return {
      providerId: mainId,
      modelId: main.roleModels.small,
      source: 'main_small',
    };
  }

  // Tier 3: Main provider's haiku slot (if not sdkProxyOnly).
  if (!ctx.isMainSdkProxyOnly && main.roleModels.haiku) {
    return {
      providerId: mainId,
      modelId: main.roleModels.haiku,
      source: 'main_haiku',
    };
  }

  // Tier 4: Scan other providers for first non-sdkProxyOnly with small or haiku.
  for (const other of ctx.others) {
    if (other.isSdkProxyOnly) continue;
    if (other.roleModels.small) {
      return {
        providerId: other.id,
        modelId: other.roleModels.small,
        source: 'fallback_provider_small',
      };
    }
    if (other.roleModels.haiku) {
      return {
        providerId: other.id,
        modelId: other.roleModels.haiku,
        source: 'fallback_provider_haiku',
      };
    }
  }

  // Tier 5: Ultimate floor — main provider + main model.
  // This is the "never return null" guarantee: if no cheap model is available,
  // the auxiliary task simply uses the same model as the main conversation.
  // Callers treat this as "auxiliary optimization unavailable, run on primary".
  return {
    providerId: mainId,
    modelId: main.upstreamModel || main.model || '',
    source: 'main_floor',
  };
}

/**
 * Live entry point — fetches the main provider, enumerates other configured
 * providers, reads per-task env overrides, and delegates to routeAuxiliaryModel.
 *
 * **Never returns null.** When no cheap auxiliary model is available, falls
 * back to the main provider + main model (source: 'main_floor') so callers
 * can always make a valid model call — even if it doesn't save cost.
 *
 * **Session context**: callers MUST pass the session's provider context
 * (providerId / sessionProviderId / sessionModel) so that "main" means
 * "the provider backing this chat session", not "the global default".
 * Without this, an auxiliary task from a session that overrides the
 * default provider would compress against unrelated credentials/models.
 * See exec plan decision log 2026-04-12 ~04:00 for the Codex review
 * that caught this.
 *
 * @param task The auxiliary task type (compact, vision, summarize, web_extract)
 * @param opts Session context forwarded to `resolveProvider()`. Omitting
 *   this falls back to the global default provider — intentionally kept
 *   for callers that don't have a session (e.g. background jobs).
 */
export function resolveAuxiliaryModel(
  task: AuxiliaryTask,
  opts: ResolveOptions = {},
): AuxiliaryModelResolution {
  // Resolve the main provider with session context. Passing opts through
  // is critical — otherwise auxiliary routing targets the global default
  // instead of the session's active provider.
  const main = resolveProvider(opts);

  // Determine if main provider is sdkProxyOnly via preset lookup.
  let isMainSdkProxyOnly = false;
  if (main.provider) {
    const preset = findPresetForLegacy(
      main.provider.base_url,
      main.provider.provider_type,
      main.protocol,
    );
    isMainSdkProxyOnly = preset?.sdkProxyOnly ?? false;
  }

  // Enumerate other providers and compute their roleModels + sdkProxyOnly.
  const others: Array<{ id: string; roleModels: RoleModels; isSdkProxyOnly: boolean }> = [];
  if (main.provider) {
    try {
      const allProviders = getAllProviders();
      for (const p of allProviders) {
        if (p.id === main.provider.id) continue;
        // Match the main-path resolver: fall back through legacy inference
        // whenever raw protocol isn't a valid Protocol union member, so a
        // stray 'random-garbage' row can't silently drive preset / role-model
        // lookup into a different code path than the main provider got.
        const protocol = getEffectiveProviderProtocol(p.provider_type, p.protocol, p.base_url);
        const preset = findPresetForLegacy(p.base_url, p.provider_type, protocol);
        others.push({
          id: p.id,
          roleModels: computeEffectiveRoleModels(p, preset, protocol),
          isSdkProxyOnly: preset?.sdkProxyOnly ?? false,
        });
      }
    } catch (err) {
      // getAllProviders may fail in test environments or on fresh DBs.
      // Degrade gracefully — the routing still returns a usable result via
      // the main_floor tier.
      console.warn('[resolveAuxiliaryModel] getAllProviders failed:', err);
    }
  }

  // Per-task env override — read e.g. AUXILIARY_COMPACT_PROVIDER + _MODEL.
  const envKey = task.toUpperCase();
  const envProvider = process.env[`AUXILIARY_${envKey}_PROVIDER`];
  const envModel = process.env[`AUXILIARY_${envKey}_MODEL`];

  return routeAuxiliaryModel(task, {
    main,
    isMainSdkProxyOnly,
    others,
    envOverride: {
      providerId: envProvider,
      modelId: envModel,
    },
  });
}

/**
 * Merge a provider's persisted `role_models_json` with its catalog
 * preset's `defaultRoleModels`, matching the same "fallback when no
 * default/sonnet is set" rule used by `buildResolution()` (see :664-675).
 *
 * Extracting this ensures the tier-4 auxiliary fallback sees the same
 * effective role models as the main provider resolution — without it,
 * providers that rely on preset defaults (instead of user-persisted JSON)
 * would appear to have no small/haiku slot, silently downgrading the
 * auxiliary fallback chain to `main_floor`.
 *
 * **Exported for unit testing.** The merge rule is simple but the logic
 * is load-bearing — the pre-fix auxiliary path diverged from the main
 * path by skipping this merge, and a direct unit test is the cheapest
 * way to lock the contract down. Callers inside this file use this
 * helper at the tier-4 scan site; external callers should prefer the
 * higher-level `resolveAuxiliaryModel()` unless they specifically need
 * to replicate the merge.
 */
export function computeEffectiveRoleModels(
  provider: ApiProvider,
  preset: ReturnType<typeof findPresetForLegacy>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _protocol: Protocol,
): RoleModels {
  let roleModels = safeParseRoleModels(provider.role_models_json);
  // Same fallback condition as buildResolution(): only pull preset defaults
  // when the user hasn't persisted a default or sonnet slot. Avoids
  // overriding user customizations while still giving preset-backed
  // providers their documented slots.
  if (!roleModels.default && !roleModels.sonnet && preset?.defaultRoleModels) {
    roleModels = { ...preset.defaultRoleModels, ...roleModels };
  }
  return roleModels;
}

function safeParseRoleModels(json: string | undefined | null): RoleModels {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) return parsed as RoleModels;
  } catch { /* ignore */ }
  return {};
}
