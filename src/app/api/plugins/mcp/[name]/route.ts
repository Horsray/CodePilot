import { NextRequest, NextResponse } from 'next/server';
import type { MCPServerConfig, ErrorResponse, SuccessResponse } from '@/types';
import { invalidateMcpCache } from '@/lib/mcp-loader';
import {
  readGlobalMcpServers,
  readProjectMcpServers,
  writeGlobalMcpServers,
  writeProjectMcpServers,
} from '@/lib/mcp-registry';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { name } = await params;
    const serverName = decodeURIComponent(name);
    const cwd = _request.nextUrl.searchParams.get('cwd') || undefined;
    const source = _request.nextUrl.searchParams.get('source') || undefined;
    const userServers = readGlobalMcpServers() as Record<string, MCPServerConfig>;
    const projectServers = cwd ? (readProjectMcpServers(cwd) as Record<string, MCPServerConfig>) : {};
    let deleted = false;

    if (source !== 'project-file' && userServers[serverName]) {
      delete userServers[serverName];
      deleted = true;
    }

    if (source !== 'claude.json' && cwd && projectServers[serverName]) {
      delete projectServers[serverName];
      deleted = true;
    }

    if (!deleted) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found` },
        { status: 404 }
      );
    }

    writeGlobalMcpServers(userServers);
    if (cwd) {
      writeProjectMcpServers(cwd, projectServers);
    }
    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete MCP server' },
      { status: 500 }
    );
  }
}
