import { tool } from 'ai';
import { z } from 'zod';

export const createMcpActivateTool = (workspacePath: string) => tool({
  description: 'Activate a dormant MCP server from the <available_mcp_servers> list. Call this tool IMMEDIATELY when you realize you need a capability provided by an unloaded MCP server. DO NOT attempt to guess the tool names or call them before activating the server.',
  parameters: z.object({
    serverName: z.string().describe('The exact name of the MCP server to activate (e.g., "minimax_vision", "github")'),
  }),
  execute: async ({ serverName }: { serverName: string }) => {
    try {
      const mcpLoader = await import('@/lib/mcp-loader');
      const mcpConnectionManager = await import('@/lib/mcp-connection-manager');

      const newMcps = mcpLoader.loadOnDemandMcpServers(workspacePath, new Set([serverName]));
      if (!newMcps || Object.keys(newMcps).length === 0) {
        return `Failed to find MCP server configuration for "${serverName}". Please check the exact name from the <available_mcp_servers> list.`;
      }
      
      await mcpConnectionManager.syncMcpConnections(newMcps);
      return `Successfully activated MCP server "${serverName}". Its tools are now loaded and available in this conversation. You MUST now proceed to use the newly available tools to complete the user's request in the next step.`;
    } catch (e) {
      return `Failed to activate MCP server: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
});
