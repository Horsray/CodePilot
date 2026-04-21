import { NextRequest } from 'next/server';
// import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';

// Global emitter to broadcast file changes to all connected SSE clients
const workspaceEvents = new EventEmitter();
// Increase max listeners to avoid warnings if many tabs are open
workspaceEvents.setMaxListeners(100);

// Global watcher instance map
const watchers = new Map<string, any>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get('cwd');

  if (!cwd) {
    return new Response('Missing cwd parameter', { status: 400 });
  }

  // Initialize watcher if not already watching this directory
  if (!watchers.has(cwd)) {
    watchers.set(cwd, null); // Set a placeholder to prevent concurrent initialization

    import('chokidar').then(chokidar => {
      const watcher = chokidar.watch(cwd, {
        ignored: [
          /(^|[\/\\])\../, // ignore dotfiles
          /node_modules/, // ignore node_modules
          /\.git/, // ignore .git
          /\.next/, // ignore .next
          /dist/, // ignore dist
        ],
        persistent: true,
        ignoreInitial: true,
      });

      // We use a simple debounce mechanism to avoid flooding the client
      // with events when many files change at once (e.g. git checkout)
      let timeout: NodeJS.Timeout | null = null;
      const emitChange = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          workspaceEvents.emit(`change:${cwd}`);
        }, 500);
      };

      watcher
        .on('add', emitChange)
        .on('change', emitChange)
        .on('unlink', emitChange)
        .on('addDir', emitChange)
        .on('unlinkDir', emitChange);

      watchers.set(cwd, watcher);
    }).catch(e => {
      console.error("Failed to load chokidar:", e);
      watchers.delete(cwd);
    });
  }

  // Setup SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      const onChange = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'change' })}\n\n`));
      };

      workspaceEvents.on(`change:${cwd}`, onChange);

      // Keep connection alive
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping' })}\n\n`));
      }, 15000);

      // Handle disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        workspaceEvents.off(`change:${cwd}`, onChange);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
