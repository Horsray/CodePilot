"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { usePanel } from "./usePanel";
import { LocalUrlDetector } from "@/lib/url-detector";

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
  const isElectron = typeof window !== "undefined" && !!(window as any).electronAPI?.terminal;
  const terminalId = `agent-terminal-${sessionId || "default"}`;
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const [isElectronState] = useState(
    () => typeof window !== "undefined" && !!(window as any).electronAPI?.terminal
  );
  const [reconnectCount, setReconnectCount] = useState(0);
  const terminalIdRef = useRef<string>(terminalId);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const onExitCallbackRef = useRef<((code: number) => void) | null>(null);
  const exitedRef = useRef<boolean>(false);
  const reconnectCountRef = useRef<number>(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const urlDetectorRef = useRef(new LocalUrlDetector());

  const unsubDataRef = useRef<(() => void) | null>(null);
  const unsubExitRef = useRef<(() => void) | null>(null);

  // Keep refs in sync
  useEffect(() => {
    exitedRef.current = exited;
  }, [exited]);

  useEffect(() => {
    reconnectCountRef.current = reconnectCount;
  }, [reconnectCount]);

  const create = useCallback(async (cols: number, rows: number, customId?: string) => {
    const id = customId || terminalId;

    if (isElectronState) {
      const api = (window as any).electronAPI?.terminal;
      if (!api) return;

      if (terminalIdRef.current && terminalIdRef.current !== id) {
        try { await api.kill(terminalIdRef.current); } catch {}
      }

      terminalIdRef.current = id;
      setConnected(false);
      setExited(false);
      urlDetectorRef.current.reset();

      unsubDataRef.current?.();
      unsubExitRef.current?.();

      unsubDataRef.current = api.onData((data: any) => {
        if (data.id === id && data.data) {
          urlDetectorRef.current.handleData(data.data);
          onDataCallbackRef.current?.(data.data);
        }
      });

      unsubExitRef.current = api.onExit((data: any) => {
        if (data.id === id) {
          setConnected(false);
          setExited(true);
          onExitCallbackRef.current?.(data.exitCode ?? 0);
        }
      });

      await api.create({ id, cwd: workingDirectory || undefined, cols, rows });
      setConnected(true);
      return;
    }

    const apiUrl = resolveTerminalUrl("/api/terminal");

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    terminalIdRef.current = id;
    setConnected(false);
    setExited(false);
    urlDetectorRef.current.reset();

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          id: customId || terminalId,
          cwd: workingDirectory || undefined,
          cols,
          rows,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create terminal");
      }

      // If backend gave us an ID, use it
      const responseData = await res.json().catch(() => ({ id }));
      const actualId = responseData.id || id;
      terminalIdRef.current = actualId;

      const streamUrl = resolveTerminalUrl(`/api/terminal/stream?id=${encodeURIComponent(actualId)}`);
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (terminalIdRef.current === actualId) {
          setConnected(true);
          setReconnectCount(0);
        }
      };

      es.onmessage = (event) => {
        if (terminalIdRef.current !== actualId) return;
        
        try {
          const message = JSON.parse(event.data);

          if (message.type === "connected") {
            setConnected(true);
            return;
          }

          if (message.type === "output") {
            urlDetectorRef.current.handleData(message.data);
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
        if (terminalIdRef.current !== actualId) return;
        setConnected(false);
        es.close();
        
        // Reconnect if not exited
        if (!exitedRef.current && reconnectCountRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 10000);
          reconnectTimerRef.current = setTimeout(() => {
            setReconnectCount(c => c + 1);
            void create(cols, rows, customId);
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
  }, [terminalId, workingDirectory, isElectronState]);

  const write = useCallback(async (data: string) => {
    if (!terminalIdRef.current) return;

    if (isElectronState) {
      const api = (window as any).electronAPI?.terminal;
      if (api) api.write(terminalIdRef.current, data);
      return;
    }
    
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
  }, [isElectronState]);

  const resize = useCallback(async (cols: number, rows: number) => {
    if (!terminalIdRef.current) return;

    if (isElectronState) {
      const api = (window as any).electronAPI?.terminal;
      if (api) await api.resize(terminalIdRef.current, cols, rows);
      return;
    }

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
  }, [isElectronState]);

  const kill = useCallback(async () => {
    if (!terminalIdRef.current) return;

    if (isElectronState) {
      const api = (window as any).electronAPI?.terminal;
      if (api) {
        try { await api.kill(terminalIdRef.current); } catch {}
      }
      terminalIdRef.current = "";
      setConnected(false);
      return;
    }

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
  }, [isElectronState]);

  const setOnData = useCallback((cb: (data: string) => void) => {
    onDataCallbackRef.current = cb;
  }, []);

  const setOnExit = useCallback((cb: (code: number) => void) => {
    onExitCallbackRef.current = cb;
  }, []);

  useEffect(() => {
    cleanupRef.current = () => {
      unsubDataRef.current?.();
      unsubExitRef.current?.();

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
    isElectron: isElectronState,
    create,
    write,
    resize,
    kill,
    setOnData,
    setOnExit,
  };
}
