/**
 * mcp-connection-manager.ts — MCP server connection pool for the Native Runtime.
 *
 * Manages connections to external MCP servers (stdio/sse/http).
 * Discovers their tools via listTools() and exposes them as callable.
 * The SDK Runtime doesn't use this — it passes mcpServers to the SDK Options.
 */

import type { MCPServerConfig } from '@/types';

// Lazy-load MCP SDK to avoid import errors when not used
let Client: typeof import('@modelcontextprotocol/sdk/client/index.js').Client;
let StdioClientTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;

interface McpConnection {
  name: string;
  config: MCPServerConfig;
  client: InstanceType<typeof Client> | null;
  tools: McpToolDefinition[];
  status: 'connected' | 'connecting' | 'failed' | 'disabled';
  error?: string;
  lastAttemptAt?: number;
}

export interface McpToolDefinition {
  /** Fully qualified name: mcp__{serverName}__{toolName} */
  qualifiedName: string;
  /** Original tool name from the MCP server */
  originalName: string;
  /** Server this tool belongs to */
  serverName: string;
  /** Tool description */
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
}

export interface McpSyncServerResult {
  name: string;
  status: 'connected' | 'reused' | 'failed' | 'disabled';
  durationMs: number;
  toolCount: number;
  error?: string;
}

export interface McpSyncResult {
  totalDurationMs: number;
  connectedCount: number;
  reusedCount: number;
  failedCount: number;
  servers: McpSyncServerResult[];
}

const MCP_CONNECT_TIMEOUT_MS = 10_000;
const MCP_LIST_TOOLS_TIMEOUT_MS = 5_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 45_000;
const MCP_FAILED_RETRY_COOLDOWN_MS = 60_000;

function getMcpToolTimeoutMs(serverName: string, toolName: string): number {
  const normalizedServer = serverName.toLowerCase();
  if (normalizedServer === 'minimax') {
    if (toolName === 'understand_image') return 180_000;
    if (toolName === 'web_search') return 90_000;
  }
  return MCP_CALL_TOOL_TIMEOUT_MS;
}

// ── Singleton pool ──────────────────────────────────────────────

const connections = new Map<string, McpConnection>();

/**
 * Sync the connection pool with desired configurations.
 * Connects new servers, disconnects removed ones.
 */
