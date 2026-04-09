/**
 * PTY Manager — manages pseudo-terminal instances via node-pty.
 *
 * A real PTY is required for an interactive shell prompt, cursor movement,
 * readline support, and full-screen terminal programs. The API surface is
 * intentionally thin so the HTTP + SSE routes can stay stable.
 */
import * as os from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { IPty } from 'node-pty';
import { appendTerminalOutput } from './terminal-output-store';

// node-pty is native; lazy-load it inside the Node runtime.
let pty: typeof import('node-pty') | null = null;
let ptyLoadError: Error | null = null;

function getPty() {
  if (ptyLoadError) return null;
  if (!pty) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty');
    } catch (err) {
      ptyLoadError = err instanceof Error ? err : new Error(String(err));
      console.error('[pty-manager] Failed to load node-pty:', ptyLoadError);
      return null;
    }
  }
  return pty as typeof import('node-pty');
}

export interface PtySession {
  id: string;
  process: IPty | ChildProcessWithoutNullStreams;
  mode: 'pty' | 'spawn';
  cwd: string;
  createdAt: number;
}

const GLOBAL_SESSIONS_KEY = '__codepilot_terminal_sessions__' as const;
const GLOBAL_OUTPUT_WIRED_KEY = '__codepilot_terminal_output_wired__' as const;
const GLOBAL_COMMAND_QUEUE_KEY = '__codepilot_terminal_command_queues__' as const;

function getSessionStore(): Map<string, PtySession> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_SESSIONS_KEY]) {
    globalScope[GLOBAL_SESSIONS_KEY] = new Map<string, PtySession>();
  }
  return globalScope[GLOBAL_SESSIONS_KEY] as Map<string, PtySession>;
}

function getOutputWiredStore(): Set<string> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_OUTPUT_WIRED_KEY]) {
    globalScope[GLOBAL_OUTPUT_WIRED_KEY] = new Set<string>();
  }
  return globalScope[GLOBAL_OUTPUT_WIRED_KEY] as Set<string>;
}

function getCommandQueueStore(): Map<string, Promise<unknown>> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_COMMAND_QUEUE_KEY]) {
    globalScope[GLOBAL_COMMAND_QUEUE_KEY] = new Map<string, Promise<unknown>>();
  }
  return globalScope[GLOBAL_COMMAND_QUEUE_KEY] as Map<string, Promise<unknown>>;
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function createPtySession(id: string, cwd: string, cols = 120, rows = 30): PtySession {
  const sessions = getSessionStore();
  killPtySession(id);

  const shell = getDefaultShell();
  const nodePty = getPty();
  const nodeEnv: 'development' | 'production' | 'test' =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
      ? process.env.NODE_ENV
      : 'production';

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: nodeEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: String(cols),
    LINES: String(rows),
  } as Record<string, string>;
  // Allow launching Claude Code inside the terminal
  delete env.CLAUDECODE;

  const shellArgs = process.platform === 'win32' ? [] : ['-il'];

  if (nodePty) {
    try {
      const proc = nodePty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: cwd || os.homedir(),
        env,
      });

      const session: PtySession = {
        id,
        process: proc,
        mode: 'pty',
        cwd,
        createdAt: Date.now(),
      };

      sessions.set(id, session);
      return session;
    } catch (err) {
      console.warn('[pty-manager] nodePty.spawn failed, falling back to child_process.spawn:', err);
    }
  }

  // Fallback to child_process.spawn (limited functionality)
  const proc = spawn(shell, shellArgs, {
    cwd: cwd || os.homedir(),
    env: env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session: PtySession = {
    id,
    process: proc,
    mode: 'spawn',
    cwd,
    createdAt: Date.now(),
  };

  sessions.set(id, session);
  return session;
}

export function ensurePtySession(id: string, cwd: string, cols = 120, rows = 30): PtySession {
  const session = getPtySession(id);
  if (session) {
    try {
      if (session.mode === 'pty') {
        (session.process as IPty).resize(cols, rows);
      }
    } catch {
    }
    return session;
  }
  return createPtySession(id, cwd, cols, rows);
}

export function ensurePtyOutputBuffered(id: string): void {
  const wired = getOutputWiredStore();
  if (wired.has(id)) return;
  const session = getPtySession(id);
  if (!session) return;

  wired.add(id);
  if (session.mode === 'pty') {
    const proc = session.process as IPty;
    proc.onData((chunk: string) => {
      appendTerminalOutput(id, chunk);
    });
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      appendTerminalOutput(id, `\r\n[Process exited with code ${exitCode}]\r\n`);
      wired.delete(id);
    });
  } else {
    const proc = session.process as ChildProcessWithoutNullStreams;
    proc.stdout.on('data', (data: Buffer) => {
      appendTerminalOutput(id, data.toString());
    });
    proc.stderr.on('data', (data: Buffer) => {
      appendTerminalOutput(id, data.toString());
    });
    proc.on('exit', (code) => {
      appendTerminalOutput(id, `\r\n[Process exited with code ${code}]\r\n`);
      wired.delete(id);
    });
  }
}

