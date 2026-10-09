/**
 * Provider Catalog — vendor presets, protocol definitions, and default model catalogs.
 *
 * This is the single source of truth for:
 * - Which protocol a vendor uses (anthropic, openai-compatible, bedrock, vertex, etc.)
 * - Default env overrides each vendor needs for Claude Code SDK
 * - Default model catalogs (role → upstream model id mapping)
 * - Auth key injection style (ANTHROPIC_API_KEY vs ANTHROPIC_AUTH_TOKEN)
 * - Provider meta info (API key URLs, docs, billing model, notes)
 */

import { z } from 'zod';

// ── Protocol types ──────────────────────────────────────────────

/**
 * Protocol describes how to talk to a provider's API.
 * This determines which SDK client to instantiate and which env vars to set.
 */
export type Protocol =
  | 'anthropic'           // Native Anthropic API (official + third-party compatible)
  | 'openai-compatible'   // OpenAI-compatible REST API
  | 'openrouter'          // OpenRouter (OpenAI-compatible with extra headers)
  | 'bedrock'             // AWS Bedrock (env-based auth, CLAUDE_CODE_USE_BEDROCK)
  | 'vertex'              // Google Vertex AI (env-based auth, CLAUDE_CODE_USE_VERTEX)
  | 'google'              // Google Generative AI (Gemini text)
  | 'gemini-image'        // Google Gemini image generation
  | 'multi_head'
  | 'openai-image';       // OpenAI GPT Image generation

/**
 * How the provider authenticates: which env var to inject the API key into.
 */
export type AuthStyle =
  | 'api_key'             // ANTHROPIC_API_KEY
  | 'auth_token'          // ANTHROPIC_AUTH_TOKEN
  | 'env_only'            // No API key; auth via extra env (bedrock/vertex)
  | 'custom_header';      // API key in custom header (future)

/**
 * Model role — semantic purpose, maps to ANTHROPIC_DEFAULT_*, ANTHROPIC_MODEL, etc.
 */
export type ModelRole = 'default' | 'reasoning' | 'small' | 'haiku' | 'sonnet' | 'opus';

/**
 * A model entry in the catalog.
 */
export interface CatalogModel {
  /** Internal/UI model ID (what the user sees and what we pass to Claude Code) */
  modelId: string;
  /** Actual upstream model ID (what gets sent to the API) — if different from modelId */
  upstreamModelId?: string;
  /** Human-readable display name */
  displayName: string;
  /** Role mapping for Claude Code env vars */
  role?: ModelRole;
  /** Capabilities */
  capabilities?: {
    reasoning?: boolean;
    toolUse?: boolean;
    vision?: boolean;
    pdf?: boolean;
    contextWindow?: number;
    /** Whether this model supports effort levels (reasoning effort) */
    supportsEffort?: boolean;
    /** Allowed effort levels for this model (Opus 4.7 adds 'xhigh') */
    supportedEffortLevels?: ('low' | 'medium' | 'high' | 'xhigh' | 'max')[];
    /** Whether this model supports adaptive thinking */
    supportsAdaptiveThinking?: boolean;
    /** Whether this model supports a user-facing thinking toggle (e.g. Deepseek) */
    supportsThinkingToggle?: boolean;
  };
}

/**
 * Role models map — maps semantic roles to model IDs.
 * Used to generate ANTHROPIC_MODEL, ANTHROPIC_REASONING_MODEL, ANTHROPIC_DEFAULT_* env vars.
 */
export interface RoleModels {
  default?: string;
  reasoning?: string;
  small?: string;
  haiku?: string;
  sonnet?: string;
  opus?: string;
}

const MODEL_CONTEXT = {
  QWEN_1M: 1_000_000,
  QWEN_CODER_NEXT: 262_144,
  KIMI_K2_5: 262_144,
  GLM_5: 202_752,
  GLM_4_7: 169_984,
  MINIMAX_M3: 1_000_000,      // M3: 1M context (512K guaranteed minimum)
  MINIMAX_M2_7: 204_800,
  MINIMAX_M2_5: 196_608,
  MIMO_V2_6: 1_048_576,       // V2.6 series: 1M context, 128K max output
  MIMO_V2_5_PRO: 1_048_576,
  MIMO_V2_5: 1_048_576,
  DEEPSEEK_V4: 1_000_000,
} as const;