export async function syncMcpConnections(
  desiredConfigs: Record<string, MCPServerConfig>,
): Promise<McpSyncResult> {
  const syncStart = Date.now();
  const desiredNames = new Set(Object.keys(desiredConfigs));
  const results: McpSyncServerResult[] = [];

  // Disconnect servers that are no longer in config
  for (const [name] of connections) {
    if (!desiredNames.has(name)) {
      await disconnectServer(name);
    }
  }

  // Connect new or updated servers
  const connectTasks: Array<Promise<McpSyncServerResult>> = [];
  for (const [name, config] of Object.entries(desiredConfigs)) {
    if (config.enabled === false) {
      results.push({
        name,
        status: 'disabled',
        durationMs: 0,
        toolCount: 0,
      });
      continue;
    }
    const existing = connections.get(name);
    if (existing?.status === 'connected') {
      results.push({
        name,
        status: 'reused',
        durationMs: 0,
        toolCount: existing.tools.length,
      });
      continue;
    }
    if (existing?.status === 'connecting') {
      results.push({
        name,
        status: 'reused',
        durationMs: 0,
        toolCount: existing.tools.length,
      });
      continue;
    }
    if (existing?.status === 'failed' && existing.lastAttemptAt && Date.now() - existing.lastAttemptAt < MCP_FAILED_RETRY_COOLDOWN_MS) {
      results.push({
        name,
        status: 'failed',
        durationMs: 0,
        toolCount: 0,
        error: existing.error,
      });
      continue;
    }
    connectTasks.push(connectServer(name, config));
  }

  if (connectTasks.length > 0) {
    const settled = await Promise.all(connectTasks);
    results.push(...settled);
  }

  return {
    totalDurationMs: Date.now() - syncStart,
    connectedCount: results.filter(r => r.status === 'connected').length,
    reusedCount: results.filter(r => r.status === 'reused').length,
    failedCount: results.filter(r => r.status === 'failed').length,
    servers: results.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Connect to a single MCP server.
 */
export async function connectServer(name: string, config: MCPServerConfig): Promise<McpSyncServerResult> {
  const startedAt = Date.now();
  const conn: McpConnection = {
    name,
    config,
    client: null,
    tools: [],
    status: 'connecting',
    lastAttemptAt: startedAt,
  };
  connections.set(name, conn);

  try {
    // Lazy-load MCP SDK
    if (!Client) {
      const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
      Client = clientModule.Client;
    }

    const client = new Client({ name: `codepilot-${name}`, version: '1.0.0' });
    const transport = await createTransport(config);

    await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `[MCP] ${name} connect`);
    conn.client = client;

    // Discover tools
    const toolsResult = await withTimeout(client.listTools(), MCP_LIST_TOOLS_TIMEOUT_MS, `[MCP] ${name} listTools`);
    conn.tools = (toolsResult.tools || []).map(t => ({
      qualifiedName: `mcp__${name}__${t.name}`,
      originalName: t.name,
      serverName: name,
      description: t.description || '',
      inputSchema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
    }));

    conn.status = 'connected';
    return {
      name,
      status: 'connected',
      durationMs: Date.now() - startedAt,
      toolCount: conn.tools.length,
    };
  } catch (err) {
    conn.status = 'failed';
    conn.error = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] Failed to connect to ${name}:`, conn.error);
    try { await conn.client?.close(); } catch { /* ignore */ }
    conn.client = null;
    conn.tools = [];
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      toolCount: 0,
      error: conn.error,
    };
  }
}

/**
 * Disconnect a server and remove it from the pool.
 */
export async function disconnectServer(name: string): Promise<void> {
  const conn = connections.get(name);
  if (conn?.client) {
    try { await conn.client.close(); } catch { /* ignore */ }
  }
  connections.delete(name);
}

/**
 * Call a tool on a connected MCP server.
 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const conn = connections.get(serverName);
  if (!conn?.client || conn.status !== 'connected') {
    throw new Error(`MCP server "${serverName}" is not connected`);
  }

  const normalizedArgs = normalizeMcpToolArgs(serverName, toolName, args);
  const result = await withTimeout(
    conn.client.callTool({ name: toolName, arguments: normalizedArgs }),
    getMcpToolTimeoutMs(serverName, toolName),
    `[MCP] ${serverName}/${toolName} callTool`,
  );

  return result;
}

export function normalizeMcpToolArgs(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedServer = serverName.toLowerCase();
  if (
    normalizedServer === 'minimax' &&
    toolName === 'understand_image' &&
    'image_url' in args &&
    !('image_source' in args)
  ) {
    const { image_url, ...rest } = args;
    return {
      ...rest,
      image_source: image_url,
    };
  }

  return args;
}

/**
 * Get all discovered tools from all connected servers.
 */
export function getAllMcpTools(): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  for (const conn of connections.values()) {
    if (conn.status === 'connected') {
      tools.push(...conn.tools);
    }
  }
  return tools;
}

/**
 * Get the status of all configured servers.
 */
export function getMcpStatus(): Record<string, { status: string; tools: number; error?: string }> {
  const result: Record<string, { status: string; tools: number; error?: string }> = {};
  for (const [name, conn] of connections) {
    result[name] = {
      status: conn.status,
      tools: conn.tools.length,
      ...(conn.error ? { error: conn.error } : {}),
    };
  }
  return result;
}

/**
 * Reconnect a specific server.
 */
export async function reconnectServer(name: string): Promise<void> {
  const conn = connections.get(name);
  if (!conn) return;
  await disconnectServer(name);
  await connectServer(name, conn.config);
}

/**
 * Dispose all connections.
 */
export async function disposeAll(): Promise<void> {
  for (const name of [...connections.keys()]) {
    await disconnectServer(name);
  }
}

// ── Transport creation ──────────────────────────────────────────

async function createTransport(config: MCPServerConfig) {
  const transportType = config.type || 'stdio';

  switch (transportType) {
    case 'stdio': {
      if (!StdioClientTransport) {
        const mod = await import('@modelcontextprotocol/sdk/client/stdio.js');
        StdioClientTransport = mod.StdioClientTransport;
      }
      return new StdioClientTransport({
        command: config.command!,
        args: config.args || [],
        env: config.env as Record<string, string> | undefined,
      });
    }

    case 'sse': {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      return new SSEClientTransport(new URL(config.url!));
    }

    case 'http': {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      return new StreamableHTTPClientTransport(new URL(config.url!));
    }

    default:
      throw new Error(`Unsupported MCP transport type: ${transportType}`);
  }
}
