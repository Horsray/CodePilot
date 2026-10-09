import { tool } from 'ai';
import { z } from 'zod';

export const createMcpActivateTool = (workspacePath: string) => {
  let availableServersStr = '';
  try {
    // Attempt to synchronously list MCP servers for the description
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const mcpPath = path.join(workspacePath, '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (config.mcpServers) {
        availableServersStr = Object.keys(config.mcpServers).join(', ');
      }
    }
  } catch (e) {
    // Ignore errors, we'll fall back to empty string
  }

  const serverDesc = availableServersStr ? ` Available servers include: [${availableServersStr}].` : '';

  return tool({
    description: `Activate a dormant MCP server. Check the <available_mcp_servers> list in your system prompt for exact server names.${serverDesc} Call this tool IMMEDIATELY when you realize you need a capability provided by an unloaded MCP server. DO NOT attempt to guess the tool names or call them before activating the server.`,
    inputSchema: z.object({
      serverName: z.string().describe('The exact name of the MCP server to activate from <available_mcp_servers> (e.g., "memory", "github")'),
    }),
  execute: async ({ serverName }: { serverName: string }) => {
    try {
      const mcpLoader = await import('@/lib/mcp-loader');
      const mcpConnectionManager = await import('@/lib/mcp-connection-manager');

      const newMcps = mcpLoader.loadOnDemandMcpServers(workspacePath, new Set([serverName]));
      if (!newMcps || Object.keys(newMcps).length === 0) {
        return `Failed to find MCP server configuration for "${serverName}". Please check the exact name from the <available_mcp_servers> list.`;
      }
      
      // Merge with existing connections instead of overriding them all
      const existingConfigs = Object.fromEntries(
        Array.from(mcpConnectionManager.connections.entries())
          .filter(([, conn]) => conn.config)
          .map(([name, conn]) => [name, conn.config!])
      );
      
      await mcpConnectionManager.syncMcpConnections({ ...existingConfigs, ...newMcps });
      return `Successfully activated MCP server "${serverName}". Its tools are now loaded and available in this conversation. You MUST now proceed to use the newly available tools to complete the user's request in the next step.`;
    } catch (e) {
      return `Failed to activate MCP server: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
});
}