// ── Vendor preset definition ────────────────────────────────────

export interface VendorPreset {
  /** Unique preset key (used as lookup key) */
  key: string;
  /** Human-readable name */
  name: string;
  /** Description (English) */
  description: string;
  /** Description (Chinese) */
  descriptionZh: string;
  /** Wire protocol */
  protocol: Protocol;
  /** Auth style */
  authStyle: AuthStyle;
  /** Default base URL (empty for bedrock/vertex) */
  baseUrl: string;
  /** Default env overrides for Claude Code SDK */
  defaultEnvOverrides: Record<string, string>;
  /** Default model catalog */
  defaultModels: CatalogModel[];
  /** Default role models mapping */
  defaultRoleModels?: RoleModels;
  /** Which fields the quick-connect form shows */
  fields: ('name' | 'api_key' | 'base_url' | 'env_overrides' | 'model_names' | 'model_mapping')[];
  /** Category: chat (default) or media */
  category?: 'chat' | 'media';
  /**
   * Transport for media presets. `'openai-images'` means the relay implements
   * the standard OpenAI Images API (`/v1/images/generations` +
   * `/v1/images/edits`) — `image-generator.ts` routes those through the OpenAI
   * SDK rather than the legacy `/v1/chat/completions` relay shim.
   * Omit for chat presets and for custom/chat-style image relays.
   */
  mediaProtocol?: 'custom-image' | 'openai-images';
  /** Icon key for UI */
  iconKey: string;
  /**
   * True for providers that only support the Claude Code SDK wire protocol
   * (e.g. Kimi /coding/, GLM /api/anthropic).
   * These providers cannot be used with the Vercel AI SDK text generation path
   * (streamText / generateText) because they don't implement the standard
   * Anthropic Messages API.
   */
  sdkProxyOnly?: boolean;
  /** Provider meta info for user guidance and error recovery */
  meta?: {
    /** URL where user can obtain/manage API key */
    apiKeyUrl?: string;
    /** Official configuration documentation URL */
    docsUrl?: string;
    /** Pricing page URL */
    pricingUrl?: string;
    /** Service status page URL */
    statusPageUrl?: string;
    /** Billing model */
    billingModel: 'pay_as_you_go' | 'coding_plan' | 'token_plan' | 'free' | 'self_hosted';
    /** Notes/warnings shown during provider configuration */
    notes?: string[];
  };
}

// ── Zod Schema for preset validation ──────────────────────────────

const PresetMetaSchema = z.object({
  apiKeyUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  pricingUrl: z.string().optional(),
  statusPageUrl: z.string().optional(),
  billingModel: z.enum(['pay_as_you_go', 'coding_plan', 'token_plan', 'free', 'self_hosted']),
  notes: z.array(z.string()).optional(),
});

export const PresetSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  descriptionZh: z.string(),
  protocol: z.enum(['anthropic', 'openai-compatible', 'openrouter', 'bedrock', 'vertex', 'google', 'gemini-image', 'multi_head', 'openai-image']),
  authStyle: z.enum(['api_key', 'auth_token', 'env_only', 'custom_header']),
  baseUrl: z.string(),
  defaultEnvOverrides: z.record(z.string(), z.string()),
  defaultModels: z.array(z.object({
    modelId: z.string(),
    upstreamModelId: z.string().optional(),
    displayName: z.string(),
    role: z.enum(['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus']).optional(),
    capabilities: z.object({
      reasoning: z.boolean().optional(),
      toolUse: z.boolean().optional(),
      vision: z.boolean().optional(),
      pdf: z.boolean().optional(),
      contextWindow: z.number().optional(),
      supportsEffort: z.boolean().optional(),
      supportedEffortLevels: z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])).optional(),
      supportsAdaptiveThinking: z.boolean().optional(),
      supportsThinkingToggle: z.boolean().optional(),
    }).optional(),
  })),
  fields: z.array(z.string()),
  iconKey: z.string(),
  sdkProxyOnly: z.boolean().optional(),
  category: z.enum(['chat', 'media']).optional(),
  mediaProtocol: z.enum(['custom-image', 'openai-images']).optional(),
  defaultRoleModels: z.record(z.string(), z.string()).optional(),
  meta: PresetMetaSchema.optional(),
}).refine(data => {
  // auth_token presets must NOT have ANTHROPIC_API_KEY in envOverrides
  // (auth_token injection already clears API_KEY; envOverrides entry would be ignored by AUTH_ENV_KEYS skip)
  if (data.authStyle === 'auth_token' && data.defaultEnvOverrides.ANTHROPIC_API_KEY !== undefined) {
    return false;
  }
  // api_key presets must NOT have ANTHROPIC_AUTH_TOKEN in envOverrides
  if (data.authStyle === 'api_key' && data.defaultEnvOverrides.ANTHROPIC_AUTH_TOKEN !== undefined) {
    return false;
  }
  // Note: auth_token presets MAY have ANTHROPIC_AUTH_TOKEN with a fixed pseudo-value (e.g. Ollama uses 'ollama').
  // This is allowed because it's a preset default, not user input — though the AUTH_ENV_KEYS skip in
  // toClaudeCodeEnv() means it will only take effect if the user doesn't provide their own key.
  return true;
}, { message: 'authStyle conflicts with auth-related keys in defaultEnvOverrides' });

