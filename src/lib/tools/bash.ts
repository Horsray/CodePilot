/**
 * tools/bash.ts — Execute shell commands.
 *
 * Primary path: PTY session (interactive, supports terminal programs).
 * Fallback path: child_process.exec (when PTY is unavailable or fails).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
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

/** Fallback: run command via child_process.exec when PTY is unavailable */
function execFallback(
  command: string,
  cwd: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, TERM: 'dumb' },
    }, (error, stdout, stderr) => {
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += (output ? '\n' : '') + stderr;
      if (error && !output) {
        output = `Error: ${error.message}`;
      }
      if (error && 'code' in error && error.code) {
        output += `\n[Exit code: ${error.code}]`;
      }
      resolve(output || '(no output)');
    });

    if (abortSignal) {
      const handleAbort = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
      };
      if (abortSignal.aborted) {
        handleAbort();
      } else {
        abortSignal.addEventListener('abort', handleAbort, { once: true });
      }
    }
  });
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

      if (!ctx.sessionId) {
        // No session — use fallback directly
        return execFallback(command, ctx.workingDirectory, timeoutMs, abortSignal);
      }

      const terminalId = `agent-terminal-${ctx.sessionId}`;

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
      } catch (ptyError) {
        // PTY failed — fallback to child_process.exec
        console.warn('[bash-tool] PTY execution failed, falling back to exec:', ptyError);
        try {
          const output = await execFallback(command, ctx.workingDirectory, timeoutMs, abortSignal);

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
        } catch (fallbackError) {
          return `Error executing command: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
        }
      }
    },
  });
}
