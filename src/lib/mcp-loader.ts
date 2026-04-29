/**
 * MCP Server Loader — shared module for loading MCP server configurations.
 *
 * CodePilot does not let the SDK auto-load every MCP server during chat
 * startup. We manually pass either CodePilot-processed servers or a small
 * on-demand subset selected for the current request.
 *
 * This eliminates redundant config passing and reduces initialization overhead.
 */

import type { MCPServerConfig } from '@/types';
import { getSetting } from '@/lib/db';
import { readEffectiveExternalMcpServers } from '@/lib/mcp-registry';

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

function loadAndMerge(projectCwd?: string): CachedMcpConfig {
  const cwd = projectCwd || process.cwd();
  
  // Check cache
  if (_cache && _cache.projectCwd === cwd && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return _cache;
  }

  const merged: Record<string, MCPServerConfig> = {
    // Built-in official memory server fallback
    'memory': {
      type: 'stdio',
      command: 'node',
      args: ['-e', 'const cp=require("child_process");process.chdir(process.env.CODEPILOT_WORKSPACE);const child=cp.spawn(process.platform==="win32"?"npx.cmd":"npx",["-y","@modelcontextprotocol/server-memory"],{stdio:"inherit"});child.on("exit",c=>process.exit(c||0));process.on("SIGTERM",()=>child.kill("SIGTERM"));process.on("SIGINT",()=>child.kill("SIGINT"));process.stdin.on("end",()=>child.kill("SIGTERM"));process.stdin.on("close",()=>child.kill("SIGTERM"));'],
      env: { CODEPILOT_WORKSPACE: cwd },
      enabled: true
    },
    ...Object.fromEntries(
      Object.entries(readEffectiveExternalMcpServers(cwd)).map(([name, entry]) => [name, entry.config]),
    ),
  };

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
 * Load project-scoped MCP servers from the unified registry.
 *
 * Used when CodePilot decides a request needs project MCP access. Because the
 * SDK fast-start path may still bypass Claude's native discovery, callers must
 * explicitly pass the subset they want to expose for that turn.
 *
 * 这里返回的项目级集合会优先使用迁移后的 Claude 原生 `projects[cwd].mcpServers`，
 * 并在首次读取时把遗留 `.mcp.json` / `claude.json` 复制进原生配置，确保 UI 与运行时看到同一份项目来源。
 *
 * @param projectCwd - The user's actual working directory (NOT process.cwd())
 * @returns Map of resolved server configs, or undefined when none found
 */
export function loadProjectMcpServers(projectCwd: string | undefined): Record<string, MCPServerConfig> | undefined {
  if (!projectCwd) return undefined;
  try {
    const effective = readEffectiveExternalMcpServers(projectCwd);
    const resolved: Record<string, MCPServerConfig> = {};
    for (const [name, entry] of Object.entries(effective)) {
      if (entry.scope !== 'project') continue;
      resolved[name] = resolveServerConfig(entry.config);
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}
