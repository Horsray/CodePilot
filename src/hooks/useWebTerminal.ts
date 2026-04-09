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
  // 终端后端开关：桌面端暂时强制走 HTTP+SSE，绕过 Electron IPC 写入链路不稳定问题。
  const useElectronBackend = false;
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const terminalIdRef = useRef<string>("");
  const backendRef = useRef<"electron" | "http">("http");
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
        if (useElectronBackend && backendRef.current === "electron" && terminalApi) {
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
      if (useElectronBackend && terminalApi) {
        try {
          await terminalApi.create({
            id,
            // 终端创建：空工作目录时传空字符串，让桌面端自动回退到系统可用目录（避免 "/" 在部分平台不可用）。
            cwd: workingDirectory || "",
            cols,
            rows,
          });
          // 后端选择：优先使用 Electron IPC，失败时自动回退到 HTTP 路径。
          backendRef.current = "electron";
          setConnected(true);
          return;
        } catch (electronErr) {
          console.warn("[terminal] electron backend create failed, fallback to http backend", electronErr);
        }
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
      // 后端选择：HTTP create 成功后，后续读写统一走 HTTP + SSE。
      backendRef.current = "http";

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
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Failed to create web terminal (id=${id}): ${detail}`;
      console.error(message, err);
      setExited(true);
      throw err instanceof Error ? new Error(message, { cause: err }) : new Error(message);
    }
  }, [workingDirectory, sessionId]);

  const write = useCallback(async (data: string) => {
    if (!terminalIdRef.current) return;
    
    const terminalApi = window.electronAPI?.terminal;
    try {
      if (useElectronBackend && backendRef.current === "electron" && terminalApi) {
        // 输入写入：必须 await，确保 IPC 失败能进入 catch，避免“可显示但无法输入”静默失败。
        await terminalApi.write(terminalIdRef.current, data);
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
      if (useElectronBackend && backendRef.current === "electron" && terminalApi) {
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
      if (useElectronBackend && backendRef.current === "electron" && terminalApi) {
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
    backendRef.current = "http";
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
    if (!useElectronBackend || !terminalApi) {
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
      if (useElectronBackend && terminalIdRef.current) {
        terminalApi.kill(terminalIdRef.current).catch(() => {});
      }
    };
  }, [useElectronBackend]);

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
