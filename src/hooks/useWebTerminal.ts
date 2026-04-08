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
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const terminalIdRef = useRef<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const onExitCallbackRef = useRef<((code: number) => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const create = useCallback(async (cols: number, rows: number) => {
    const terminalApi = window.electronAPI?.terminal;
    const apiUrl = resolveTerminalUrl("/api/terminal");

    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    if (terminalIdRef.current) {
      try {
        if (terminalApi) {
          await terminalApi.kill(terminalIdRef.current);
        } else {
          await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "kill", id: terminalIdRef.current }),
          });
        }
      } catch { /* ignore */ }
    }

    const id = `web-term-${sessionId || 'default'}-${Date.now()}`;
    terminalIdRef.current = id;
    setConnected(false);
    setExited(false);

    try {
      if (terminalApi) {
        await terminalApi.create({
          id,
          cwd: workingDirectory || "/",
          cols,
          rows,
        });
        setConnected(true);
        return;
      }

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
        }
      };

      es.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (terminalIdRef.current !== id) return;

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
        }
      };

      es.onerror = () => {
        if (terminalIdRef.current !== id) return;
        setConnected(false);
      };
    } catch (err) {
      const message = `Failed to create web terminal (id=${id})`;
      console.error(message, err);
      setExited(true);
      throw err instanceof Error ? new Error(message, { cause: err }) : new Error(message);
    }
  }, [workingDirectory, sessionId]);

  const write = useCallback(async (data: string) => {
    if (!terminalIdRef.current) return;
    const terminalApi = window.electronAPI?.terminal;
    try {
      if (terminalApi) {
        terminalApi.write(terminalIdRef.current, data);
        return;
      }

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
    const terminalApi = window.electronAPI?.terminal;
    try {
      if (terminalApi) {
        await terminalApi.resize(terminalIdRef.current, cols, rows);
        return;
      }

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
    const terminalApi = window.electronAPI?.terminal;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    try {
      if (terminalApi) {
        await terminalApi.kill(terminalIdRef.current);
      } else {
        await fetch(resolveTerminalUrl("/api/terminal"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "kill", id: terminalIdRef.current }),
        });
      }
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
    const terminalApi = window.electronAPI?.terminal;
    if (!terminalApi) {
      cleanupRef.current = () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
      };
      return () => {
        cleanupRef.current?.();
      };
    }

    const removeDataListener = terminalApi.onData((event: { id: string; data: string }) => {
      if (event.id === terminalIdRef.current) {
        onDataCallbackRef.current?.(event.data);
      }
    });

    const removeExitListener = terminalApi.onExit((event: { id: string; code: number }) => {
      if (event.id === terminalIdRef.current) {
        setConnected(false);
        setExited(true);
        onExitCallbackRef.current?.(event.code);
      }
    });

    cleanupRef.current = () => {
      removeDataListener();
      removeExitListener();
    };

    return () => {
      cleanupRef.current?.();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (terminalIdRef.current) {
        terminalApi.kill(terminalIdRef.current).catch(() => {});
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
