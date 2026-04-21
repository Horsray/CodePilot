/**
 * GET /api/plugins/mcp/servers
 * Returns all available MCP server configurations from loadAllMcpServers.
 * Used by the scheduled task creation UI to let users select which tools to authorize.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadAllMcpServers } from '@/lib/mcp-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const projectCwd = request.nextUrl.searchParams.get('projectCwd') || undefined;
    const servers = loadAllMcpServers(projectCwd);

    if (!servers) {
      return NextResponse.json({ servers: [] });
    }

    // Transform to a more frontend-friendly format
    const serverList = Object.entries(servers).map(([name, config]) => ({
      name,
      type: config.type || 'stdio',
      command: config.command,
      args: config.args,
      url: config.url,
      enabled: config.enabled !== false,
    }));

    return NextResponse.json({ servers: serverList });
  } catch (error) {
    console.error('[mcp/servers] Failed to load MCP servers:', error);
    return NextResponse.json({ servers: [], error: String(error) }, { status: 500 });
  }
}
