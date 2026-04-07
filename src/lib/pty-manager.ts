/**
 * PTY Manager — manages pseudo-terminal instances via node-pty.
 * Each terminal session gets a unique ID and a spawned shell process.
 */
import * as os from 'os';

// node-pty is a native module; lazy-load to avoid build issues
let pty: typeof import('node-pty') | null = null;
function getPty() {
  if (!pty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pty = require('node-pty');
  }
  return pty!;
}

export interface PtySession {
  id: string;
  process: ReturnType<typeof import('node-pty').spawn>;
  cwd: string;
  createdAt: number;
}

const sessions = new Map<string, PtySession>();

/** Get the default shell for the current platform */
function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/** Create a new PTY session */
export function createPtySession(id: string, cwd: string, cols = 120, rows = 30): PtySession {
  // Kill existing session with same ID
  killPtySession(id);

  const shell = getDefaultShell();
  const nodePty = getPty();

  const proc = nodePty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>,
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

/** Get an existing PTY session */
export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id);
}

/** Write data to a PTY session */
export function writePtySession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.write(data);
  return true;
}

/** Resize a PTY session */
export function resizePtySession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.resize(cols, rows);
  } catch {
    // ignore resize errors
  }
  return true;
}

/** Kill a PTY session */
export function killPtySession(id: string): boolean {
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

/** List all active PTY sessions */
export function listPtySessions(): { id: string; cwd: string; createdAt: number }[] {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    createdAt: s.createdAt,
  }));
}

/** Kill all PTY sessions */
export function killAllPtySessions(): void {
  for (const [id] of sessions) {
    killPtySession(id);
  }
}
