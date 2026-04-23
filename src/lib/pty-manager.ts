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

// node-pty is native; lazy-load it inside the Node runtime to prevent Next.js standalone crashes.
let pty: typeof import('node-pty') | null = null;
let ptyLoadError: Error | null = null;

function getPty() {
  if (ptyLoadError) return null;
  if (!pty) {
    try {
      // Check if we are in Electron packaged app and load from asar.unpacked
      if (process.env.ELECTRON_RUN_AS_NODE || process.versions.electron) {
        const path = require('path');
        const fs = require('fs');
        const asarPath = path.join(process.execPath, '..', '..', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
        if (fs.existsSync(asarPath)) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          pty = require(asarPath);
          return pty as typeof import('node-pty');
        }
      }
      // Fallback for dev mode
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

  let fallbackShell = shell;
  let fallbackArgs = shellArgs;
  let usePty = false;

  // Only use script fallback if we can spawn it inside another PTY (not helpful here because script needs a real PTY on its own stdio to work)
  // Instead, we just spawn bash directly. It will not have a TTY so prompt won't show by default,
  // but we can force it to act interactive by passing -i
  fallbackArgs = ['-i'];

  const proc = spawn(fallbackShell, fallbackArgs, {
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

function sanitizeCapturedOutput(command: string, captured: string, startMarker?: string, endMarker?: string): string {
  let plainCaptured = captured;
  if (startMarker) plainCaptured = plainCaptured.replace(new RegExp(`^.*${escapeRegExp(startMarker)}.*$\\r?\\n?`, 'gm'), '');
  if (endMarker) plainCaptured = plainCaptured.replace(new RegExp(`^.*${escapeRegExp(endMarker)}.*$\\r?\\n?`, 'gm'), '');

  plainCaptured = plainCaptured
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
  onData?: (chunk: string) => void,
): Promise<string> {
  return enqueuePtyCommand(id, async () => {
    const session = ensurePtySession(id, cwd);
    ensurePtyOutputBuffered(id);

    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const startMarker = `__CODEPILOT_CMD_START_${token}__`;
    const endMarker = `__CODEPILOT_CMD_END_${token}__`;
    const startRegex = new RegExp(escapeRegExp(startMarker));
    const endRegex = new RegExp(`${escapeRegExp(endMarker)}:(\\d+)__`);
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

        let output = sanitizeCapturedOutput(command, captured.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), startMarker, endMarker);
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
            const safeChunk = rawBuffer.slice(0, safeLength);
            appendCaptured(safeChunk);
            onData?.(safeChunk);
            rawBuffer = rawBuffer.slice(safeLength);
          }
          return;
        }

        const finalChunk = rawBuffer.slice(0, match.index);
        appendCaptured(finalChunk);
        onData?.(finalChunk);
        exitCode = Number.parseInt(match[1] || '0', 10);
        finalize();
      };

      const handleAbort = () => {
        // 中文注释：中断命令时仅在 TTY 场景尝试恢复回显，避免 spawn 回退模式报 stty 错误。
        writePtySession(id, '\u0003\n[ -t 0 ] && stty echo 2>/dev/null || true\n');
        
        setTimeout(() => {
          if (!finished) {
            console.warn(`[pty-manager] Session ${id} did not respond to SIGINT within 2s after abort. Killing PTY session to prevent head-of-line blocking.`);
            killPtySession(id);
          }
        }, 2000);

        finalize('[Process killed: SIGINT (Aborted)]');
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
        // 发送 SIGINT 尝试优雅中断
        writePtySession(id, '\u0003\n[ -t 0 ] && stty echo 2>/dev/null || true\n');
        
        // 增加一个短延迟，如果 PTY 没有响应 \u0003，说明该 PTY 会话已经“变砖”或死锁。
        // 为了不影响后续排队的命令，我们必须直接杀掉并销毁整个 PTY 会话。
        setTimeout(() => {
          if (!finished) {
            console.warn(`[pty-manager] Session ${id} did not respond to SIGINT within 2s after timeout. Killing PTY session to prevent head-of-line blocking.`);
            killPtySession(id);
          }
        }, 2000);

        finalize('[Process killed: SIGTERM (Timeout)]');
      }, timeoutMs);

      const wrappedCommand = [
        'export PAGER=cat',
        'export GIT_PAGER=cat',
        'export DEBIAN_FRONTEND=noninteractive',
        'export NPM_CONFIG_YES=true',
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
    // Fallback: manually echo typed characters because a raw pipe shell won't echo them.
    let echoData = data;
    let writeData = data;
    
    if (data === '\r') {
      echoData = '\r\n'; // Echo newline
      writeData = '\n';  // Send LF to shell
    } else if (data === '\x7f' || data === '\b') {
      echoData = '\b \b'; // Visually erase character
    }
    
    appendTerminalOutput(id, echoData);
    (session.process as ChildProcessWithoutNullStreams).stdin.write(writeData);
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
