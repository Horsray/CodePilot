import { NextRequest, NextResponse } from 'next/server';
import { invalidateMcpCache } from '@/lib/mcp-loader';
import {
  getBuiltinMcpCatalog,
  readEffectiveExternalMcpServers,
  readGlobalMcpServers,
  readProjectMcpServers,
  writeGlobalMcpServers,
  writeProjectMcpServers,
} from '@/lib/mcp-registry';
import type {
  MCPServerConfig,
  MCPConfigResponse,
  ErrorResponse,
  SuccessResponse,
} from '@/types';

export async function GET(request: NextRequest): Promise<NextResponse<MCPConfigResponse | ErrorResponse>> {
  try {
    const cwd = request.nextUrl.searchParams.get('cwd') || undefined;
    const externalServers = readEffectiveExternalMcpServers(cwd);
    const builtinServers = getBuiltinMcpCatalog();
    const mcpServers: Record<string, MCPServerConfig & Record<string, unknown>> = {};

    for (const [name, entry] of Object.entries(externalServers)) {
      mcpServers[name] = {
        ...entry.config,
        _source: entry.source,
        _scope: entry.scope,
        _activation: entry.activation,
        ...(entry.migratedFrom ? { _migratedFrom: entry.migratedFrom } : {}),
      };
    }

    for (const [name, entry] of Object.entries(builtinServers)) {
      mcpServers[name] = {
        ...entry.config,
        enabled: true,
        _source: entry.source,
        _scope: entry.scope,
        _activation: entry.activation,
        _builtin: true,
        _readonly: true,
      };
    }

    return NextResponse.json({ mcpServers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read MCP config' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const incoming = body.mcpServers as Record<string, MCPServerConfig & { _source?: string }>;
    const cwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    const nextGlobalServers: Record<string, MCPServerConfig> = {};
    const nextProjectServers: Record<string, MCPServerConfig> = {};

    for (const [name, server] of Object.entries(incoming)) {
      const {
        _source,
        _scope: _ignoredScope,
        _activation: _ignoredActivation,
        _builtin: _ignoredBuiltin,
        _readonly: _ignoredReadonly,
        _migratedFrom: _ignoredMigratedFrom,
        ...cleanServer
      } = server as MCPServerConfig & Record<string, unknown>;

      if (_source === 'builtin') continue;
      if (_source === 'project-file' || _source === 'project') {
        nextProjectServers[name] = cleanServer;
      } else {
        nextGlobalServers[name] = cleanServer;
      }
    }

    writeGlobalMcpServers(nextGlobalServers);
    if (cwd) {
      writeProjectMcpServers(cwd, nextProjectServers);
    }

    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP config' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, server, scope, cwd } = body as {
      name: string;
      server: MCPServerConfig;
      scope?: 'global' | 'project';
      cwd?: string;
    };

    // stdio servers require command; sse/http servers require url
    const isRemote = server?.type === 'sse' || server?.type === 'http';
    if (!name || !server || (!isRemote && !server.command) || (isRemote && !server.url)) {
      return NextResponse.json(
        { error: isRemote ? 'Name and server URL are required' : 'Name and server command are required' },
        { status: 400 }
      );
    }

    const normalizedCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined;
    const existing = readEffectiveExternalMcpServers(normalizedCwd);
    if (existing[name]) {
      return NextResponse.json(
        { error: `MCP server "${name}" already exists` },
        { status: 409 }
      );
    }

    if (scope === 'project' && normalizedCwd) {
      const projectServers = readProjectMcpServers(normalizedCwd);
      projectServers[name] = server;
      writeProjectMcpServers(normalizedCwd, projectServers);
    } else {
      const globalServers = readGlobalMcpServers();
      globalServers[name] = server;
      writeGlobalMcpServers(globalServers);
    }

    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add MCP server' },
      { status: 500 }
    );
  }
}
