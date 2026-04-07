import { NextRequest, NextResponse } from 'next/server';
import {
  createPtySession,
  writePtySession,
  resizePtySession,
  killPtySession,
  getPtySession,
  listPtySessions,
} from '@/lib/pty-manager';

/**
 * Terminal PTY API — REST-based terminal management.
 *
 * POST: create / write / resize / kill terminal sessions
 * GET:  read output from a terminal session (polling)
 */

// Buffer terminal output for polling
const outputBuffers = new Map<string, string[]>();
const MAX_BUFFER_SIZE = 1000;

function appendOutput(id: string, data: string) {
  let buf = outputBuffers.get(id);
  if (!buf) {
    buf = [];
    outputBuffers.set(id, buf);
  }
  buf.push(data);
  // Trim old entries
  if (buf.length > MAX_BUFFER_SIZE) {
    buf.splice(0, buf.length - MAX_BUFFER_SIZE);
  }
}

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
        outputBuffers.set(id, []);
        session.process.onData((chunk: string) => {
          appendOutput(id, chunk);
        });
        session.process.onExit(({ exitCode }: { exitCode: number }) => {
          appendOutput(id, `\r\n[Process exited with code ${exitCode}]\r\n`);
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
        outputBuffers.delete(id);
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
  const buf = outputBuffers.get(id);

  if (!buf) {
    return NextResponse.json({ error: 'Session not found', alive: false }, { status: 404 });
  }

  // Drain buffer
  const output = buf.splice(0, buf.length).join('');

  return NextResponse.json({
    output,
    alive: !!session,
  });
}
