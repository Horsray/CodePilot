import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MCPServerConfig } from '@/types';

export type McpRegistrySource = 'claude.json' | 'project-file' | 'builtin';
export type McpRegistryScope = 'global' | 'project' | 'builtin';
export type McpRegistryActivation = 'always' | 'workspace' | 'session' | 'keyword';

export interface EffectiveMcpServerEntry {
  name: string;
  config: MCPServerConfig;
  source: McpRegistrySource;
  scope: McpRegistryScope;
  activation: McpRegistryActivation;
  readOnly?: boolean;
  builtin?: boolean;
  migratedFrom?: string[];
}

export interface LegacyGlobalMcpMigrationResult {
  migratedNames: string[];
  conflictNames: string[];
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function getClaudeUserConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

export function getProjectMcpPath(projectCwd: string): string {
  return path.join(path.resolve(projectCwd), '.mcp.json');
}

function normalizeProjectKey(projectCwd: string): string {
  return path.resolve(projectCwd);
}

function readMcpServersFromFile(filePath: string): Record<string, MCPServerConfig> {
  const content = readJsonFile(filePath);
  return (content.mcpServers || {}) as Record<string, MCPServerConfig>;
}

function writeMcpServersToFile(filePath: string, servers: Record<string, MCPServerConfig>): void {
  const payload = Object.keys(servers).length > 0 ? { mcpServers: servers } : {};
  writeJsonFile(filePath, payload);
}

function isAppWorkspaceRoot(projectCwd?: string): boolean {
  return !!projectCwd && normalizeProjectKey(projectCwd) === normalizeProjectKey(process.cwd());
}

function getLegacyGlobalProjectFileSources(): Array<{ filePath: string; servers: Record<string, MCPServerConfig> }> {
  const candidates = [
    path.join(process.cwd(), '.mcp.json'),
    path.join(process.cwd(), 'claude.json'),
  ];
  const sources: Array<{ filePath: string; servers: Record<string, MCPServerConfig> }> = [];
  for (const filePath of candidates) {
    const servers = readMcpServersFromFile(filePath);
    if (Object.keys(servers).length > 0) {
      sources.push({ filePath, servers });
    }
  }
  return sources;
}

// 中文注释：功能名称「旧全局 MCP 迁移」，用法是把历史上写在 `settings.json`
// 或当前应用仓库根 `.mcp.json` 里的全局 MCP 一次性迁入 `~/.claude.json`，
// 之后运行时与前端只再认 Claude 全局配置，避免被外部程序重写的 settings 干扰。
export function migrateLegacyGlobalMcpServers(): LegacyGlobalMcpMigrationResult {
  const userConfigPath = getClaudeUserConfigPath();
  const userConfig = readJsonFile(userConfigPath);
  const settings = readJsonFile(getClaudeSettingsPath());

  const legacySources: Array<{ filePath: string; servers: Record<string, MCPServerConfig> }> = [];
  const settingsServers = (settings.mcpServers || {}) as Record<string, MCPServerConfig>;
  if (Object.keys(settingsServers).length > 0) {
    legacySources.push({
      filePath: getClaudeSettingsPath(),
      servers: settingsServers,
    });
  }
  legacySources.push(...getLegacyGlobalProjectFileSources());

  const nextGlobalServers = { ...((userConfig.mcpServers || {}) as Record<string, MCPServerConfig>) };
  const migratedNames = new Set<string>();
  const conflictNames = new Set<string>();
  const migratedFrom = (userConfig.codepilot_mcp_migrated_from &&
    typeof userConfig.codepilot_mcp_migrated_from === 'object')
    ? (userConfig.codepilot_mcp_migrated_from as Record<string, string[]>)
    : {};

  for (const source of legacySources) {
    const sourceName = path.basename(source.filePath);
    for (const [name, server] of Object.entries(source.servers)) {
      const existing = nextGlobalServers[name];
      if (!existing) {
        nextGlobalServers[name] = server;
        migratedNames.add(name);
      } else if (JSON.stringify(existing) !== JSON.stringify(server)) {
        conflictNames.add(name);
      }
      migratedFrom[name] = Array.from(new Set([...(migratedFrom[name] || []), sourceName])).sort();
    }
  }

  if (migratedNames.size > 0 || Object.keys(migratedFrom).length > 0) {
    userConfig.mcpServers = nextGlobalServers;
    userConfig.codepilot_mcp_migrated_from = migratedFrom;
    writeJsonFile(userConfigPath, userConfig);
  }

  return {
    migratedNames: Array.from(migratedNames).sort(),
    conflictNames: Array.from(conflictNames).sort(),
  };
}

function getGlobalOverrides(userConfig: Record<string, unknown>): Record<string, { enabled?: boolean }> {
  return (userConfig.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;
}

// 中文注释：功能名称「有效 MCP 注册表读取」，用法是统一给前端和运行时返回
// Claude 全局 MCP + 当前项目 `.mcp.json` 的真实集合，不再把 `settings.json`
// 当成长期 MCP 来源，只在首次迁移旧配置时读取一次。
export function readEffectiveExternalMcpServers(projectCwd?: string): Record<string, EffectiveMcpServerEntry> {
  migrateLegacyGlobalMcpServers();

  const normalizedCwd = projectCwd ? normalizeProjectKey(projectCwd) : undefined;
  const userConfig = readJsonFile(getClaudeUserConfigPath());
  const entries: Record<string, EffectiveMcpServerEntry> = {};
  const globalServers = (userConfig.mcpServers || {}) as Record<string, MCPServerConfig>;
  const globalOverrides = getGlobalOverrides(userConfig);
  const migratedFromMap = (userConfig.codepilot_mcp_migrated_from || {}) as Record<string, string[]>;

  for (const [name, config] of Object.entries(globalServers)) {
    entries[name] = {
      name,
      config: {
        ...config,
        ...(globalOverrides[name]?.enabled !== undefined ? { enabled: globalOverrides[name].enabled } : {}),
      },
      source: 'claude.json',
      scope: 'global',
      activation: 'always',
      ...(migratedFromMap[name]?.length ? { migratedFrom: migratedFromMap[name] } : {}),
    };
  }

  if (normalizedCwd && !isAppWorkspaceRoot(normalizedCwd)) {
    const projectServers = readMcpServersFromFile(getProjectMcpPath(normalizedCwd));
    for (const [name, config] of Object.entries(projectServers)) {
      entries[name] = {
        name,
        config,
        source: 'project-file',
        scope: 'project',
        activation: 'always',
      };
    }
  }

  for (const [name, entry] of Object.entries(entries)) {
    if (entry.config.enabled === false) {
      delete entries[name];
    }
  }

  return entries;
}

export function readGlobalMcpServers(): Record<string, MCPServerConfig> {
  migrateLegacyGlobalMcpServers();
  const userConfig = readJsonFile(getClaudeUserConfigPath());
  return { ...((userConfig.mcpServers || {}) as Record<string, MCPServerConfig>) };
}

export function writeGlobalMcpServers(servers: Record<string, MCPServerConfig>): void {
  const userConfig = readJsonFile(getClaudeUserConfigPath());
  userConfig.mcpServers = servers;
  writeJsonFile(getClaudeUserConfigPath(), userConfig);
}

export function readProjectMcpServers(projectCwd?: string): Record<string, MCPServerConfig> {
  if (!projectCwd || isAppWorkspaceRoot(projectCwd)) {
    return {};
  }
  return readMcpServersFromFile(getProjectMcpPath(projectCwd));
}

export function writeProjectMcpServers(projectCwd: string, servers: Record<string, MCPServerConfig>): void {
  if (isAppWorkspaceRoot(projectCwd)) {
    return;
  }
  writeMcpServersToFile(getProjectMcpPath(projectCwd), servers);
}

export function getBuiltinMcpCatalog(): Record<string, EffectiveMcpServerEntry> {
  // 中文注释：功能名称「内置 MCP 目录」，用法是把宿主提供的 CodePilot MCP 能力显式列出，
  // 让前端能区分外部 MCP 与 CodePilot 内置能力，但两者最终都会进入同一轮会话可用集合。
  const builtins: Array<EffectiveMcpServerEntry> = [
    { name: 'codepilot-notify', config: {}, source: 'builtin', scope: 'builtin', activation: 'always', builtin: true, readOnly: true },
    { name: 'codepilot-todo', config: {}, source: 'builtin', scope: 'builtin', activation: 'always', builtin: true, readOnly: true },
    { name: 'codepilot-browser', config: {}, source: 'builtin', scope: 'builtin', activation: 'always', builtin: true, readOnly: true },
    { name: 'codepilot-ask-user', config: {}, source: 'builtin', scope: 'builtin', activation: 'always', builtin: true, readOnly: true },
    { name: 'codepilot-memory-search', config: {}, source: 'builtin', scope: 'builtin', activation: 'workspace', builtin: true, readOnly: true },
    { name: 'codepilot-widget', config: {}, source: 'builtin', scope: 'builtin', activation: 'keyword', builtin: true, readOnly: true },
    { name: 'codepilot-media', config: {}, source: 'builtin', scope: 'builtin', activation: 'keyword', builtin: true, readOnly: true },
    { name: 'codepilot-image-gen', config: {}, source: 'builtin', scope: 'builtin', activation: 'keyword', builtin: true, readOnly: true },
    { name: 'codepilot-cli-tools', config: {}, source: 'builtin', scope: 'builtin', activation: 'always', builtin: true, readOnly: true },
    { name: 'codepilot-dashboard', config: {}, source: 'builtin', scope: 'builtin', activation: 'keyword', builtin: true, readOnly: true },
  ];

  return Object.fromEntries(builtins.map((entry) => [entry.name, entry]));
}
