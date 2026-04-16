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
  | 'gemini-image';       // Google Gemini image generation

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
  protocol: z.enum(['anthropic', 'openai-compatible', 'openrouter', 'bedrock', 'vertex', 'google', 'gemini-image']),
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
    }).optional(),
  })),
  fields: z.array(z.string()),
  iconKey: z.string(),
  sdkProxyOnly: z.boolean().optional(),
  category: z.enum(['chat', 'media']).optional(),
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

const ANTHROPIC_DEFAULT_MODELS: CatalogModel[] = [
  { modelId: 'sonnet', displayName: 'Sonnet 4.6', role: 'sonnet' },
  { modelId: 'opus', displayName: 'Opus 4.6', role: 'opus' },
  { modelId: 'haiku', displayName: 'Haiku 4.5', role: 'haiku' },
];

// ── Vendor presets ──────────────────────────────────────────────

export const VENDOR_PRESETS: VendorPreset[] = [
  // ── Official Anthropic ──
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    description: 'Official Anthropic API',
    descriptionZh: 'Anthropic 官方 API',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'https://api.anthropic.com',
    defaultEnvOverrides: {},
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['api_key'],
    iconKey: 'anthropic',
    meta: {
      apiKeyUrl: 'https://platform.claude.com/settings/keys',
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── Anthropic Third-party (generic) ──
  {
    key: 'anthropic-thirdparty',
    name: 'Anthropic Third-party API',
    description: 'Anthropic-compatible API — provide URL and Key',
    descriptionZh: 'Anthropic 兼容第三方 API — 填写地址和密钥',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { ANTHROPIC_API_KEY: '' },
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['name', 'api_key', 'base_url', 'model_mapping', 'env_overrides'],
    iconKey: 'anthropic',
  },

  // ── OpenRouter ──
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Use OpenRouter to access multiple models',
    descriptionZh: '通过 OpenRouter 访问多种模型',
    protocol: 'openrouter',
    authStyle: 'auth_token',
    baseUrl: 'https://openrouter.ai/api',
    defaultEnvOverrides: {},
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['api_key'],
    iconKey: 'openrouter',
    meta: {
      apiKeyUrl: 'https://openrouter.ai/workspaces/default/keys',
      docsUrl: 'https://openrouter.ai/docs/guides/coding-agents/claude-code-integration',
      billingModel: 'pay_as_you_go',
    },
  },

  // ── Zhipu GLM (China) ──
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    description: 'Zhipu GLM Code Plan — China region',
    descriptionZh: '智谱 GLM 编程套餐 — 中国区',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultEnvOverrides: { API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5-turbo', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1' },
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'sonnet', displayName: 'GLM-5-Turbo', role: 'sonnet' },
      { modelId: 'opus', upstreamModelId: 'opus', displayName: 'GLM-5.1', role: 'opus' },
      { modelId: 'haiku', upstreamModelId: 'haiku', displayName: 'GLM-4.5-Air', role: 'haiku' },
    ],
    fields: ['api_key'],
    iconKey: 'zhipu',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/tool/claude',
      billingModel: 'coding_plan',
      notes: ['高峰时段（14:00-18:00 UTC+8）消耗 3 倍积分'],
    },
  },

  // ── Zhipu GLM (Global) ──
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan — Global region',
    descriptionZh: '智谱 GLM 编程套餐 — 国际区',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.z.ai/api/anthropic',
    defaultEnvOverrides: { API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5-turbo', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1' },
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'sonnet', displayName: 'GLM-5-Turbo', role: 'sonnet' },
      { modelId: 'opus', upstreamModelId: 'opus', displayName: 'GLM-5.1', role: 'opus' },
      { modelId: 'haiku', upstreamModelId: 'haiku', displayName: 'GLM-4.5-Air', role: 'haiku' },
    ],
    fields: ['api_key'],
    iconKey: 'zhipu',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
      docsUrl: 'https://docs.z.ai/devpack/tool/claude',
      billingModel: 'coding_plan',
      notes: ['高峰时段（14:00-18:00 UTC+8）消耗 3 倍积分'],
    },
  },

  // ── Kimi ──
  {
    key: 'kimi',
    name: 'Kimi Coding Plan',
    description: 'Kimi Coding Plan API',
    descriptionZh: 'Kimi 编程计划 API',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'https://api.kimi.com/coding/',
    defaultEnvOverrides: { ENABLE_TOOL_SEARCH: 'false' },
    defaultModels: [
      { modelId: 'sonnet', displayName: 'Kimi K2.5', role: 'default' },
    ],
    fields: ['api_key'],
    iconKey: 'kimi',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://www.kimi.com/code/console',
      docsUrl: 'https://www.kimi.com/code/docs/more/third-party-agents.html',
      billingModel: 'pay_as_you_go',
      notes: [],
    },
  },

  // ── Moonshot ──
  {
    key: 'moonshot',
    name: 'Moonshot',
    description: 'Moonshot AI API',
    descriptionZh: '月之暗面 API',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultEnvOverrides: { ENABLE_TOOL_SEARCH: 'false' },
    defaultModels: [
      { modelId: 'sonnet', displayName: 'Kimi K2.5', role: 'default' },
    ],
    fields: ['api_key'],
    iconKey: 'moonshot',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
      docsUrl: 'https://platform.moonshot.cn/docs/guide/agent-support',
      billingModel: 'pay_as_you_go',
      notes: ['建议设置每日消费上限，防止 agentic 循环快速消耗 token'],
    },
  },

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
      { modelId: 'MiniMax-M2.7', upstreamModelId: 'MiniMax-M2.7', displayName: 'MiniMax-M2.7', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M2.7',
      sonnet: 'MiniMax-M2.7',
      opus: 'MiniMax-M2.7',
      haiku: 'MiniMax-M2.7',
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
      { modelId: 'MiniMax-M2.7', upstreamModelId: 'MiniMax-M2.7', displayName: 'MiniMax-M2.7', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M2.7',
      sonnet: 'MiniMax-M2.7',
      opus: 'MiniMax-M2.7',
      haiku: 'MiniMax-M2.7',
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

  // ── Volcengine Ark ──
  {
    key: 'volcengine',
    name: 'Volcengine Ark',
    description: 'Volcengine Ark Coding Plan — Doubao, GLM, DeepSeek, Kimi',
    descriptionZh: '字节火山方舟 Coding Plan — 豆包、GLM、DeepSeek、Kimi',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    defaultEnvOverrides: {},
    defaultModels: [],  // User must specify model_names
    fields: ['api_key', 'model_names'],
    iconKey: 'volcengine',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement',
      docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
      billingModel: 'coding_plan',
      notes: ['需先在控制台激活 Endpoint', 'API Key 为临时凭证'],
    },
  },

  // ── Xiaomi MiMo (按量付费) ──
  {
    key: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo Pay-as-you-go API — MiMo-V2-Pro',
    descriptionZh: '小米 MiMo 按量付费 — MiMo-V2-Pro',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'mimo-v2-pro', displayName: 'MiMo-V2-Pro', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'mimo-v2-pro',
      sonnet: 'mimo-v2-pro',
      opus: 'mimo-v2-pro',
      haiku: 'mimo-v2-pro',
    },
    fields: ['api_key'],
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
    description: 'Xiaomi MiMo Token Plan subscription — MiMo-V2-Pro',
    descriptionZh: '小米 MiMo Token Plan 订阅套餐 — MiMo-V2-Pro',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'mimo-v2-pro', displayName: 'MiMo-V2-Pro', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'mimo-v2-pro',
      sonnet: 'mimo-v2-pro',
      opus: 'mimo-v2-pro',
      haiku: 'mimo-v2-pro',
    },
    fields: ['api_key'],
    iconKey: 'xiaomi-mimo',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      docsUrl: 'https://platform.xiaomimimo.com/#/docs/integration/claudecode',
      billingModel: 'token_plan',
      notes: [],
    },
  },

  // ── Aliyun Bailian ──
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    description: 'Aliyun Bailian Coding Plan — Qwen, GLM, Kimi, MiniMax',
    descriptionZh: '阿里云百炼 Coding Plan — 通义千问、GLM、Kimi、MiniMax',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'qwen3.6-plus', displayName: 'Qwen 3.6 Plus', role: 'default' },
      { modelId: 'qwen3-coder-next', displayName: 'Qwen 3 Coder Next' },
      { modelId: 'qwen3-coder-plus', displayName: 'Qwen 3 Coder Plus' },
      { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
      { modelId: 'glm-5', displayName: 'GLM-5' },
      { modelId: 'glm-4.7', displayName: 'GLM-4.7' },
      { modelId: 'MiniMax-M2.5', displayName: 'MiniMax-M2.5' },
    ],
    fields: ['api_key'],
    iconKey: 'bailian',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://bailian.console.aliyun.com',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      billingModel: 'coding_plan',
      notes: ['必须使用 Coding Plan 专用 Key（以 sk-sp- 开头）', '普通 DashScope Key 无法使用', '禁止用于自动化脚本'],
    },
  },

  // ── AWS Bedrock ──
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — requires AWS credentials',
    descriptionZh: 'Amazon Bedrock — 需要 AWS 凭证',
    protocol: 'bedrock',
    authStyle: 'env_only',
    baseUrl: '',
    defaultEnvOverrides: {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    },
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['env_overrides'],
    iconKey: 'bedrock',
    meta: {
      apiKeyUrl: 'https://console.aws.amazon.com',
      docsUrl: 'https://aws.amazon.com/cn/bedrock/anthropic/',
      billingModel: 'pay_as_you_go',
      notes: ['需在 AWS Console 订阅 Claude 模型'],
    },
  },

  // ── Google Vertex AI ──
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI — requires GCP credentials',
    descriptionZh: 'Google Vertex AI — 需要 GCP 凭证',
    protocol: 'vertex',
    authStyle: 'env_only',
    baseUrl: '',
    defaultEnvOverrides: {
      CLAUDE_CODE_USE_VERTEX: '1',
      CLOUD_ML_REGION: 'us-east5',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
    },
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['env_overrides'],
    iconKey: 'google',
    meta: {
      docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude',
      billingModel: 'pay_as_you_go',
      notes: ['需启用 Vertex AI 并在 Model Garden 订阅 Claude 模型'],
    },
  },

  // ── Ollama ──
  {
    key: 'ollama',
    name: 'Ollama',
    description: 'Ollama — run local models with Anthropic-compatible API',
    descriptionZh: 'Ollama — 本地运行模型，Anthropic 兼容 API',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'http://localhost:11434',
    defaultEnvOverrides: {
      ANTHROPIC_AUTH_TOKEN: 'ollama',  // Fixed pseudo-token for Ollama (no real auth needed)
    },
    defaultModels: [],  // User must specify — depends on pulled models
    fields: ['base_url', 'model_names'],
    iconKey: 'ollama',
    sdkProxyOnly: true,
    meta: {
      docsUrl: 'https://docs.ollama.com/integrations/claude-code',
      billingModel: 'free',
      notes: ['需要本地安装 Ollama 并拉取模型'],
    },
  },

  // ── LiteLLM ──
  {
    key: 'litellm',
    name: 'LiteLLM',
    description: 'LiteLLM proxy — local or remote',
    descriptionZh: 'LiteLLM 代理 — 本地或远程',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'http://localhost:4000',
    defaultEnvOverrides: {},
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['api_key', 'base_url'],
    iconKey: 'server',
    meta: {
      docsUrl: 'https://docs.litellm.ai/docs/',
      billingModel: 'self_hosted',
    },
  },

  // ── oLMX (Local) ──
  {
    key: 'olmx',
    name: 'oLMX',
    description: 'oLMX — run local Anthropic-compatible models',
    descriptionZh: 'oLMX — 本地运行 Anthropic 兼容模型',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'http://127.0.0.1:8000',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'Qwen3.5-35B-A3B-8bit', displayName: 'Qwen 3.5 35B' },
    ],
    fields: ['name', 'api_key', 'base_url', 'model_names'],
    iconKey: 'server',
    meta: {
      billingModel: 'self_hosted',
      notes: ['需要本地运行 oLMX 实例', '默认地址为 http://127.0.0.1:8000'],
    },
  },

  {
    key: 'cc-switch',
    name: 'CC Switch',
    description: 'Use CC Switch profile as an independent provider',
    descriptionZh: '将 CC Switch 配置作为独立服务商接入',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: '',
    defaultEnvOverrides: {},
    defaultModels: [],
    fields: ['name', 'api_key', 'base_url', 'model_names', 'model_mapping'],
    iconKey: 'anthropic',
    sdkProxyOnly: true,
    meta: {
      billingModel: 'self_hosted',
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

  {
    key: 'custom-media',
    name: '通用中转平台',
    description: 'Custom media relay provider',
    descriptionZh: '通用中转平台 — 自定义 baseurl、apikey、model',
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gemini-3.1-flash-image-preview', displayName: 'Default Model' },
    ],
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
  // Exact base_url match (most specific)
  if (baseUrl) {
    const normalizeBaseUrl = (value: string) => value.replace(/\/v1\/?$/i, '').replace(/\/+$/g, '').toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const match = VENDOR_PRESETS.find(p => p.baseUrl && normalizeBaseUrl(p.baseUrl) === normalizedBaseUrl);
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

  // Type-based fallback
  if (providerType === 'bedrock') return VENDOR_PRESETS.find(p => p.key === 'bedrock');
  if (providerType === 'vertex') return VENDOR_PRESETS.find(p => p.key === 'vertex');
  if (providerType === 'openrouter') return VENDOR_PRESETS.find(p => p.key === 'openrouter');
  if (providerType === 'gemini-image') return VENDOR_PRESETS.find(p => p.key === 'gemini-image');
  if (providerType === 'generic-image') return VENDOR_PRESETS.find(p => p.key === 'custom-media');
  if (providerType === 'cc-switch') return VENDOR_PRESETS.find(p => p.key === 'cc-switch');
  if (providerType === 'anthropic' && baseUrl === 'https://api.anthropic.com') {
    return VENDOR_PRESETS.find(p => p.key === 'anthropic-official');
  }

  return undefined;
}

/**
 * Get the default models for a provider based on its catalog preset.
 * If the provider has a matching preset, returns the preset's defaultModels.
 * Otherwise returns the Anthropic default models.
 */
export function getDefaultModelsForProvider(
  protocol: Protocol,
  baseUrl: string,
): CatalogModel[] {
  // Try to find a preset by exact base_url
  const normalizeBaseUrl = (value: string) => value.replace(/\/v1\/?$/i, '').replace(/\/+$/g, '').toLowerCase();
  const preset = VENDOR_PRESETS.find(p => p.baseUrl && normalizeBaseUrl(p.baseUrl) === normalizeBaseUrl(baseUrl));
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

  // Protocol-based defaults (only when no preset matched)
  if (protocol === 'anthropic' || protocol === 'openrouter' || protocol === 'bedrock' || protocol === 'vertex') {
    return ANTHROPIC_DEFAULT_MODELS;
  }

  return [];
}
