// Opus 4.7 ships a default 1M context window (no beta header required);
// Opus 4.6 (claude-opus-4-20250514) still needs context-1m-2025-08-07 to
// reach 1M. Other 4.x models default to 200K.
//
// The `opus` alias is ambiguous — it resolves to Opus 4.7 on first-party
// Anthropic but Opus 4.6 on Bedrock/Vertex. We bias the alias to the
// first-party value (1M) since that's where new sessions default; Bedrock/
// Vertex sessions that rely on this metadata will over-estimate their
// window by ~5× until the resolver wires upstreamModelId into
// getContextWindow. Tracked as tech-debt for the provider-aware
// context-budget follow-up.
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet': 200000,
  'opus': 1_000_000,
  'haiku': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-opus-4-7': 1_000_000,
  'claude-haiku-4-5-20251001': 200000,
};

export function getContextWindow(
  model: string,
  options?: { context1m?: boolean },
): number | null {
  const base = MODEL_CONTEXT_WINDOWS[model]
    ?? MODEL_CONTEXT_WINDOWS[Object.keys(MODEL_CONTEXT_WINDOWS).find(k => model.includes(k)) ?? '']
    ?? null;
  if (base === null) return null;
  // When 1M context beta is enabled, all supported models get 1M window
  if (options?.context1m) return 1_000_000;
  return base;
}
