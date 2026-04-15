/**
 * runtime/registry.ts — Runtime registration and resolution.
 *
 * Keeps a Map of available runtimes. resolveRuntime() picks the best one
 * based on user settings and availability.
 */

import type { AgentRuntime } from './types';
import { getSetting, getAllProviders, getProvider } from '@/lib/db';
import { hasClaudeSettingsCredentials } from '@/lib/claude-settings';

const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return runtimes.get(id);
}

export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}

export function getAvailableRuntimes(): AgentRuntime[] {
  return getAllRuntimes().filter(r => r.isAvailable());
}

/**
 * Check if Anthropic-compatible credentials exist (for auto-mode SDK preference).
 * This is intentionally broad — CLI manages its own auth in many ways.
 */
/**
 * Check if any provider credentials exist for the SDK subprocess.
 *
 * All CodePilot providers except OpenAI OAuth are CLI-compatible —
 * toClaudeCodeEnv() injects them as ANTHROPIC_* env vars. The only
 * provider the CLI can't use (OpenAI OAuth / Codex) is already
 * handled separately in claude-client.ts (force native).
 *
 * This check prevents auto mode from selecting SDK when the user
 * has zero credentials configured (#456).
 */
/**
 * Check if the request's provider has credentials the SDK can use.
 * When providerId is 'env' or empty, only checks env vars / legacy DB.
 * When providerId points to a DB provider, checks that specific provider.
 * When no providerId, checks all providers (any credential = true).
 */
export function hasCredentialsForRequest(providerId?: string): boolean {
  // Env vars and legacy DB — always checked, regardless of provider scope
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  if (getSetting('anthropic_auth_token')) return true;

  // ── Provider-group ownership rule ───────────────────────────────────────
  // ~/.claude/settings.json (cc-switch / hand-edited) is the credential source
  // for the BUILT-IN "Claude Code" group only — providerId === 'env' or no
  // provider explicitly chosen. For an explicit DB provider, this file MUST
  // NOT supply credentials: the user picked Kimi/GLM/OpenRouter precisely
  // because they want THAT provider's auth, not whatever cc-switch wrote.
  // See docs/exec-plans/active/cc-switch-credential-bridge.md §"凭据归属".

  // Specific DB provider requested: only its own credentials count.
  if (providerId && providerId !== 'env') {
    try {
      const p = getProvider(providerId);
      if (p?.api_key) return true;
      if (p?.extra_env?.includes('CLAUDE_CODE_USE_BEDROCK')) return true;
      if (p?.extra_env?.includes('CLAUDE_CODE_USE_VERTEX')) return true;
      if (p) return false; // provider exists but has no credentials — DO NOT fall back to settings.json
      // provider doesn't exist (stale binding) → fall through to env-scope checks
    } catch { /* DB not ready */ }
  }

  // 'env' group OR no provider specified: settings.json IS a valid credential
  // source (cc-switch users without a CodePilot DB provider).
  if (hasClaudeSettingsCredentials()) return true;

  // 'env' provider explicitly: only env-scope credentials matter (checked above)
  if (providerId === 'env') return false;

  // No provider specified — check all DB providers (session-level resolution
  // may pick any of them). This is the legitimate "auto-pick something usable"
  // fallback before we land in the env group.
  try {
    for (const p of getAllProviders()) {
      if (p.api_key) return true;
      if (p.extra_env?.includes('CLAUDE_CODE_USE_BEDROCK')) return true;
      if (p.extra_env?.includes('CLAUDE_CODE_USE_VERTEX')) return true;
    }
  } catch { /* DB not ready */ }
  return false;
}

/**
 * Pick the runtime to use for a given request.
 *
 * Priority:
 * 0. cli_enabled=false → ALWAYS use native (highest-priority constraint)
 * 1. Explicit override (from function arg or per-session setting)
 * 2. Global user setting (agent_runtime)
 * 3. Auto: native if available, else claude-code-sdk
 */
export function resolveRuntime(overrideId?: string, providerId?: string): AgentRuntime {
  // 0. cli_enabled=false is an absolute constraint — never return SDK
  const cliDisabled = getSetting('cli_enabled') === 'false';

  if (cliDisabled) {
    const native = getRuntime('native');
    if (native) return native;
    throw new Error('Native runtime not registered but CLI is disabled. This is a bug.');
  }

  // 1. Explicit override
  if (overrideId && overrideId !== 'auto') {
    const r = getRuntime(overrideId);
    if (r?.isAvailable()) return r;
  }

  // 2. Global setting
  const settingId = getSetting('agent_runtime');
  if (settingId && settingId !== 'auto') {
    const r = getRuntime(settingId);
    if (r?.isAvailable()) return r;
  }

  // 3. Auto: prefer SDK only if CLI exists AND Anthropic credentials are available.
  //    Without Anthropic creds (e.g. user only has GLM/OpenAI), SDK subprocess
  //    will fail — use native runtime instead (#456).
  //    Note: isAvailable() only checks CLI binary. The credential check is here
  //    because CLI manages its own auth in many ways (OAuth, env, provider),
  //    and we only need this guard for AUTO mode, not explicit selection.
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable() && hasCredentialsForRequest(providerId)) return sdk;

  const native = getRuntime('native');
  if (native?.isAvailable()) return native;

  // Last resort: return native even if "unavailable" — it only needs an API key,
  // and will produce a clear error message if credentials are missing.
  if (native) return native;

  throw new Error('No agent runtime registered. This is a bug — please report it.');
}

/**
 * Predict whether the native runtime will be used for a given request.
 *
 * This mirrors resolveRuntime() logic WITHOUT actually instantiating the runtime,
 * so callers (chat route, bridge) can prepare the right MCP config upfront.
 *
 * @param providerId - The provider for this request ('openai-oauth' forces native)
 */
export function predictNativeRuntime(providerId?: string): boolean {
  // Non-Anthropic providers always force native
  if (providerId === 'openai-oauth') return true;

  // cli_enabled=false → always native
  if (getSetting('cli_enabled') === 'false') return true;

  // Explicit setting — but verify SDK is actually usable
  const settingId = getSetting('agent_runtime');
  if (settingId === 'native') return true;
  if (settingId === 'claude-code-sdk') {
    // If CLI doesn't exist, explicit selection will fallback to native at runtime
    const sdk = getRuntime('claude-code-sdk');
    return !sdk?.isAvailable();
  }

  // Auto: prefer SDK if CLI exists AND has Anthropic credentials
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable() && hasCredentialsForRequest(providerId)) return false;

  return true; // SDK not available or no Anthropic creds → native
}