function enqueuePtyCommand<T>(id: string, task: () => Promise<T>): Promise<T> {
  const queues = getCommandQueueStore();
  const previous = queues.get(id) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);
  queues.set(id, next);
  next.finally(() => {
    if (queues.get(id) === next) {
      queues.delete(id);
    }
  });
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeCapturedOutput(command: string, captured: string): string {
  const plainCaptured = captured
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/\u0008/g, '')
    .replace(/\r/g, '');
  const normalizedCommandLines = new Set(
    command
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const cleaned = plainCaptured
    .split('\n')
    .map((line) => line.replace(/^.*?%\s*/, '').trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if ([...normalizedCommandLines].some((commandLine) => trimmed.includes(commandLine))) return false;
      if (trimmed === '__codepilot_status=$?') return false;
      if (trimmed.includes('__codepilot_status=$?')) return false;
      if (trimmed === 'stty echo' || trimmed === 'stty -echo') return false;
      if (trimmed.includes('__CODEPILOT_CMD_END_')) return false;
      return true;
    });

  return cleaned.join('\n');
}

export async function executeCommandInPtySession(
  id: string,
  cwd: string,
  command: string,
  timeoutMs = 120_000,
  abortSignal?: AbortSignal,
): Promise<string> {
  return enqueuePtyCommand(id, async () => {
    const session = ensurePtySession(id, cwd);
    ensurePtyOutputBuffered(id);

    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const startMarker = `__CODEPILOT_CMD_START_${token}__`;
    const endMarker = `__CODEPILOT_CMD_END_${token}__`;
    const startRegex = new RegExp(`(?:\\r?\\n|^)${escapeRegExp(startMarker)}\\r?\\n`);
    const endRegex = new RegExp(`(?:\\r?\\n|^)${escapeRegExp(endMarker)}:(\\d+)__\\r?\\n?`);
    const maxCaptureLength = 1024 * 1024;

    return new Promise<string>((resolve) => {
      let started = false;
      let finished = false;
      let exitCode: number | null = null;
      let rawBuffer = '';
      let captured = '';
      let truncated = false;

      const appendCaptured = (text: string) => {
        if (!text || truncated) return;
        if (captured.length + text.length > maxCaptureLength) {
          captured += text.slice(0, Math.max(0, maxCaptureLength - captured.length));
          truncated = true;
          return;
        }
        captured += text;
      };

      const finalize = (suffix?: string) => {
        if (finished) return;
        finished = true;
        dataDisposable.dispose();
        abortSignal?.removeEventListener('abort', handleAbort);
        clearTimeout(timeoutHandle);

        let output = sanitizeCapturedOutput(command, captured.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
        if (truncated) {
          output += `${output ? '\n\n' : ''}[Output truncated — exceeded 1MB limit]`;
        }
        if (suffix) {
          output += `${output ? '\n\n' : ''}${suffix}`;
        } else if (exitCode !== null && exitCode !== 0) {
          output += `${output ? '\n\n' : ''}[Exit code: ${exitCode}]`;
        }
        resolve(output || '(no output)');
      };

      const consumeChunk = (chunk: string) => {
        rawBuffer += chunk;
        if (!started) {
          const startMatch = rawBuffer.match(startRegex);
          if (!startMatch || startMatch.index === undefined) {
            rawBuffer = rawBuffer.slice(-(startMarker.length + 8));
            return;
          }
          started = true;
          rawBuffer = rawBuffer.slice(startMatch.index + startMatch[0].length);
        }

        const match = rawBuffer.match(endRegex);
        if (!match || match.index === undefined) {
          if (rawBuffer.length > endMarker.length * 2) {
            const safeLength = rawBuffer.length - endMarker.length * 2;
            appendCaptured(rawBuffer.slice(0, safeLength));
            rawBuffer = rawBuffer.slice(safeLength);
          }
          return;
        }

        appendCaptured(rawBuffer.slice(0, match.index));
        exitCode = Number.parseInt(match[1] || '0', 10);
        finalize();
      };

      const handleAbort = () => {
        // 中文注释：中断命令时仅在 TTY 场景尝试恢复回显，避免 spawn 回退模式报 stty 错误。
        writePtySession(id, '\u0003\n[ -t 0 ] && stty echo 2>/dev/null || true\n');
        finalize('[Process killed: SIGTERM]');
      };

      let dataDisposable: { dispose: () => void };
      if (session.mode === 'pty') {
        const proc = session.process as IPty;
        const d = proc.onData((chunk: string) => {
          consumeChunk(chunk);
        });
        dataDisposable = { dispose: () => d.dispose() };
      } else {
        const proc = session.process as ChildProcessWithoutNullStreams;
        const handler = (data: Buffer) => {
          consumeChunk(data.toString());
        };
        proc.stdout.on('data', handler);
        proc.stderr.on('data', handler);
        dataDisposable = {
          dispose: () => {
            proc.stdout.removeListener('data', handler);
            proc.stderr.removeListener('data', handler);
          }
        };
      }

      abortSignal?.addEventListener('abort', handleAbort, { once: true });

      const timeoutHandle = setTimeout(() => {
        // 中文注释：超时终止时同样做安全回显恢复，保证手动输入不会被永久隐藏。
        writePtySession(id, '\u0003\n[ -t 0 ] && stty echo 2>/dev/null || true\n');
        finalize('[Process killed: SIGTERM]');
      }, timeoutMs);

      const wrappedCommand = [
        // 中文注释：仅在交互式终端里关闭回显，避免非 TTY 下出现 "stdin isn\'t a terminal"。
        '__codepilot_has_tty=0',
        '[ -t 0 ] && __codepilot_has_tty=1 || true',
        '[ "$__codepilot_has_tty" = "1" ] && __codepilot_prev_stty="$(stty -g 2>/dev/null || true)" || true',
        '[ "$__codepilot_has_tty" = "1" ] && stty -echo 2>/dev/null || true',
        `printf '${startMarker}\\n'`,
        command,
        '__codepilot_status=$?',
        `printf '\\n${endMarker}:%s__\\n' "$__codepilot_status"`,
        // 中文注释：优先恢复原始 stty 状态；拿不到原状态时退化为 stty echo，且始终静默失败。
        '[ "$__codepilot_has_tty" = "1" ] && { [ -n "$__codepilot_prev_stty" ] && stty "$__codepilot_prev_stty" 2>/dev/null || stty echo 2>/dev/null; } || true',
      ].join('\n');

      writePtySession(id, `${wrappedCommand}\n`);
    });
  });
}

export function getPtySession(id: string): PtySession | undefined {
  const sessions = getSessionStore();
  return sessions.get(id);
}

export function writePtySession(id: string, data: string): boolean {
  const sessions = getSessionStore();
  const session = sessions.get(id);
  if (!session) return false;
  if (session.mode === 'pty') {
    (session.process as IPty).write(data);
  } else {
    (session.process as ChildProcessWithoutNullStreams).stdin.write(data);
  }
  return true;
}

export function resizePtySession(id: string, cols: number, rows: number): boolean {
  const sessions = getSessionStore();
  const session = sessions.get(id);
  if (!session || session.mode !== 'pty') return false;
  try {
    (session.process as IPty).resize(cols, rows);
  } catch {
    return false;
  }
  return true;
}

export function killPtySession(id: string): boolean {
  const sessions = getSessionStore();
  const wired = getOutputWiredStore();
  const queues = getCommandQueueStore();
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.kill();
  } catch {
    // ignore
  }
  sessions.delete(id);
  wired.delete(id);
  queues.delete(id);
  return true;
}

export function listPtySessions(): { id: string; cwd: string; createdAt: number }[] {
  const sessions = getSessionStore();
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    createdAt: s.createdAt,
  }));
}

export function killAllPtySessions(): void {
  const sessions = getSessionStore();
  for (const [id] of sessions) {
    killPtySession(id);
  }
}