// ── Default Anthropic models ────────────────────────────────────

// Shared Anthropic catalog used by non-first-party providers
// (anthropic-thirdparty, openrouter, ollama, litellm) and the generic
// protocol fallback. Intentionally alias-only: third-party providers
// often require their own upstream model names (OpenRouter goes through
// the OpenAI SDK, LiteLLM expects user-configured names, etc.), and
// forcing claude-opus-4-7 here would break those pass-through paths.
// First-party Anthropic has its own catalog below.
const ANTHROPIC_DEFAULT_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    displayName: 'Opus',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// First-party Anthropic API (anthropic-official preset) — pins opus to
// the explicit upstream ID so resolved.upstreamModel carries a concrete
// model name downstream. This unblocks the Opus 4.7 sanitizer regex
// in claude-model-options.ts (which matches upstream IDs, not aliases)
// and guarantees the native path doesn't forward the bare "opus"
// alias to @ai-sdk/anthropic.
const ANTHROPIC_FIRST_PARTY_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
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
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// Bedrock / Vertex: per Claude Code docs, the `opus` alias still resolves
// to Opus 4.6 on these platforms (unlike first-party Anthropic). Users who
// want Opus 4.7 on Bedrock/Vertex must pass the full model name or set
// ANTHROPIC_DEFAULT_OPUS_MODEL explicitly. We surface this in the label to
// avoid promising 4.7 capabilities (xhigh) on an alias that actually runs 4.6.
const BEDROCK_VERTEX_DEFAULT_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    displayName: 'Opus 4.6 (alias)',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// ── Vendor presets ──────────────────────────────────────────────

