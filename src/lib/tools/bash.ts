/**
 * tools/bash.ts — 通过 PTY 会话执行 shell 命令，支持终端面板镜像显示。
 * 中文注释：功能名称「Bash 工具」，用法是执行 shell 命令并返回输出，
 * 同时通过 SSE 将命令和输出镜像到终端面板，让用户可以实时看到 AI 执行的命令。
 * 优先使用 PTY 会话执行（与用户终端共享同一个 shell），回退到 spawn 独立执行。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import { executeCommandInPtySession, ensurePtySession, ensurePtyOutputBuffered } from '@/lib/pty-manager';
import type { ToolContext } from './index';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes

// 中文注释：功能名称「AI 专用 PTY 会话 ID」，用法是为 AI Bash 工具创建专用的 PTY 会话，
// 与用户手动操作的终端会话区分开来，避免干扰用户输入。
const AI_PTY_SESSION_ID = '__codepilot_ai_bash__';

export function createBashTool(ctx: ToolContext) {
  return tool({
    description:
      'Execute a bash command and return its output (stdout + stderr combined). ' +
      'The command runs in the working directory. Use for system operations, ' +
      'running tests, installing packages, git commands, etc. ' +
      'Long-running commands are automatically killed after the timeout. ' +
      'IMPORTANT: Commands are run non-interactively. NEVER run commands that require user input or open a pager (e.g., use `git log --no-pager` or `PAGER=cat`).',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      timeout: z.number().int().positive().max(300000).optional()
        .describe('Timeout in milliseconds (default 120000)'),
    }),
    // 中文注释：功能名称「Bash 工具执行」，用法是优先通过 PTY 会话执行命令，
    // 同时通过 SSE 将命令和输出镜像到终端面板，让用户可以实时看到 AI 执行的命令。
    // PTY 执行失败时回退到 spawn 独立执行。
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      // 通过 SSE 将命令发送到终端面板显示
      if (ctx.emitSSE) {
        ctx.emitSSE({
          type: 'terminal_mirror',
          data: JSON.stringify({
            action: 'command',
            command,
            cwd: ctx.workingDirectory,
          }),
        });
      }

      // 中文注释：优先通过 PTY 会话执行命令，这样命令和输出会自动出现在终端面板中。
      // PTY 会话与用户终端共享同一个 shell 进程，保证环境一致性。
      try {
        ensurePtySession(AI_PTY_SESSION_ID, ctx.workingDirectory);
        ensurePtyOutputBuffered(AI_PTY_SESSION_ID);

        const output = await executeCommandInPtySession(
          AI_PTY_SESSION_ID,
          ctx.workingDirectory,
          command,
          timeoutMs,
          abortSignal,
          (chunkStr) => {
            if (ctx.emitSSE && chunkStr) {
              ctx.emitSSE({
                type: 'tool_output',
                data: chunkStr,
              });
            }
          }
        );

        // 通过 SSE 将退出码发送到终端面板
        if (ctx.emitSSE) {
          ctx.emitSSE({
            type: 'terminal_mirror',
            data: JSON.stringify({
              action: 'exit',
              exitCode: 0,
            }),
          });
        }

        return output;
      } catch (ptyError) {
        // 中文注释：PTY 执行失败时回退到 spawn 独立执行，保证功能可用性。
        console.warn('[bash-tool] PTY execution failed, falling back to spawn:', ptyError);
      }

      // 回退路径：使用 child_process.spawn 独立执行
      return new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;

        const proc = spawn('bash', ['-c', command], {
          cwd: ctx.workingDirectory,
          env: { ...process.env, TERM: 'dumb' },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          detached: process.platform !== 'win32',
        });

        const collect = (data: Buffer) => {
          if (truncated) return;
          totalBytes += data.length;
          let chunkStr = '';
          if (totalBytes > MAX_OUTPUT_BYTES) {
            truncated = true;
            const allowedBuffer = data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length));
            chunks.push(allowedBuffer);
            chunkStr = allowedBuffer.toString('utf-8');
          } else {
            chunks.push(data);
            chunkStr = data.toString('utf-8');
          }
          
          if (ctx.emitSSE && chunkStr) {
            ctx.emitSSE({
              type: 'tool_output',
              data: chunkStr,
            });
            // 中文注释：同时将输出镜像到终端面板
            ctx.emitSSE({
              type: 'terminal_mirror',
              data: JSON.stringify({
                action: 'output',
                output: chunkStr,
              }),
            });
          }
        };

        proc.stdout?.on('data', collect);
        proc.stderr?.on('data', collect);

        const killProc = () => {
          try {
            if (proc.pid && process.platform !== 'win32') {
              process.kill(-proc.pid, 'SIGTERM');
              setTimeout(() => {
                try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
              }, 2000);
            } else {
              proc.kill('SIGTERM');
            }
          } catch {
            proc.kill('SIGTERM');
          }
        };

        const onAbort = () => {
          killProc();
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        let isResolved = false;
        const absoluteTimeout = setTimeout(() => {
          if (isResolved) return;
          isResolved = true;
          killProc();
          proc.stdout?.destroy();
          proc.stderr?.destroy();
          
          let output = Buffer.concat(chunks).toString('utf-8');
          if (truncated) {
            output += '\n\n[Output truncated — exceeded 1MB limit]';
          }
          output += `\n\n[Process killed: Timeout after ${timeoutMs}ms]`;
          
          if (ctx.emitSSE) {
            ctx.emitSSE({
              type: 'terminal_mirror',
              data: JSON.stringify({ action: 'exit', exitCode: 1, signal: 'SIGTERM' }),
            });
          }
          resolve(output);
        }, timeoutMs + 1000); // Add 1s buffer over native spawn timeout

        proc.on('close', (code, signal) => {
          if (isResolved) return;
          isResolved = true;
          clearTimeout(absoluteTimeout);
          abortSignal?.removeEventListener('abort', onAbort);

          let output = Buffer.concat(chunks).toString('utf-8');
          if (truncated) {
            output += '\n\n[Output truncated — exceeded 1MB limit]';
          }

          if (signal === 'SIGTERM' || signal === 'SIGKILL') {
            output += `\n\n[Process killed: ${signal}]`;
          }

          if (code !== null && code !== 0) {
            output += `\n\n[Exit code: ${code}]`;
          }

          // 中文注释：通过 SSE 将退出码发送到终端面板
          if (ctx.emitSSE) {
            ctx.emitSSE({
              type: 'terminal_mirror',
              data: JSON.stringify({
                action: 'exit',
                exitCode: code ?? 0,
                signal: signal || undefined,
              }),
            });
          }

          resolve(output || '(no output)');
        });

        proc.on('error', (err) => {
          if (isResolved) return;
          isResolved = true;
          clearTimeout(absoluteTimeout);
          resolve(`Error executing command: ${err.message}`);
        });
      });
    },
  });
}
