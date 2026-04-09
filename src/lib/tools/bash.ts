/**
 * tools/bash.ts — Execute shell commands.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './index';
import { executeCommandInPtySession } from '@/lib/pty-manager';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes

function normalizePreviewUrl(candidate: string): string {
  const trimmed = candidate.trim().replace(/[)\].,;]+$/, '');
  return trimmed.replace('0.0.0.0', 'localhost');
}

function extractPreviewUrl(output: string): string | null {
  const match = output.match(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s]*)?/i);
  if (match?.[0]) return normalizePreviewUrl(match[0]);

  const localhostOnly = output.match(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+(?:\/[^\s]*)?/i);
  if (localhostOnly?.[0]) {
    return normalizePreviewUrl(`http://${localhostOnly[0]}`);
  }

  return null;
}

export function createBashTool(ctx: ToolContext) {
  return tool({
    description:
      'Execute a bash command and return its output (stdout + stderr combined). ' +
      'The command runs in the working directory. Use for system operations, ' +
      'running tests, installing packages, git commands, etc. ' +
      'Long-running commands are automatically killed after the timeout.',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      timeout: z.number().int().positive().optional()
        .describe('Timeout in milliseconds (default 120000)'),
    }),
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;
      const terminalId = `agent-terminal-${ctx.sessionId || 'default'}`;

      ctx.emitSSE?.({
        type: 'status',
        data: JSON.stringify({
          subtype: 'ui_action',
          action: 'open_terminal',
          tab: 'terminal',
          terminalId,
        }),
      });

      try {
        const output = await executeCommandInPtySession(
          terminalId,
          ctx.workingDirectory,
          command,
          timeoutMs,
          abortSignal,
        );

        if (output.length > MAX_OUTPUT_BYTES) {
          return `${output.slice(0, MAX_OUTPUT_BYTES)}\n\n[Output truncated — exceeded 1MB limit]`;
        }

        const previewUrl = extractPreviewUrl(output);
        if (previewUrl) {
          ctx.emitSSE?.({
            type: 'status',
            data: JSON.stringify({
              subtype: 'ui_action',
              action: 'open_browser',
              url: previewUrl,
              newTab: true,
            }),
          });
        }

        return output;
      } catch (error) {
        return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}
