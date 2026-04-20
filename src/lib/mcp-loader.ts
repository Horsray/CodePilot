/**
 * MCP Server Loader — shared module for loading MCP server configurations.
 *
 * CodePilot does not let the SDK auto-load every MCP server during chat
 * startup. We manually pass either CodePilot-processed servers or a small
 * on-demand subset selected for the current request.
 *
 * This eliminates redundant config passing and reduces initialization overhead.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MCPServerConfig } from '@/types';
import { getSetting } from '@/lib/db';

// ── Cache ────────────────────────────────────────────────────────────

interface CachedMcpConfig {
  allServers: Record<string, MCPServerConfig>;
  codepilotServers: Record<string, MCPServerConfig>; // Only servers with resolved ${...} placeholders
  timestamp: number;
  projectCwd: string;
}

const CACHE_TTL_MS = 30_000; // 30 seconds
let _cache: CachedMcpConfig | null = null;

/** Invalidate the cache (e.g., after adding/removing a server via UI). */
export function invalidateMcpCache(): void {
  _cache = null;
}

// ── Internal helpers ─────────────────────────────────────────────────

function readJson(p: string): Record<string, unknown> {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function loadAndMerge(projectCwd?: string): CachedMcpConfig {
  const cwd = projectCwd || process.cwd();
  
  // Check cache
  if (_cache && _cache.projectCwd === cwd && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return _cache;
  }

  const userConfig = readJson(path.join(os.homedir(), '.claude.json'));
  const settings = readJson(path.join(os.homedir(), '.claude', 'settings.json'));
  
  // Use provided projectCwd, fallback to process.cwd()
  const projectMcpJson = readJson(path.join(cwd, '.mcp.json'));
  const projectClaudeJson = readJson(path.join(cwd, 'claude.json'));

  const merged: Record<string, MCPServerConfig> = {
    ...((userConfig.mcpServers || {}) as Record<string, MCPServerConfig>),
    ...((settings.mcpServers || {}) as Record<string, MCPServerConfig>),
    ...((projectMcpJson.mcpServers || {}) as Record<string, MCPServerConfig>),
    ...((projectClaudeJson.mcpServers || {}) as Record<string, MCPServerConfig>),
  };

  // Support Claude CLI's per-project mcpServers inside ~/.claude.json's "projects" block
  if (userConfig.projects && typeof userConfig.projects === 'object') {
    const projConfig = (userConfig.projects as Record<string, any>)[cwd];
    if (projConfig && projConfig.mcpServers) {
      Object.assign(merged, projConfig.mcpServers);
    }
  }

  // Apply persistent enabled overrides for project-level servers
  const settingsOverrides = (settings.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;
  for (const [name, override] of Object.entries(settingsOverrides)) {
    if (merged[name] && override.enabled !== undefined) {
      merged[name] = { ...merged[name], enabled: override.enabled };
    }
  }

  // Resolve ${...} placeholders and track which servers needed resolution
  const codepilotServers: Record<string, MCPServerConfig> = {};

  for (const [name, server] of Object.entries(merged)) {
    if (server.env) {
      let hasPlaceholder = false;
      for (const [key, value] of Object.entries(server.env)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          hasPlaceholder = true;
          const settingKey = value.slice(2, -1);
          const resolved = getSetting(settingKey);
          server.env[key] = resolved || '';
        }
      }
      // Only include in codepilotServers if it had placeholders
      if (hasPlaceholder && server.enabled !== false) {
        codepilotServers[name] = server;
      }
    }
  }

  // Filter out persistently disabled servers from allServers
  for (const [name, server] of Object.entries(merged)) {
    if (server.enabled === false) {
      delete merged[name];
    }
  }

  _cache = {
    allServers: merged,
    codepilotServers,
    timestamp: Date.now(),
    projectCwd: cwd,
  };

  return _cache;
}

function resolveServerConfig(server: MCPServerConfig): MCPServerConfig {
  const out = { ...server };
  if (out.env) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(out.env)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const settingKey = value.slice(2, -1);
        env[key] = getSetting(settingKey) || '';
      } else if (typeof value === 'string') {
        env[key] = value;
      }
    }
    out.env = env;
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load MCP servers that need CodePilot-specific processing.
 *
 * Returns only servers with ${...} env placeholders that were resolved
 * against the CodePilot DB. Returns undefined when no such servers exist
 * (the common case), so chat startup can continue without external MCP.
 *
 * Used by: route.ts, conversation-engine.ts — passed to streamClaude().
 */
