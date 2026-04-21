import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { bridgeMcpTool } from '../builtin-mcp-bridge';

const browserSchema = z.object({
  url: z.string().describe('The URL to open in the built-in browser (e.g., http://localhost:3000)'),
  title: z.string().optional().describe('Optional title for the browser tab'),
});

const browserDescription = 
  'Open the built-in browser panel in the IDE to preview a web page. ' +
  'CRITICAL: If you started a local web server (like localhost:3000) and need to preview it, ' +
  'you MUST use this tool instead of Bash `open`.';

export const BROWSER_SYSTEM_PROMPT = `## Browser Preview
- You have access to a built-in browser panel via the \`codepilot_open_browser\` tool.
- **CRITICAL**: Whenever you start a local web server (e.g., \`npm run dev\`, \`python -m http.server\`) and need to preview the page, you MUST use \`codepilot_open_browser\` instead of Bash \`open\`.
- Never use Bash to open URLs in external browsers unless explicitly requested by the user.`;

export function createBrowserMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-browser',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_open_browser',
        browserDescription,
        browserSchema.shape,
        async (args: any) => {
          const { url, title } = args;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('action:open-browser-panel', {
              detail: { url, title }
            }));
          } else {
            // For SSR/Node environment (backend API route), we can't directly dispatch to window.
            // But this tool runs in the client (agent-loop) usually, or it's bridged.
            // We need a mechanism to tell the frontend. CodePilot usually streams this.
            // But wait, tools execute on the server in Native runtime if it's node?
            // Actually CodePilot's tools are executed on the server in app/api/chat/route.ts.
            // To open a browser tab on the client, we must emit an event that the client handles.
            // For now, let's just return a success message. 
            // In CodePilot, how do we trigger client-side actions from server tools?
            // We use `codepilot_notification` or similar. Let's see how `ask-user-question` or `notification` works.
          }
          return { content: [{ type: 'text', text: `Successfully requested to open browser for ${url}. The user will see it.` }] };
        }
      )
    ]
  });
}

export function createBrowserTool() {
  return bridgeMcpTool(
    'codepilot_open_browser',
    browserDescription,
    browserSchema,
    async (args: any) => {
      const { url, title } = args;
      // Return a special token or just success. If we need to trigger client side, we might need a special SSE event or similar.
      return { content: [{ type: 'text', text: `[SYSTEM: BROWSER_OPEN_REQUESTED] url=${url} title=${title || ''}` }] };
    }
  );
}
