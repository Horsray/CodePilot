import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './index';

export function createBrowserOpenTool(ctx: ToolContext) {
  return tool({
    description:
      'Open a URL in the app built-in browser tab. Use this when you want the user to preview a page, ' +
      'open a local dev server, inspect a web result inside the workspace, or continue browser-based work ' +
      'without asking the user to switch to an external browser.',
    inputSchema: z.object({
      url: z.string().min(1).describe('The URL to open in the built-in browser'),
      newTab: z.boolean().optional().describe('Whether to open as a new browser tab'),
    }),
    execute: async ({ url, newTab }) => {
      ctx.emitSSE?.({
        type: 'status',
        data: JSON.stringify({
          subtype: 'ui_action',
          action: 'open_browser',
          url,
          newTab: newTab !== false,
        }),
      });

      return `Opened ${url} in the built-in browser`;
    },
  });
}
