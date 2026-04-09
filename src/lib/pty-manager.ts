/**
 * PTY Manager — manages pseudo-terminal instances via node-pty.
 *
 * A real PTY is required for an interactive shell prompt, cursor movement,
 * readline support, and full-screen terminal programs. The API surface is
 * intentionally thin so the HTTP + SSE routes can stay stable.
 */
import * as os from 'os';
import type { IPty } from 'node-pty';

// node-pty is native; lazy-load it inside the Node runtime.
let pty: typeof import('node-pty') | null = null;

function getPty() {
  if (!pty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pty = require('node-pty');
  }
  return pty as typeof import('node-pty');
}

export interface PtySession {
  id: string;
  process: IPty;
  cwd: string;
  createdAt: number;
}

const GLOBAL_SESSIONS_KEY = '__codepilot_terminal_sessions__' as const;

function getSessionStore(): Map<string, PtySession> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_SESSIONS_KEY]) {
    globalScope[GLOBAL_SESSIONS_KEY] = new Map<string, PtySession>();
  }
  return globalScope[GLOBAL_SESSIONS_KEY] as Map<string, PtySession>;
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
    cwd,
    createdAt: Date.now(),
  };

  sessions.set(id, session);
  return session;
}

export function getPtySession(id: string): PtySession | undefined {
  const sessions = getSessionStore();
  return sessions.get(id);
}

export function writePtySession(id: string, data: string): boolean {
  const sessions = getSessionStore();
  const session = sessions.get(id);
  if (!session) return false;
  session.process.write(data);
  return true;
}

export function resizePtySession(id: string, cols: number, rows: number): boolean {
  const sessions = getSessionStore();
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.resize(cols, rows);
  } catch {
    return false;
  }
  return true;
}

export function killPtySession(id: string): boolean {
  const sessions = getSessionStore();
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.kill();
  } catch {
    // ignore
  }
  sessions.delete(id);
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
