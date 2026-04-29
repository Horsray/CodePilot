/**
 * runtime/legacy.ts — Absorb old persisted `agent_runtime` values into the
 * single supported Claude Code CLI runtime.
 *
 * Why this exists:
 *   历史上 `agent_runtime` 可能存过 'auto' / 'native' / 'claude-code-sdk'。
 *   现在产品只支持 Claude Code CLI，因此这里的职责只剩“兜底归一化”：
 *   不论旧值和 CLI 状态如何，界面显示与迁移结果都统一收敛到 `claude-code-sdk`。
 */

export type ConcreteRuntime = 'native' | 'claude-code-sdk';

export function isConcreteRuntime(v: unknown): v is ConcreteRuntime {
  return v === 'native' || v === 'claude-code-sdk';
}

/**
 * Coerce any stored runtime value to a concrete runtime for display /
 * migration purposes. Rules:
 *   - 'claude-code-sdk' → 'claude-code-sdk'   (user's explicit choice)
 *   - 'native'          → 'native'            (user's explicit choice)
 *   - 'auto' / null / undefined / anything else → environment-driven:
 *                          cliConnected ? 'claude-code-sdk' : 'native'
 *
 * `cliConnected` must come from a real /api/claude-status read. Passing a
 * pessimistic default (false) while the status is still loading will silently
 * migrate Claude Code users to Native — callers should either await status
 * resolution or gate the persistence step, and only use this for local
 * display when status is unknown.
 */
export function resolveLegacyRuntimeForDisplay(
  saved: string | undefined | null,
  _cliConnected: boolean,
  _cliEnabled = true,
): ConcreteRuntime {
  if (saved === 'claude-code-sdk') return 'claude-code-sdk';
  return 'claude-code-sdk';
}