export function loadCodePilotMcpServers(projectCwd?: string): Record<string, MCPServerConfig> | undefined {
  try {
    const { codepilotServers } = loadAndMerge(projectCwd);
    return Object.keys(codepilotServers).length > 0 ? codepilotServers : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load ALL MCP servers (for UI display in MCP Manager).
 *
 * Returns the full merged config from all sources with overrides applied.
 * NOT intended for passing wholesale to the SDK — use
 * loadCodePilotMcpServers() or loadOnDemandMcpServers() instead.
 *
 * Used by: MCP Manager UI, diagnostics.
 */
export function loadAllMcpServers(projectCwd?: string): Record<string, MCPServerConfig> | undefined {
  try {
    const { allServers } = loadAndMerge(projectCwd);
    return Object.keys(allServers).length > 0 ? allServers : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load a named subset of user/settings/project MCP servers for one request.
 *
 * This supports the SDK fast-start path: normal chat turns avoid spawning slow
 * user MCPs, while explicit needs like GitHub, browser automation, or web fetch
 * still receive the relevant server before the Claude Code process starts.
 */
export function loadOnDemandMcpServers(
  projectCwd: string | undefined,
  names: Iterable<string>,
): Record<string, MCPServerConfig> | undefined {
  const selectedNames = new Set(Array.from(names).filter(Boolean));
  if (selectedNames.size === 0) return undefined;

  try {
    const { allServers } = loadAndMerge(projectCwd);
    const resolved: Record<string, MCPServerConfig> = {};

    for (const name of selectedNames) {
      if (allServers[name]) {
        resolved[name] = allServers[name];
      }
    }

    return Object.keys(resolved).length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load MCP servers from a SPECIFIC project's `.mcp.json` file.
 *
 * Used when CodePilot decides a request needs project MCP access. Because the
 * SDK fast-start path uses settingSources=[], project `.mcp.json` servers are
 * never discovered automatically; callers must explicitly pass the subset
 * they want to expose for that turn.
 *
 * Why this isn't covered by the cache-based `loadAndMerge` above:
 * `loadAndMerge` reads `<process.cwd()>/.mcp.json`, which on the desktop
 * app is the Next.js server's working directory (typically the standalone
 * bundle dir), NOT the user's project directory. We need the actual
 * resolved working directory of the request, which only the streaming
 * code path knows.
 *
 * Servers with `${...}` env placeholders are resolved against the
 * CodePilot DB the same way loadAndMerge does. Disabled servers are
 * filtered out.
 *
 * @param projectCwd - The user's actual working directory (NOT process.cwd())
 * @returns Map of resolved server configs, or undefined when none found
 */
export function loadProjectMcpServers(projectCwd: string | undefined): Record<string, MCPServerConfig> | undefined {
  if (!projectCwd) return undefined;
  try {
    const filePath = path.join(projectCwd, '.mcp.json');
    if (!fs.existsSync(filePath)) return undefined;

    const content = readJson(filePath);
    const rawServers = (content.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (Object.keys(rawServers).length === 0) return undefined;

    // Apply user-level `mcpServerOverrides` from ~/.claude/settings.json.
    // The CodePilot MCP Manager UI persists per-server enable/disable state
    // there (see mcp-loader.ts:57-62 — original loadAndMerge does the same
    // for the cached path). Without this, a DB-provider session would
    // silently re-enable a project MCP the user toggled off (or fail to
    // enable one they overrode on), creating a state mismatch between the
    // UI and what the SDK actually loads.
    const userSettings = readJson(path.join(os.homedir(), '.claude', 'settings.json'));
    const overrides = (userSettings.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;

    const resolved: Record<string, MCPServerConfig> = {};
    for (const [name, server] of Object.entries(rawServers)) {
      // UI override takes precedence over the file's own `enabled` field.
      // Same precedence as loadAndMerge() so behavior stays consistent
      // across the cached path and the per-cwd path.
      const override = overrides[name];
      const effectiveEnabled = override?.enabled !== undefined ? override.enabled : server.enabled;
      if (effectiveEnabled === false) continue;

      resolved[name] = resolveServerConfig(server);
    }

    return Object.keys(resolved).length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}
