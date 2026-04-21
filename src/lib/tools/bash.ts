/**
 * tools/bash.ts — Execute shell commands with terminal panel mirroring.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolContext } from './index';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes

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
    // 中文注释：功能名称「Bash 工具直连执行+终端镜像」，用法是直接通过 bash -c 执行命令，
    // 同时通过 SSE 将命令和输出镜像到终端面板，让用户可以实时看到 AI 执行的命令。
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      // 通过 SSE 将命令发送到终端面板显示
      // 中文注释：功能名称「终端命令镜像」，用法是将 AI 执行的命令通过 SSE 推送到前端终端面板。
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
            // 同时将输出镜像到终端面板
            // 中文注释：功能名称「终端输出镜像」，用法是将命令输出实时推送到终端面板。
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

        const onAbort = () => {
          try {
            if (proc.pid) {
              process.kill(-proc.pid, 'SIGTERM');
              setTimeout(() => {
                try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
              }, 2000);
            }
          } catch {
            proc.kill('SIGTERM');
          }
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        proc.on('close', (code, signal) => {
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

          // 通过 SSE 将退出码发送到终端面板
          // 中文注释：功能名称「终端退出码镜像」，用法是命令执行完毕后推送退出码到终端面板。
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
          resolve(`Error executing command: ${err.message}`);
        });
      });
    },
  });
}
