"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { usePanel } from "./usePanel";

function resolveTerminalUrl(pathname: string): string {
  if (typeof window === "undefined") return `http://localhost:3000${pathname}`;
  try {
    const url = new URL(pathname, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
  }
  return `http://localhost:3000${pathname}`;
}

/**
 * useWebTerminal — manages a terminal session in both Electron and web preview.
 */
export function useWebTerminal() {
  const { workingDirectory, sessionId } = usePanel();
  const terminalId = `agent-terminal-${sessionId || "default"}`;
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const terminalIdRef = useRef<string>(terminalId);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const onExitCallbackRef = useRef<((code: number) => void) | null>(null);
  const exitedRef = useRef<boolean>(false);
  const reconnectCountRef = useRef<number>(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Keep refs in sync
  useEffect(() => {
    exitedRef.current = exited;
  }, [exited]);

  useEffect(() => {
    reconnectCountRef.current = reconnectCount;
  }, [reconnectCount]);

  const create = useCallback(async (cols: number, rows: number) => {
    const apiUrl = resolveTerminalUrl("/api/terminal");

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    const id = terminalId;
    terminalIdRef.current = id;
    setConnected(false);
    setExited(false);

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          id,
          cwd: workingDirectory || undefined,
          cols,
          rows,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create terminal");
      }

      const streamUrl = resolveTerminalUrl(`/api/terminal/stream?id=${encodeURIComponent(id)}`);
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (terminalIdRef.current === id) {
          setConnected(true);
          setReconnectCount(0);
        }
      };

      es.onmessage = (event) => {
        if (terminalIdRef.current !== id) return;
        
        try {
          const message = JSON.parse(event.data);

          if (message.type === "connected") {
            setConnected(true);
            return;
          }

          if (message.type === "output") {
            onDataCallbackRef.current?.(message.data);
            return;
          }

          if (message.type === "exit") {
            setConnected(false);
            setExited(true);
            onExitCallbackRef.current?.(message.exitCode);
            es.close();
            if (eventSourceRef.current === es) {
              eventSourceRef.current = null;
            }
          }
        } catch {
          // Heartbeat or malformed JSON
        }
      };

      es.onerror = () => {
        if (terminalIdRef.current !== id) return;
        setConnected(false);
        es.close();
        
        // Reconnect if not exited
        if (!exitedRef.current && reconnectCountRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 10000);
          reconnectTimerRef.current = setTimeout(() => {
            setReconnectCount(c => c + 1);
            void create(cols, rows);
          }, delay);
        }
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Failed to create web terminal (id=${id}): ${detail}`;
      console.error(message, err);
      setExited(true);
      throw err instanceof Error ? new Error(message, { cause: err }) : new Error(message);
    }
  }, [terminalId, workingDirectory]);

  const write = useCallback(async (data: string) => {
    if (!terminalIdRef.current) return;
    
    try {
      await fetch(resolveTerminalUrl("/api/terminal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "write",
          id: terminalIdRef.current,
          data,
        }),
      });
    } catch { /* ignore */ }
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    if (!terminalIdRef.current) return;
    try {
      await fetch(resolveTerminalUrl("/api/terminal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resize",
          id: terminalIdRef.current,
          cols,
          rows,
        }),
      });
    } catch { /* ignore */ }
  }, []);

  const kill = useCallback(async () => {
    if (!terminalIdRef.current) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    try {
      await fetch(resolveTerminalUrl("/api/terminal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", id: terminalIdRef.current }),
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

  useEffect(() => {
    cleanupRef.current = () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };

    return () => {
      cleanupRef.current?.();
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
