export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet': 200000,
  'opus': 200000,
  'haiku': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'qwen3.6-plus': 1000000,
  'qwen3.6-plus-2026-04-02': 1000000,
  'qwen3.5-plus': 1000000,
  'qwen3.5-plus-2026-02-15': 1000000,
  'qwen3-coder-plus': 1000000,
  'qwen3-coder-plus-2025-09-23': 1000000,
  'qwen3-coder-plus-2025-07-22': 1000000,
  'qwen3-coder-next': 262144,
};

export function getContextWindow(
  model: string,
  options?: { context1m?: boolean },
): number | null {
  const normalizedModel = model.toLowerCase();
  const base = MODEL_CONTEXT_WINDOWS[normalizedModel]
    ?? MODEL_CONTEXT_WINDOWS[Object.keys(MODEL_CONTEXT_WINDOWS).find(k => normalizedModel.includes(k)) ?? '']
    ?? null;
  if (base === null) return null;
  // When 1M context beta is enabled, all supported models get 1M window
  if (options?.context1m) return 1_000_000;
  return base;
}
