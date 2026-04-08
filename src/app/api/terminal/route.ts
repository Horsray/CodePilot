import { NextRequest, NextResponse } from 'next/server';
import {
  createPtySession,
  writePtySession,
  resizePtySession,
  killPtySession,
  getPtySession,
  listPtySessions,
} from '@/lib/pty-manager';
import {
  appendTerminalOutput,
  clearTerminalOutput,
  drainTerminalOutput,
  resetTerminalOutput,
} from '@/lib/terminal-output-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Terminal PTY API — REST-based terminal management.
 *
 * POST: create / write / resize / kill terminal sessions
 * GET:  read output from a terminal session (polling)
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, cwd, cols, rows, data } = body;

    switch (action) {
      case 'create': {
        if (!id) {
          return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }
        const session = createPtySession(id, cwd || process.cwd(), cols || 120, rows || 30);

        // Wire up output buffering
        resetTerminalOutput(id);
        session.process.onData((chunk: string) => {
          appendTerminalOutput(id, chunk);
        });
        session.process.onExit(({ exitCode }: { exitCode: number }) => {
          appendTerminalOutput(id, `\r\n[Process exited with code ${exitCode}]\r\n`);
        });

        return NextResponse.json({ success: true, id: session.id, cwd: session.cwd });
      }

      case 'write': {
        if (!id || data === undefined) {
          return NextResponse.json({ error: 'id and data are required' }, { status: 400 });
        }
        const ok = writePtySession(id, data);
        if (!ok) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      }

      case 'resize': {
        if (!id || !cols || !rows) {
          return NextResponse.json({ error: 'id, cols, and rows are required' }, { status: 400 });
        }
        const ok = resizePtySession(id, cols, rows);
        if (!ok) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      }

      case 'kill': {
        if (!id) {
          return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }
        killPtySession(id);
        clearTerminalOutput(id);
        return NextResponse.json({ success: true });
      }

      case 'list': {
        return NextResponse.json({ sessions: listPtySessions() });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Terminal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Poll terminal output */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const session = getPtySession(id);
  const output = drainTerminalOutput(id);
  const alive = !!session;

  if (!alive && output.length === 0) {
    return NextResponse.json({ error: 'Session not found', alive: false }, { status: 404 });
  }

  return NextResponse.json({
    output,
    alive,
  });
}
