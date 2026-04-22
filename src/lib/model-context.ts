// Opus 4.7 默认提供 1M 上下文窗口（无需 beta 标头）；
// Opus 4.6（claude-opus-4-20250514）仍需 context-1m-2025-08-07 才能
// 达到 1M。其他 4.x 模型默认为 200K。
//
// `opus` 别名故意保持为 200K（Opus 4.6 语义）。
// 知道已解析上游模型的调用者必须通过 `upstream` 选项将其传递给
// getContextWindow，这样第一方会话（解析为 claude-opus-4-7）获得 1M 窗口，
// 而 Bedrock/Vertex 会话（其中 opus 仍解析为 4.6）保持为 200K。
// 这避免了之前所有 `opus` 查找都被预算为 1M 的错误，该错误高估了 Bedrock/Vertex 约 5 倍。
  export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet': 200000,
  'opus': 200000,
  'haiku': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-opus-4-7': 1_000_000,
  'claude-haiku-4-5-20251001': 200000,
  'qwen3.6-plus': 1000000,
  'qwen3.6-plus-2026-04-02': 1000000,
  'qwen3.5-plus': 1000000,
  'qwen3.5-plus-2026-02-15': 1000000,
  'qwen3-coder-plus': 1000000,
  'qwen3-coder-plus-2025-09-23': 1000000,
  'qwen3-coder-plus-2025-07-22': 1000000,
  'qwen3-coder-next': 262144,
  'qwen3.5-flash': 1000000,
  'kimi-k2.5': 262144,
  'kimi-k2.6': 262144,
  'glm-5': 202752,
  'glm-4.7': 169984,
  'minimax-m2.7': 204800,
  'minimax-m2.5': 196608,
  'qwen3.6-35B-A3B-8bit': 262144,
  // Qwen3.6-35B-A3B-bf16：原生支持 262,144 tokens（约 256K）上下文窗口
  'qwen3.6-35B-A3B-bf16': 262144,
  'Step3.5-Flash-mixed-2-8bit': 262144,

};

// 按长度降序排列的子字符串回退键，使带供应商前缀或日期后缀的上游名称
//（例如 'us.anthropic.claude-opus-4-7-v1:0'）优先匹配 'claude-opus-4-7' 而非 'opus'。
// 若不如此，插入顺序会让短别名 'opus'（200K）胜出，从而丢失真正的 1M 窗口。
const CONTEXT_LOOKUP_KEYS_BY_LENGTH = Object.keys(MODEL_CONTEXT_WINDOWS)
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * 先尝试精确匹配单个键，然后尝试最长后缀子字符串匹配。
 * 当两种策略都找不到时返回 null，以便调用者可以用 ?? 链接到不同的键。
 */
function resolveWindow(key: string): number | null {
  if (!key) return null;
  const normalizedKey = key.toLowerCase();
  if (MODEL_CONTEXT_WINDOWS[normalizedKey] != null) return MODEL_CONTEXT_WINDOWS[normalizedKey];
  const match = CONTEXT_LOOKUP_KEYS_BY_LENGTH.find(k => normalizedKey.includes(k));
  return match ? MODEL_CONTEXT_WINDOWS[match] : null;
}

export function getContextWindow(
  model: string,
  options?: { context1m?: boolean; upstream?: string },
): number | null {
  // Prefer the upstream model ID when known — it unambiguously selects
  // between alias variants (e.g. `opus` on first-party Anthropic is
  // claude-opus-4-7 but on Bedrock/Vertex it's Opus 4.6). Fall through
  // to the model alias when upstream is absent OR when it resolves
  // to nothing (e.g. unknown vendor-prefixed name that doesn't substring-
  // match any known key).
  const base = (options?.upstream ? resolveWindow(options.upstream) : null)
    ?? resolveWindow(model);
  if (base === null) return null;
  // When 1M context beta is enabled, all supported models get 1M window.
  // (Opus 4.7 already defaults to 1M so the toggle is a no-op there.)
  if (options?.context1m) return 1_000_000;
  return base;
}
