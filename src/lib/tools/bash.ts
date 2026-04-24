/**
 * tools/bash.ts — Bash tool with dual execution strategy.
 *
 * - Primary agent (executionMode='pty'): uses shared PTY session for terminal mirroring
 * - Sub-agent (executionMode='spawn'): uses isolated child_process.spawn —
 *   no shared state, no contention, each command is an independent process
 *
 * Smart timeout: detects command complexity and adjusts timeout automatically.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import { executeCommandInPtySession, ensurePtySession, ensurePtyOutputBuffered } from '@/lib/pty-manager';
import type { ToolContext } from './index';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes
const MAX_TIMEOUT_MS = 300_000;       // 5 minutes

const AI_PTY_SESSION_ID = '__codepilot_ai_bash__';

// ── Smart timeout detection ──────────────────────────────────────

/** Commands that are known to be slow — matched against the first token(s). */
const SLOW_COMMAND_TIMEOUTS: Array<{ pattern: RegExp; timeoutMs: number }> = [
  // Package managers (install, update, audit)
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(install|i|add|update|audit|ci)\b/, timeoutMs: 300_000 },
  // Build tools
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(build|compile|package)\b/, timeoutMs: 300_000 },
  { pattern: /\b(make|cmake|ninja|gradle|mvn|cargo)\b/, timeoutMs: 300_000 },
  // Test suites
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(test|e2e|smoke)\b/, timeoutMs: 300_000 },
  { pattern: /\b(jest|vitest|mocha|pytest|go\s+test|cargo\s+test)\b/, timeoutMs: 300_000 },
  // Docker
  { pattern: /\b(docker)\s+(build|pull|push)\b/, timeoutMs: 300_000 },
  // Git operations on large repos
  { pattern: /\b(git)\s+(clone|fetch|pull|push|rebase)\b/, timeoutMs: 180_000 },
  // Linting / formatting large codebases
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(lint|format|check)\b/, timeoutMs: 180_000 },
  { pattern: /\b(eslint|prettier|tsc|typecheck)\b/, timeoutMs: 180_000 },
];

function detectSmartTimeout(command: string, userTimeout?: number): number {
  if (userTimeout) return userTimeout;
  for (const { pattern, timeoutMs } of SLOW_COMMAND_TIMEOUTS) {
    if (pattern.test(command)) return timeoutMs;
  }
  return DEFAULT_TIMEOUT_MS;
}

// ── Sub-agent spawn execution (isolated, no PTY) ────────────────

function executeViaSpawn(
  command: string,
  cwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  emitSSE: ToolContext['emitSSE'],
): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;
    let isResolved = false;

    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: {
        ...process.env,
        TERM: 'dumb',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
        DEBIAN_FRONTEND: 'noninteractive',
        NPM_CONFIG_YES: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const collect = (data: Buffer) => {
      if (truncated) return;
      totalBytes += data.length;
      let chunkStr = '';
      if (totalBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        const allowedLen = MAX_OUTPUT_BYTES - (totalBytes - data.length);
        const allowed = allowedLen > 0 ? data.subarray(0, allowedLen) : Buffer.alloc(0);
        chunks.push(allowed);
        chunkStr = allowed.toString('utf-8');
      } else {
        chunks.push(data);
        chunkStr = data.toString('utf-8');
      }
      if (emitSSE && chunkStr) {
        emitSSE({ type: 'tool_output', data: chunkStr });
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
        try { proc.kill('SIGKILL'); } catch {}
      }
    };

    const onAbort = () => { if (!isResolved) { killProc(); } };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    const finish = (output: string) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(absoluteTimer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(output);
    };

    const absoluteTimer = setTimeout(() => {
      killProc();
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      let output = Buffer.concat(chunks).toString('utf-8');
      if (truncated) output += '\n\n[Output truncated — exceeded 1MB limit]';
      output += `\n\n[Process killed: Timeout after ${timeoutMs}ms]`;
      if (emitSSE) {
        emitSSE({
          type: 'terminal_mirror',
          data: JSON.stringify({ action: 'exit', exitCode: -1, signal: 'SIGTERM' }),
        });
      }
      finish(output);
    }, timeoutMs + 1000);

    proc.on('close', (code, signal) => {
      let output = Buffer.concat(chunks).toString('utf-8');
      if (truncated) output += '\n\n[Output truncated — exceeded 1MB limit]';
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        output += `\n\n[Process killed: ${signal}]`;
      }
      if (code !== null && code !== 0) {
        output += `\n\n[Exit code: ${code}]`;
      }
      if (emitSSE) {
        emitSSE({
          type: 'terminal_mirror',
          data: JSON.stringify({ action: 'exit', exitCode: code ?? 0, signal: signal || undefined }),
        });
      }
      finish(output || '(no output)');
    });

    proc.on('error', (err) => {
      finish(`Error executing command: ${err.message}`);
    });
  });
}

// ── PTY execution (primary agent, shared session) ───────────────

async function executeViaPty(
  command: string,
  cwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  emitSSE: ToolContext['emitSSE'],
): Promise<string> {
  ensurePtySession(AI_PTY_SESSION_ID, cwd);
  ensurePtyOutputBuffered(AI_PTY_SESSION_ID);

  const output = await executeCommandInPtySession(
    AI_PTY_SESSION_ID,
    cwd,
    command,
    timeoutMs,
    abortSignal,
    (chunkStr) => {
      if (emitSSE && chunkStr) {
        emitSSE({ type: 'tool_output', data: chunkStr });
      }
    },
  );

  if (emitSSE) {
    emitSSE({
      type: 'terminal_mirror',
      data: JSON.stringify({ action: 'exit', exitCode: 0 }),
    });
  }

  return output;
}

// ── Tool factory ─────────────────────────────────────────────────

export function createBashTool(ctx: ToolContext) {
  const isSpawnMode = ctx.executionMode === 'spawn';

  return tool({
    description:
      'Execute a bash command and return its output (stdout + stderr combined). ' +
      'The command runs in the working directory. Use for system operations, ' +
      'running tests, installing packages, git commands, etc. ' +
      'Long-running commands are automatically killed after the timeout. ' +
      'IMPORTANT: Commands are run non-interactively. NEVER run commands that require user input or open a pager (e.g., use `git log --no-pager` or `PAGER=cat`).',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      timeout: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
        .describe('Timeout in milliseconds (default 120000, auto-detected for slow commands)'),
    }),
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = detectSmartTimeout(command, timeout);

      // Emit command to terminal panel
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

      // Sub-agent path: direct spawn, no PTY contention
      if (isSpawnMode) {
        return executeViaSpawn(command, ctx.workingDirectory, timeoutMs, abortSignal, ctx.emitSSE);
      }

      // Primary agent path: PTY first, fallback to spawn
      try {
        return await executeViaPty(command, ctx.workingDirectory, timeoutMs, abortSignal, ctx.emitSSE);
      } catch (ptyError) {
        console.warn('[bash-tool] PTY execution failed, falling back to spawn:', ptyError);
        return executeViaSpawn(command, ctx.workingDirectory, timeoutMs, abortSignal, ctx.emitSSE);
      }
    },
  });
}
