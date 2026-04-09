/**
 * Terminal SSE stream — Server-Sent Events endpoint for real-time terminal output.
 * Client connects via EventSource, receives terminal output as SSE events.
 */
import { NextRequest } from 'next/server';
import { getPtySession } from '@/lib/pty-manager';
import { drainTerminalOutput } from '@/lib/terminal-output-store';

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

      // Subscribe to PTY output
      const dataHandler = session.process.onData((data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data })}\n\n`));
        } catch {
          // Stream closed
        }
      });

      const exitHandler = session.process.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'exit', exitCode })}\n\n`));
          controller.close();
        } catch {
          // Stream already closed
        }
      });

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        dataHandler.dispose();
        exitHandler.dispose();
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
