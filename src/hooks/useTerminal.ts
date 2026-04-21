"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePanel } from "./usePanel";

/**
 * useTerminal — Electron 桌面端终端 Hook，通过 IPC 连接 TerminalManager。
 * 中文注释：功能名称「Electron 终端会话管理」，用法是创建/写入/调整/销毁 PTY 会话，
 * 并通过回调将 PTY 输出和退出事件传递给 xterm.js 渲染层。
 */
export function useTerminal() {
  const { workingDirectory, sessionId, terminalOpen } = usePanel();
  const [isElectron] = useState(
    () => typeof window !== "undefined" && !!(window as any).electronAPI?.terminal
  );
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const terminalIdRef = useRef<string>("");
  const unsubDataRef = useRef<(() => void) | null>(null);
  const unsubExitRef = useRef<(() => void) | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);
  const onExitCallbackRef = useRef<((code: number) => void) | null>(null);

  const create = useCallback(async (cols: number, rows: number) => {
    const api = (window as any).electronAPI?.terminal;
    if (!api || !workingDirectory) return;

    if (terminalIdRef.current) {
      try {
        await api.kill(terminalIdRef.current);
      } catch {
        // ignore
      }
    }

    const id = `term-${sessionId || 'default'}-${Date.now()}`;
    terminalIdRef.current = id;
    setExited(false);
    setConnected(false);

    unsubDataRef.current?.();
    unsubExitRef.current?.();

    unsubDataRef.current = api.onData((data: any) => {
      if (data.id === id) {
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

    await api.create({ id, cwd: workingDirectory, cols, rows });
    setConnected(true);
  }, [workingDirectory, sessionId]);

  const write = useCallback((data: string) => {
    const api = (window as any).electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    api.write(terminalIdRef.current, data);
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const api = (window as any).electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    await api.resize(terminalIdRef.current, cols, rows);
  }, []);

  const kill = useCallback(async () => {
    const api = (window as any).electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    try {
      await api.kill(terminalIdRef.current);
    } catch {
      // ignore
    }
    terminalIdRef.current = "";
    setConnected(false);
  }, []);

  const setOnData = useCallback((callback: (data: string) => void) => {
    onDataCallbackRef.current = callback;
  }, []);

  // 中文注释：功能名称「终端退出回调注册」，用法是注册 PTY 退出时的回调函数，
  // 让 xterm.js 渲染层可以在进程退出时显示退出码信息。
  const setOnExit = useCallback((callback: (code: number) => void) => {
    onExitCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    return () => {
      unsubDataRef.current?.();
      unsubExitRef.current?.();
      if (terminalIdRef.current && (window as any).electronAPI?.terminal) {
        (window as any).electronAPI.terminal.kill(terminalIdRef.current).catch(() => {});
      }
    };
  }, []);

  return {
    isElectron,
    connected,
    exited,
    terminalOpen,
    create,
    write,
    resize,
    kill,
    setOnData,
    setOnExit,
  };
}
