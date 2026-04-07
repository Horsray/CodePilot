"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { usePanel } from "./usePanel";

/**
 * useWebTerminal — manages a web-based PTY terminal session via REST + SSE.
 * Works in both browser and Electron environments.
 */
export function useWebTerminal() {
  const { workingDirectory, sessionId } = usePanel();
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const terminalIdRef = useRef<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const onExitCallbackRef = useRef<((code: number) => void) | null>(null);

  const create = useCallback(async (cols: number, rows: number) => {
    // Clean up previous session
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (terminalIdRef.current) {
      try {
        await fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill', id: terminalIdRef.current }),
        });
      } catch { /* ignore */ }
    }

    const id = `web-term-${sessionId || 'default'}-${Date.now()}`;
    terminalIdRef.current = id;
    setExited(false);

    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          id,
          cwd: workingDirectory || undefined,
          cols,
          rows,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create terminal');
      }

      // Connect SSE stream for output
      const es = new EventSource(`/api/terminal/stream?id=${encodeURIComponent(id)}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setConnected(true);
          } else if (msg.type === 'output') {
            onDataCallbackRef.current?.(msg.data);
          } else if (msg.type === 'exit') {
            setConnected(false);
            setExited(true);
            onExitCallbackRef.current?.(msg.exitCode);
            es.close();
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        // SSE connection lost — mark as disconnected
        setConnected(false);
      };
    } catch (err) {
      console.error('Failed to create web terminal:', err);
      setExited(true);
    }
  }, [workingDirectory, sessionId]);

  const write = useCallback(async (data: string) => {
    if (!terminalIdRef.current) return;
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'write',
          id: terminalIdRef.current,
          data,
        }),
      });
    } catch { /* ignore */ }
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    if (!terminalIdRef.current) return;
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resize',
          id: terminalIdRef.current,
          cols,
          rows,
        }),
      });
    } catch { /* ignore */ }
  }, []);

  const kill = useCallback(async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (!terminalIdRef.current) return;
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kill', id: terminalIdRef.current }),
      });
    } catch { /* ignore */ }
    terminalIdRef.current = "";
    setConnected(false);
  }, []);

  const setOnData = useCallback((cb: (data: string) => void) => {
    onDataCallbackRef.current = cb;
  }, []);

  const setOnExit = useCallback((cb: (code: number) => void) => {
    onExitCallbackRef.current = cb;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      if (terminalIdRef.current) {
        fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill', id: terminalIdRef.current }),
        }).catch(() => {});
      }
    };
  }, []);

  return {
    connected,
    exited,
    create,
    write,
    resize,
    kill,
    setOnData,
    setOnExit,
  };
}
