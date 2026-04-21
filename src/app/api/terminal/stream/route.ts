/**
 * Terminal SSE stream — Server-Sent Events endpoint for real-time terminal output.
 * Client connects via EventSource, receives terminal output as SSE events.
 */
import { NextRequest } from 'next/server';
import { getPtySession } from '@/lib/pty-manager';
import { drainTerminalOutput } from '@/lib/terminal-output-store';
import type { IPty } from 'node-pty';
import type { ChildProcessWithoutNullStreams } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('id is required', { status: 400 });
  }

  const session = getPtySession(id);
  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', id })}\n\n`));

      const initialOutput = drainTerminalOutput(id);
      if (initialOutput) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data: initialOutput })}\n\n`));
      }

      let dataHandler: { dispose: () => void } | null = null;
      let exitHandler: { dispose: () => void } | null = null;

      // Subscribe to PTY output
      if (session.mode === 'pty') {
        const proc = session.process as IPty;
        const dh = proc.onData((data: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data })}\n\n`));
          } catch {
            // Stream closed
          }
        });
        dataHandler = { dispose: () => dh.dispose() };

        const eh = proc.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'exit', exitCode })}\n\n`));
            controller.close();
          } catch {
            // Stream already closed
          }
        });
        exitHandler = { dispose: () => eh.dispose() };
      } else {
        const proc = session.process as ChildProcessWithoutNullStreams;
        const onData = (data: Buffer) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data: data.toString() })}\n\n`));
          } catch { /* ignore */ }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        dataHandler = {
          dispose: () => {
            proc.stdout.removeListener('data', onData);
            proc.stderr.removeListener('data', onData);
          }
        };

        const onExit = (exitCode: number | null) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'exit', exitCode: exitCode ?? 0 })}\n\n`));
            controller.close();
          } catch { /* ignore */ }
        };
        proc.on('exit', onExit);
        exitHandler = {
          dispose: () => {
            proc.removeListener('exit', onExit);
          }
        };
      }

      // Heartbeat timer to keep connection alive
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 15000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        dataHandler?.dispose();
        exitHandler?.dispose();
        clearInterval(heartbeatTimer);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
