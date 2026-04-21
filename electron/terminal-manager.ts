import * as os from 'os';
import * as fs from 'fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { IPty } from 'node-pty';

let pty: typeof import('node-pty') | null = null;

function getPty() {
  if (!pty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pty = require('node-pty');
  }
  return pty as typeof import('node-pty');
}

export interface TerminalCreateOptions {
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

interface TerminalInstance {
  mode: 'pty' | 'spawn';
  process: IPty | ChildProcessWithoutNullStreams;
  cwd: string;
}

export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private onData: ((id: string, data: string) => void) | null = null;
  private onExit: ((id: string, code: number) => void) | null = null;

  setOnData(handler: (id: string, data: string) => void) {
    this.onData = handler;
  }

  setOnExit(handler: (id: string, code: number) => void) {
    this.onExit = handler;
  }

  private getShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/zsh';
  }

  private getShellArgs(): string[] {
    if (process.platform === 'win32') {
      return [];
    }
    return ['-il'];
  }

  private resolveCwd(cwd?: string): string {
    // 终端工作目录兜底：优先使用传入目录，不可用时回退到 home，再回退到当前进程目录。
    if (cwd && fs.existsSync(cwd)) {
      try {
        if (fs.statSync(cwd).isDirectory()) {
          return cwd;
        }
      } catch {
        // ignore and fallback
      }
    }
    return os.homedir() || process.cwd();
  }

  create(id: string, opts: TerminalCreateOptions): void {
    if (this.terminals.has(id)) {
      this.kill(id);
    }

    const shell = this.getShell();
    const shellArgs = this.getShellArgs();
    const resolvedCwd = this.resolveCwd(opts.cwd);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
    delete env.CLAUDECODE;

    try {
      const nodePty = getPty();
      const proc = nodePty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: resolvedCwd,
        env,
      });

      proc.onData((data: string) => {
        this.onData?.(id, data);
      });

      proc.onExit(({ exitCode }) => {
        this.terminals.delete(id);
        this.onExit?.(id, exitCode ?? 0);
      });

      this.terminals.set(id, { mode: 'pty', process: proc, cwd: resolvedCwd });
      return;
    } catch (err) {
      console.error('[terminal-manager] node-pty spawn failed, fallback to child_process.spawn:', err);
    }

    let fallbackShell = shell;
    let fallbackArgs = shellArgs;
    
    // For non-PTY fallback, just use -i to force interactive shell
    fallbackArgs = ['-i'];

    const child = spawn(fallbackShell, fallbackArgs, {
      cwd: resolvedCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      this.onData?.(id, data.toString());
    });

    child.stderr.on('data', (data: Buffer) => {
      this.onData?.(id, data.toString());
    });

    child.on('exit', (code) => {
      this.terminals.delete(id);
      this.onExit?.(id, code ?? 0);
    });

    child.on('error', (error) => {
      console.error(`[terminal:${id}] spawn error:`, error);
      this.terminals.delete(id);
      this.onExit?.(id, 1);
    });

    this.terminals.set(id, { mode: 'spawn', process: child, cwd: resolvedCwd });
  }

  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      console.error('[terminal-manager] write called but terminal not found:', id);
      return;
    }
    if (terminal.mode === 'pty') {
      (terminal.process as IPty).write(data);
      return;
    }
    (terminal.process as ChildProcessWithoutNullStreams).stdin.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }
    if (terminal.mode === 'pty') {
      (terminal.process as IPty).resize(cols, rows);
    }
  }

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      try {
        if (terminal.mode === 'pty') {
          (terminal.process as IPty).kill();
        } else {
          (terminal.process as ChildProcessWithoutNullStreams).kill();
        }
      } catch (err) {
        console.warn(`[terminal-manager] error killing terminal ${id}:`, err);
      }
      this.terminals.delete(id);
    }
  }

  killAll(): void {
    for (const [id] of this.terminals) {
      this.kill(id);
    }
  }
}