export const VENDOR_PRESETS: VendorPreset[] = [
  // ── MiniMax (China) ──
  {
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    description: 'MiniMax Code Plan — China region',
    descriptionZh: 'MiniMax 编程套餐 — 中国区',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    defaultModels: [
      { modelId: 'MiniMax-M3', upstreamModelId: 'MiniMax-M3', displayName: 'MiniMax-M3', role: 'default', capabilities: { contextWindow: MODEL_CONTEXT.MINIMAX_M3, vision: true } },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M3',
      sonnet: 'MiniMax-M3',
      opus: 'MiniMax-M3',
      haiku: 'MiniMax-M3',
    },
    fields: ['api_key', 'model_names', 'model_mapping'],
    iconKey: 'minimax',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.minimaxi.com/user-center/payment/token-plan',
      docsUrl: 'https://platform.minimaxi.com/docs/token-plan/claude-code',
      billingModel: 'token_plan',
    },
  },

  // ── MiniMax (Global) ──
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan — Global region',
    descriptionZh: 'MiniMax 编程套餐 — 国际区',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    defaultModels: [
      { modelId: 'MiniMax-M3', upstreamModelId: 'MiniMax-M3', displayName: 'MiniMax-M3', role: 'default', capabilities: { contextWindow: MODEL_CONTEXT.MINIMAX_M3, vision: true } },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M3',
      sonnet: 'MiniMax-M3',
      opus: 'MiniMax-M3',
      haiku: 'MiniMax-M3',
    },
    fields: ['api_key', 'model_names', 'model_mapping'],
    iconKey: 'minimax',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.minimax.io/user-center/payment/token-plan',
      docsUrl: 'https://platform.minimax.io/docs/token-plan/opencode',
      billingModel: 'token_plan',
    },
  },

  // ── DeepSeek ──
  {
    key: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Anthropic-compatible API — V4 Pro / V4 Flash',
    descriptionZh: 'DeepSeek Anthropic 兼容 API — V4 Pro / V4 Flash',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.deepseek.com/anthropic',
    defaultEnvOverrides: {
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-pro',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
    },
    defaultModels: [
      { modelId: 'deepseek-v4-pro', upstreamModelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', role: 'default', capabilities: { contextWindow: MODEL_CONTEXT.DEEPSEEK_V4, vision: false, supportsEffort: true, supportedEffortLevels: ['high', 'max'], supportsThinkingToggle: true } },
      { modelId: 'deepseek-v4-flash', upstreamModelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', role: 'haiku', capabilities: { contextWindow: MODEL_CONTEXT.DEEPSEEK_V4, vision: true, supportsEffort: true, supportedEffortLevels: ['high', 'max'], supportsThinkingToggle: true } },
    ],
    defaultRoleModels: {
      default: 'deepseek-v4-pro',
      sonnet: 'deepseek-v4-pro',
      opus: 'deepseek-v4-pro',
      haiku: 'deepseek-v4-flash',
    },
    fields: ['api_key'],
    iconKey: 'deepseek',
    meta: {
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      docsUrl: 'https://platform.deepseek.com/docs',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── BananaRouter ──
  {
    key: 'bananarouter',
    name: 'BananaRouter',
    description: 'BananaRouter — OpenAI-compatible relay for chat and image generation',
    descriptionZh: 'BananaRouter — OpenAI 兼容中转（聊天 + 生图）',
    protocol: 'openai-compatible',
    authStyle: 'api_key',
    baseUrl: 'https://api.bananarouter.com/v1',
    defaultEnvOverrides: {},
    defaultModels: [],  // User must specify model_names — query via /v1/models
    fields: ['api_key', 'base_url', 'model_names'],
    iconKey: 'server',
    meta: {
      apiKeyUrl: 'https://api.bananarouter.com',
      docsUrl: 'https://api.bananarouter.com',
      billingModel: 'self_hosted',
    },
  },

  // ── Xiaomi MiMo (按量付费) ──
  {
    key: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo Pay-as-you-go API — MiMo-V2.6 series',
    descriptionZh: '小米 MiMo 按量付费 — MiMo-V2.6 系列',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'mimo-v2.6-pro', upstreamModelId: 'mimo-v2.6-pro', displayName: 'MiMo-V2.6-Pro', role: 'default', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
      { modelId: 'mimo-v2.6-flash', upstreamModelId: 'mimo-v2.6-flash', displayName: 'MiMo-V2.6-Flash', role: 'haiku', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
      { modelId: 'mimo-v2.6-pro-ultraspeed', upstreamModelId: 'mimo-v2.6-pro-ultraspeed', displayName: 'MiMo-V2.6-Pro-UltraSpeed', role: 'sonnet', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
    ],
    defaultRoleModels: {
      default: 'mimo-v2.6-pro',
      sonnet: 'mimo-v2.6-pro',
      opus: 'mimo-v2.6-pro',
      haiku: 'mimo-v2.6-flash',
    },
    fields: ['api_key', 'base_url', 'model_names', 'model_mapping'],
    iconKey: 'xiaomi-mimo',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
      docsUrl: 'https://platform.xiaomimimo.com/#/docs/integration/claudecode',
      billingModel: 'pay_as_you_go',
      notes: [],
    },
  },

  // ── Xiaomi MiMo Token Plan (订阅套餐) ──
  {
    key: 'xiaomi-mimo-token-plan',
    name: 'Xiaomi MiMo Token Plan',
    description: 'Xiaomi MiMo Token Plan subscription — MiMo-V2.6 series',
    descriptionZh: '小米 MiMo Token Plan 订阅套餐 — MiMo-V2.6 系列',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'mimo-v2.6-pro', upstreamModelId: 'mimo-v2.6-pro', displayName: 'MiMo-V2.6-Pro', role: 'default', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
      { modelId: 'mimo-v2.6-flash', upstreamModelId: 'mimo-v2.6-flash', displayName: 'MiMo-V2.6-Flash', role: 'haiku', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
      { modelId: 'mimo-v2.6-pro-ultraspeed', upstreamModelId: 'mimo-v2.6-pro-ultraspeed', displayName: 'MiMo-V2.6-Pro-UltraSpeed', role: 'sonnet', capabilities: { contextWindow: MODEL_CONTEXT.MIMO_V2_6, vision: true } },
    ],
    defaultRoleModels: {
      default: 'mimo-v2.6-pro',
      sonnet: 'mimo-v2.6-pro',
      opus: 'mimo-v2.6-pro',
      haiku: 'mimo-v2.6-flash',
    },
    fields: ['api_key', 'base_url', 'model_names', 'model_mapping'],
    iconKey: 'xiaomi-mimo',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      docsUrl: 'https://platform.xiaomimimo.com/#/docs/integration/claudecode',
      billingModel: 'token_plan',
      notes: [],
    },
  },

  // ── Google Gemini (Image) ──
  {
    key: 'gemini-image',
    name: 'Google Gemini (Image)',
    description: 'Nano Banana Pro — AI image generation by Google Gemini',
    descriptionZh: 'Nano Banana Pro — Google Gemini AI 图片生成',
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gemini-3.1-flash-image-preview', displayName: 'Nano Banana 2' },
      { modelId: 'gemini-3-pro-image-preview', displayName: 'Nano Banana Pro' },
      { modelId: 'gemini-2.5-flash-image', displayName: 'Nano Banana' },
    ],
    fields: ['api_key'],
    category: 'media',
    iconKey: 'google',
    meta: {
      apiKeyUrl: 'https://aistudio.google.com/api-keys',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── Google Gemini (Image) Third-party ──
  // Same protocol & SDK as the official preset; only the base URL differs so
  // users can route through a compatible proxy (e.g. custom relay, CN mirror).
  {
    key: 'gemini-image-thirdparty',
    name: 'Gemini Image Third-party',
    description: 'Nano Banana via compatible proxy — provide URL and Key',
    descriptionZh: 'Nano Banana 兼容第三方 API — 填写地址和密钥',
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gemini-3.1-flash-image-preview', displayName: 'Nano Banana 2' },
      { modelId: 'gemini-3-pro-image-preview', displayName: 'Nano Banana Pro' },
      { modelId: 'gemini-2.5-flash-image', displayName: 'Nano Banana' },
    ],
    fields: ['name', 'api_key', 'base_url'],
    category: 'media',
    iconKey: 'google',
  },

  // ── OpenAI (Image) ──
  {
    key: 'openai-image',
    name: 'OpenAI (Image)',
    description: 'GPT Image 2 — AI image generation by OpenAI',
    descriptionZh: 'GPT Image 2 — OpenAI AI 图片生成',
    protocol: 'openai-image',
    authStyle: 'api_key',
    baseUrl: 'https://api.openai.com/v1',
    defaultEnvOverrides: { OPENAI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gpt-image-2', displayName: 'GPT Image 2' },
      { modelId: 'gpt-image-1.5', displayName: 'GPT Image 1.5' },
      { modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
      { modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini' },
    ],
    fields: ['api_key'],
    category: 'media',
    iconKey: 'openai',
    meta: {
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── OpenAI (Image) Third-party ──
  {
    key: 'openai-image-thirdparty',
    name: 'OpenAI Image Third-party',
    description: 'GPT Image via compatible proxy — provide URL and Key',
    descriptionZh: 'GPT Image 兼容第三方 API — 填写地址和密钥',
    protocol: 'openai-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { OPENAI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gpt-image-2', displayName: 'GPT Image 2' },
      { modelId: 'gpt-image-1.5', displayName: 'GPT Image 1.5' },
      { modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
      { modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini' },
    ],
    fields: ['name', 'api_key', 'base_url'],
    category: 'media',
    iconKey: 'openai',
  },

  // ── BananaRouter (Image) ──
  // Same relay as the chat `bananarouter` preset above, but for the GPT Image 2
  // series. Unlike legacy image relays (e.g. 神马) that expose generation through
  // /v1/chat/completions, BananaRouter speaks the standard OpenAI Images API —
  // hence mediaProtocol: 'openai-images', which image-generator.ts routes via
  // the OpenAI SDK. Default model is gpt-image-2.5-flare (speed-first tier);
  // sunburst is the quality-first tier and gpt-image-2 the base model.
  {
    key: 'bananarouter-image',
    name: 'BananaRouter (Image)',
    description: 'BananaRouter — GPT Image 2 series via the OpenAI Images API',
    descriptionZh: 'BananaRouter 生图 — GPT Image 2 系列（OpenAI Images API）',
    protocol: 'openai-image',
    authStyle: 'api_key',
    baseUrl: 'https://api.bananarouter.com/v1',
    defaultEnvOverrides: {
      OPENAI_API_KEY: '',
      OPENAI_IMAGE_MODEL: 'gpt-image-2.5-flare',
    },
    defaultModels: [
      { modelId: 'gpt-image-2.5-flare', displayName: 'GPT Image 2.5 Flare' },
      { modelId: 'gpt-image-2.5-sunburst', displayName: 'GPT Image 2.5 Sunburst' },
      { modelId: 'gpt-image-2', displayName: 'GPT Image 2' },
    ],
    fields: ['name', 'api_key', 'base_url'],
    category: 'media',
    mediaProtocol: 'openai-images',
    iconKey: 'server',
    meta: {
      apiKeyUrl: 'https://bananarouter.com',
      docsUrl: 'https://bananarouter.com/docs/gpt-image-2',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── Fork: 通用中转平台 (保留 fork 定制) ──
  {
    key: 'custom-media',
    name: '通用中转平台',
    description: 'Custom media relay provider',
    descriptionZh: '通用中转平台 — 自定义 baseurl、apikey、model',
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [],
    fields: ['name', 'api_key', 'base_url', 'model_names'],
    category: 'media',
    iconKey: 'server',
    meta: {
      billingModel: 'self_hosted',
    },
  },
];

// ── Runtime preset validation (fails fast on invalid presets) ───

for (const p of VENDOR_PRESETS) {
  PresetSchema.parse(p);
}

// ── Lookup helpers ──────────────────────────────────────────────

/** Get a preset by key. */
export function getPreset(key: string): VendorPreset | undefined {
  return VENDOR_PRESETS.find(p => p.key === key);
}

/** Get all presets for a given category (defaults to 'chat'). */
export function getPresetsByCategory(category: 'chat' | 'media' = 'chat'): VendorPreset[] {
  return VENDOR_PRESETS.filter(p => (p.category || 'chat') === category);
}

/** All valid Protocol union values — used for raw-field validation. */
export const VALID_PROTOCOLS = new Set<Protocol>([
  'anthropic',
  'openai-compatible',
  'openrouter',
  'bedrock',
  'vertex',
  'google',
  'gemini-image',
  'multi_head',
  'openai-image',
]);

/** Type guard for raw protocol strings coming from API bodies or legacy DB. */
export function isValidProtocol(value: unknown): value is Protocol {
  return typeof value === 'string' && VALID_PROTOCOLS.has(value as Protocol);
}

/**
 * Compute the effective protocol for a provider — prefer the raw protocol
 * field if it's a known Protocol value, otherwise fall back to
 * inferProtocolFromLegacy(provider_type, base_url). Use this everywhere
 * a write path, resolver, or diagnostic needs the "real" protocol: raw
 * provider.protocol can legitimately be '' on legacy rows, and the POST
 * API can see body.protocol === undefined from older clients.
 */
export function getEffectiveProviderProtocol(
  providerType: string,
  protocol: string | undefined,
  baseUrl: string,
): Protocol {
  if (protocol && VALID_PROTOCOLS.has(protocol as Protocol)) {
    return protocol as Protocol;
  }
  return inferProtocolFromLegacy(providerType, baseUrl);
}

/**
 * Infer the protocol from a legacy provider_type.
 * Used during migration from the old system.
 */
export function inferProtocolFromLegacy(
  providerType: string,
  baseUrl: string,
): Protocol {
  // Direct type mappings
  if (providerType === 'anthropic') return 'anthropic';
  if (providerType === 'openrouter') return 'openrouter';
  if (providerType === 'bedrock') return 'bedrock';
  if (providerType === 'vertex') return 'vertex';
  if (providerType === 'gemini-image') return 'gemini-image';
  if (providerType === 'openai-image') return 'openai-image';
  if (providerType === 'generic-image') return 'gemini-image';
  if (providerType === 'cc-switch') return 'anthropic';

  // For 'custom' type, check if the base_url matches a known Anthropic-compatible vendor
  if (providerType === 'custom') {
    const anthropicUrls = [
      'bigmodel.cn', 'z.ai',            // GLM
      'kimi.com', 'moonshot.cn', 'moonshot.ai',  // Kimi/Moonshot
      'minimaxi.com', 'minimax.io',     // MiniMax
      'volces.com', 'volcengine.com',   // Volcengine
      'dashscope.aliyuncs.com',         // Bailian
      'xiaomimimo.com',                 // Xiaomi MiMo
      'localhost:11434',                // Ollama
      '127.0.0.1:8000',                // oLMX
      'localhost:8000',                // oLMX
    ];
    const urlLower = baseUrl.toLowerCase();
    if (anthropicUrls.some(u => urlLower.includes(u))) {
      return 'anthropic';
    }
    // Check if URL contains 'anthropic' in the path
    if (urlLower.includes('/anthropic')) {
      return 'anthropic';
    }
    // Default custom → anthropic (SDK only supports Anthropic-compatible endpoints)
    return 'anthropic';
  }

  return 'anthropic';
}

/**
 * Infer the auth style from a legacy provider.
 * Checks extra_env to determine if it uses AUTH_TOKEN vs API_KEY.
 */
export function inferAuthStyleFromLegacy(
  providerType: string,
  extraEnv: string,
): AuthStyle {
  if (providerType === 'bedrock' || providerType === 'vertex') return 'env_only';

  try {
    const env = JSON.parse(extraEnv || '{}');
    if ('ANTHROPIC_AUTH_TOKEN' in env) return 'auth_token';
  } catch { /* fallthrough */ }

  return 'api_key';
}

/**
 * Find a matching vendor preset for a legacy provider.
 * Matches by base_url first, then by provider_type.
 * When `protocol` is provided, fuzzy (hostname) matching is restricted to
 * presets with the same protocol to avoid misclassifying cross-protocol
 * providers that share the same host (e.g. dashscope OpenAI-compatible vs Bailian Anthropic).
 */
export function findPresetForLegacy(baseUrl: string, providerType: string, protocol?: Protocol): VendorPreset | undefined {
  // Exact base_url match (most specific). When a protocol is supplied, the
  // match must agree with it — otherwise an openai-compatible chat provider
  // configured with https://api.openai.com/v1 would land on the openai-image
  // preset and inherit the GPT Image catalog for chat model selection.
  // Fuzzy match (below) already applies this guard; the exact branch must
  // too, now that multiple presets share the same canonical URL.
  if (baseUrl) {
    // Protocol-aware exact match: when multiple presets share the same canonical URL
    // (e.g. https://api.openai.com/v1 for both openai-compatible chat and openai-image),
    // the protocol must agree to avoid cross-preset catalog pollution.
    const normalizeBaseUrl = (value: string) => value.replace(/\/v1\/?$/i, '').replace(/\/+$/g, '').toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const match = VENDOR_PRESETS.find(p => {
      if (!p.baseUrl || normalizeBaseUrl(p.baseUrl) !== normalizedBaseUrl) return false;
      if (protocol && p.protocol !== protocol) return false;
      return true;
    });
    if (match) return match;

    // Fuzzy match: legacy entries may have old URLs (e.g. minimaxi.com/anthropic
    // before /v1 suffix was added). Match by domain substring against presets.
    const urlLower = baseUrl.toLowerCase();
    const fuzzy = VENDOR_PRESETS.find(p => {
      if (!p.baseUrl) return false;
      if (protocol && p.protocol !== protocol) return false;
      try {
        const presetUrl = new URL(p.baseUrl);
        return urlLower.includes(presetUrl.origin.toLowerCase()) || urlLower.includes(presetUrl.hostname.toLowerCase());
      } catch { return false; }
    });
    if (fuzzy) return fuzzy;
  }

  // Media provider fallbacks: prefer the third-party preset when baseUrl was
  // provided but didn't match the official host (the exact-match branch above
  // already returned the official preset when baseUrl === official).
  if (providerType === 'gemini-image') {
    if (baseUrl) return VENDOR_PRESETS.find(p => p.key === 'gemini-image-thirdparty');
    return VENDOR_PRESETS.find(p => p.key === 'gemini-image');
  }
  if (providerType === 'openai-image') {
    if (baseUrl) return VENDOR_PRESETS.find(p => p.key === 'openai-image-thirdparty');
    return VENDOR_PRESETS.find(p => p.key === 'openai-image');
  }
  // Fork: generic-image fallback
  if (providerType === 'generic-image') return VENDOR_PRESETS.find(p => p.key === 'custom-media');

  return undefined;
}

/**
 * Get the default models for a provider based on its catalog preset.
 * If the provider has a matching preset, returns the preset's defaultModels.
 * Otherwise returns a protocol-appropriate fallback catalog.
 *
 * @param providerType — legacy provider_type string from DB (e.g. 'anthropic',
 *   'bedrock'). Used to disambiguate baseUrl='' cases: a legacy
 *   anthropic-typed provider with an empty baseUrl migrated from older
 *   settings is treated as the official Anthropic endpoint (first-party
 *   catalog), not a generic third-party proxy.
 */
export function getDefaultModelsForProvider(
  protocol: Protocol,
  baseUrl: string,
  providerType?: string,
): CatalogModel[] {
  // Try to find a preset by exact base_url. Protocol must agree — otherwise
  // an openai-compatible chat provider configured with
  // https://api.openai.com/v1 would match the openai-image preset and
  // inherit the GPT Image catalog for chat model selection.
  const normalizeBaseUrl = (value: string) => value.replace(/\/v1\/?$/i, '').replace(/\/+$/g, '').toLowerCase();
  const preset = VENDOR_PRESETS.find(
    p => p.baseUrl && normalizeBaseUrl(p.baseUrl) === normalizeBaseUrl(baseUrl) && p.protocol === protocol,
  );
  if (preset) {
    // Preset matched — return its models even if empty (e.g. Volcengine
    // requires users to specify their own model names, so defaultModels is []).
    return preset.defaultModels;
  }

  // Fuzzy match: legacy providers may have old URLs (e.g. minimaxi.com/anthropic/v1
  // before the /v1 suffix was removed). Match by domain substring against presets,
  // but only when the protocol matches to avoid misclassifying custom OpenAI-compatible
  // providers that share the same host (e.g. dashscope.aliyuncs.com/compatible-mode/v1).
  if (baseUrl) {
    const urlLower = baseUrl.toLowerCase();
    const fuzzy = VENDOR_PRESETS.find(p => {
      if (!p.baseUrl || p.protocol !== protocol) return false;
      try {
        const presetUrl = new URL(p.baseUrl);
        return urlLower.includes(presetUrl.origin.toLowerCase()) || urlLower.includes(presetUrl.hostname.toLowerCase());
      } catch { return false; }
    });
    if (fuzzy) return fuzzy.defaultModels;
  }

  // Legacy first-party Anthropic: migrated Default providers have
  // provider_type='anthropic' with base_url=''. The native runtime
  // treats them as the official @ai-sdk/anthropic endpoint, so they
  // must resolve opus to the concrete claude-opus-4-7 upstream (same
  // as the anthropic-official preset). Without this branch they'd
  // fall through to the alias-only catalog and bypass the 4.7
  // sanitizer, 1M context, and xhigh metadata.
  if (protocol === 'anthropic' && !baseUrl && providerType === 'anthropic') {
    return ANTHROPIC_FIRST_PARTY_MODELS;
  }

  // Protocol-based defaults (only when no preset matched).
  // Bedrock/Vertex get the alias-only catalog with Opus 4.6 labels because
  // their DB-backed provider has baseUrl='' and the preset match above
  // never fires. Without this branch, they'd fall through to the shared
  // Anthropic catalog and mis-resolve opus as first-party Opus 4.7.
  if (protocol === 'bedrock' || protocol === 'vertex') {
    return BEDROCK_VERTEX_DEFAULT_MODELS;
  }
  if (protocol === 'anthropic' || protocol === 'openrouter') {
    return ANTHROPIC_DEFAULT_MODELS;
  }
  // Media protocols: a third-party provider pointing at a custom proxy URL
  // won't match an exact or fuzzy host, so fall back to the third-party
  // preset's default catalog to surface the standard GPT Image / Nano Banana
  // model list in the settings UI.
  if (protocol === 'gemini-image') {
    const p = VENDOR_PRESETS.find(x => x.key === 'gemini-image-thirdparty');
    return p?.defaultModels ?? [];
  }
  if (protocol === 'openai-image') {
    const p = VENDOR_PRESETS.find(x => x.key === 'openai-image-thirdparty');
    return p?.defaultModels ?? [];
  }

  return [];
}
