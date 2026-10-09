/**
 * types.ts — Anthropic Messages API types for the ClaudeCodeCompat adapter.
 *
 * These match the wire format that Claude Code sends to proxy APIs.
 * Ref: Claude Code services/api/claude.ts
 */
// ── Finish Reason Mapping ───────────────────────────────────────
export function mapFinishReason(stopReason) {
    const raw = stopReason;
    switch (stopReason) {
        case 'end_turn': return { unified: 'stop', raw };
        case 'tool_use': return { unified: 'tool-calls', raw };
        case 'max_tokens': return { unified: 'length', raw };
        case 'stop_sequence': return { unified: 'stop', raw };
        default: return { unified: 'other', raw };
    }
}
