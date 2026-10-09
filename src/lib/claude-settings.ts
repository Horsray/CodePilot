/**
 * claude-settings.ts — Read Anthropic credentials from ~/.claude/settings.json.
 *
 * External tools (notably cc-switch, but also any user who manually edits the
 * file) manage Claude Code CLI credentials by writing an `env` block in
 * ~/.claude/settings.json. CodePilot reads a narrow allowlist from that env
 * block and injects it into Claude Code subprocesses explicitly, so the fast
 * SDK path does not need to enable user settingSources (which would also load
 * every user MCP server, plugin, hook, and permission before first response).
 *
 * CodePilot's runtime resolver needs the same visibility so auto mode can
 * pick the SDK runtime (instead of falling back to native, which cannot read
 * this file at all).
 *
 * This reader is intentionally tiny and dependency-free, and silently returns
 * null on any error — callers must be resilient to a missing file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeSettingsCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

const CLAUDE_SETTINGS_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_REASONING_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const;

export type ClaudeSettingsEnvKey = typeof CLAUDE_SETTINGS_ENV_KEYS[number];

/**
 * Read ~/.claude/settings.json (or legacy ~/.claude/claude.json) and extract
 * the Anthropic credential fields from its `env` block.
 *
 * Returns null when no file exists, the file is unparseable, or no auth-
 * related fields are present. Non-empty strings are preserved as-is.
 */
export function readClaudeSettingsCredentials(): ClaudeSettingsCredentials | null {
  const env = readClaudeSettingsEnv();
  if (!env) return null;

  const apiKey = env.ANTHROPIC_API_KEY;
  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = env.ANTHROPIC_BASE_URL;

  if (!apiKey && !authToken && !baseUrl) return null;
  return { apiKey, authToken, baseUrl };
}

/**
 * Read the Claude Code settings env block, restricted to auth and model
 * routing keys that CodePilot can safely pass to a subprocess without loading
 * plugins/MCP/hooks through SDK settingSources.
 */
export function readClaudeSettingsEnv(): Partial<Record<ClaudeSettingsEnvKey, string>> | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'claude.json'), // legacy name still used by some cc-switch installs
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      const env = parsed?.env;
      if (!env || typeof env !== 'object') continue;

      const picked: Partial<Record<ClaudeSettingsEnvKey, string>> = {};
      for (const key of CLAUDE_SETTINGS_ENV_KEYS) {
        const v = env[key];
        if (typeof v === 'string' && v.length > 0) picked[key] = v;
      }

      if (Object.keys(picked).length === 0) continue;
      return picked;
    } catch {
      // Unreadable / malformed / permission-denied — treat as absent and try next file.
    }
  }

  return null;
}

/**
 * Quick boolean check: does the user have cc-switch / external-managed
 * Anthropic credentials in their ~/.claude/settings.json?
 *
 * Equivalent to `!!readClaudeSettingsCredentials()?.authToken ||
 * !!readClaudeSettingsCredentials()?.apiKey` but expresses intent more clearly.
 */
export function hasClaudeSettingsCredentials(): boolean {
  const creds = readClaudeSettingsCredentials();
  return !!(creds?.apiKey || creds?.authToken);
}
