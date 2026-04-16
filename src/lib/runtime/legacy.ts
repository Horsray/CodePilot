/**
 * runtime/legacy.ts — Translate any persisted `agent_runtime` value to the
 * concrete two-state runtime (0.50.3+).
 */

export type ConcreteRuntime = 'native' | 'claude-code-sdk';

export function isConcreteRuntime(v: unknown): v is ConcreteRuntime {
  return v === 'native' || v === 'claude-code-sdk';
}

export function resolveLegacyRuntimeForDisplay(
  saved: string | undefined | null,
  cliConnected: boolean,
): ConcreteRuntime {
  if (isConcreteRuntime(saved)) return saved;
  return cliConnected ? 'claude-code-sdk' : 'native';
}
