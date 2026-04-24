"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "next-themes";

interface XtermTerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (term: Terminal) => void;
}

// 中文注释：功能名称「xterm 模块预加载」，用法是在终端面板打开前提前加载 xterm 及插件模块，
// 消除首次打开时的动态 import 延迟，显著提升终端启动速度。
let _preloadPromise: Promise<unknown> | null = null;
export function preloadXtermModules() {
  if (!_preloadPromise) {
    _preloadPromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-webgl"),
    ]);
  }
  return _preloadPromise;
}

/**
 * XtermTerminal — 渲染 xterm.js 终端，支持完整 ANSI 序列。
 * 懒加载 xterm.js 和插件以避免 SSR 问题。
 * 中文注释：功能名称「xterm 终端渲染」，用法是提供完整的终端交互体验，
 * 支持用户手动输入、AI Bash 工具的命令/输出镜像显示。
 */
export function XtermTerminal({
  onData,
  onResize,
  onReady,
}: XtermTerminalProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);

  // 中文注释：功能名称「终端主题配色」，用法是根据深色/浅色模式返回 macOS 原生风格配色方案，
  // 对标 macOS Terminal.app 和 Trae IDE 的视觉风格。
  const getThemeConfig = useCallback((isDark: boolean) => ({
    background: isDark ? "#1e1e1e" : "#ffffff",
    foreground: isDark ? "#d4d4d4" : "#383a42",
    cursor: isDark ? "#d4d4d4" : "#383a42",
    cursorAccent: isDark ? "#1e1e1e" : "#ffffff",
    selectionBackground: isDark ? "#264f78" : "#add6ff",
    selectionForeground: isDark ? "#ffffff" : "#000000",
    black: isDark ? "#1e1e1e" : "#000000",
    red: isDark ? "#ff5f56" : "#e45649",
    green: isDark ? "#27c93f" : "#50a14f",
    yellow: isDark ? "#ffbd2e" : "#c18401",
    blue: isDark ? "#5ab0f6" : "#4078f2",
    magenta: isDark ? "#d580ff" : "#a626a4",
    cyan: isDark ? "#56d6e0" : "#0184bc",
    white: isDark ? "#d4d4d4" : "#a0a0a0",
    brightBlack: isDark ? "#636363" : "#636363",
    brightRed: isDark ? "#ff7b72" : "#e06c75",
    brightGreen: isDark ? "#7ee787" : "#98c379",
    brightYellow: isDark ? "#f0c674" : "#e5c07b",
    brightBlue: isDark ? "#79c0ff" : "#61afef",
    brightMagenta: isDark ? "#d2a8ff" : "#c678dd",
    brightCyan: isDark ? "#79dafa" : "#56b6c2",
    brightWhite: isDark ? "#ffffff" : "#ffffff",
  }), []);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!containerRef.current || readyRef.current) return;
    readyRef.current = true;

    let term: Terminal;
    let fitAddon: FitAddon;
    let disposed = false;

    async function init() {
      const [xtermMod, fitMod, webglMod] = await preloadXtermModules() as [typeof import("@xterm/xterm"), typeof import("@xterm/addon-fit"), typeof import("@xterm/addon-webgl")];

      if (disposed) return;

      // 中文注释：终端配置对标 macOS 原生 Terminal.app 和 Trae IDE 风格，
      // 小字体(12px)、紧凑行高、等宽字体、左侧内边距。
      term = new xtermMod.Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.15,
        letterSpacing: 0,
        scrollback: 10000,
        theme: getThemeConfig(resolvedTheme === "dark"),
        allowProposedApi: true,
        convertEol: true,
        scrollOnUserInput: true,
        smoothScrollDuration: 50,
      });

      fitAddon = new fitMod.FitAddon();
      term.loadAddon(fitAddon);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      if (containerRef.current && !disposed) {
        term.open(containerRef.current);

        // 中文注释：聚焦容器时自动聚焦终端
        const handleContainerFocus = () => { term.focus(); };
        const containerEl = containerRef.current;
        containerEl.addEventListener('focus', handleContainerFocus);
        containerEl.addEventListener('click', handleContainerFocus);

        // 中文注释：延迟一帧再 fit，确保容器布局已完成，避免黑边
        requestAnimationFrame(() => {
          if (disposed || !fitAddonRef.current || !termRef.current) return;
          try { fitAddonRef.current.fit(); } catch { /* ignore */ }

          try { term.loadAddon(new webglMod.WebglAddon()); } catch (e) {
            console.warn("WebGL addon failed to load, falling back to canvas/dom", e);
          }

          term.focus();
          term.onData((data) => { onDataRef.current(data); });

          // 中文注释：二次延迟 fit 确保 WebGL 渲染器初始化后尺寸正确
          setTimeout(() => {
            if (fitAddonRef.current && termRef.current) {
              try { fitAddonRef.current.fit(); onResizeRef.current(termRef.current.cols, termRef.current.rows); } catch { /* ignore */ }
            }
          }, 150);

          onReadyRef.current(term);
        });

        return () => {
          containerEl.removeEventListener('focus', handleContainerFocus);
          containerEl.removeEventListener('click', handleContainerFocus);
        };
      }
    }

    init();

    const ro = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
          onResizeRef.current(termRef.current.cols, termRef.current.rows);
        } catch { /* ignore */ }
      }
    });

    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => {
      disposed = true;
      ro.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getThemeConfig(resolvedTheme === "dark");
    }
  }, [resolvedTheme, getThemeConfig]);

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
          onResizeRef.current(termRef.current.cols, termRef.current.rows);
        } catch { /* ignore */ }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      if (termRef.current) {
        termRef.current.focus();
        if (fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
            onResizeRef.current(termRef.current.cols, termRef.current.rows);
          } catch { /* ignore */ }
        }
      }
    };
    window.addEventListener("action:focus-terminal", handleFocus);
    return () => window.removeEventListener("action:focus-terminal", handleFocus);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 focus:outline-none xterm-container flex"
      style={{ padding: "4px 4px 4px 8px" }}
      onClick={() => termRef.current?.focus()}
    />
  );
}
