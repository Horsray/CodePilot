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

/**
 * XtermTerminal — renders a real xterm.js terminal with full ANSI support.
 * Lazy-loads xterm.js and addons to avoid SSR issues.
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

  const getThemeConfig = useCallback((isDark: boolean) => ({
    background: isDark ? "#1a1a2e" : "#ffffff",
    foreground: isDark ? "#e4e4e7" : "#333333",
    cursor: isDark ? "#e4e4e7" : "#333333",
    selectionBackground: isDark ? "#3b3b5c" : "#cce2ff",
    black: isDark ? "#1a1a2e" : "#000000",
    red: isDark ? "#ff6b6b" : "#cd3131",
    green: isDark ? "#51cf66" : "#0dbc79",
    yellow: isDark ? "#ffd43b" : "#e5e510",
    blue: isDark ? "#74c0fc" : "#2472c8",
    magenta: isDark ? "#cc5de8" : "#bc3fbc",
    cyan: isDark ? "#66d9e8" : "#11a8cd",
    white: isDark ? "#e4e4e7" : "#e5e5e5",
    brightBlack: isDark ? "#4a4a6a" : "#666666",
    brightRed: isDark ? "#ff8787" : "#f14c4c",
    brightGreen: isDark ? "#69db7c" : "#23d18b",
    brightYellow: isDark ? "#ffe066" : "#f5f543",
    brightBlue: isDark ? "#91d5ff" : "#3b8eea",
    brightMagenta: isDark ? "#da77f2" : "#d670d6",
    brightCyan: isDark ? "#99e9f2" : "#29b8db",
    brightWhite: isDark ? "#ffffff" : "#e5e5e5",
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

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
        const { cols, rows } = termRef.current;
        onResizeRef.current(cols, rows);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || readyRef.current) return;
    readyRef.current = true;

    let term: Terminal;
    let fitAddon: FitAddon;
    let disposed = false;

    async function init() {
      const [xtermMod, fitMod, webglMod] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-webgl"),
      ]);

      if (disposed) return;

      term = new xtermMod.Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        scrollback: 5000,
        theme: getThemeConfig(resolvedTheme === "dark"),
        allowProposedApi: true,
      });

      fitAddon = new fitMod.FitAddon();
      term.loadAddon(fitAddon);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      if (containerRef.current && !disposed) {
        term.open(containerRef.current);
        fitAddon.fit();

        try {
          term.loadAddon(new webglMod.WebglAddon());
        } catch (e) {
          console.warn("WebGL addon failed to load, falling back to canvas/dom", e);
        }

        // Focus the terminal when it opens and on container click
        term.focus();

        // Forward user input to parent (from xterm.js internal handling)
        term.onData((data) => {
          onDataRef.current(data);
        });

        // Some Electron environments need extra help passing keyboard events
        const handleKey = (e: KeyboardEvent) => {
          // In some cases, the container catches the event before xterm
          // Usually we let xterm handle it, but we can capture it here if needed
        };

        // Focus terminal when clicking on the container
        const handleContainerClick = () => {
          term.focus();
        };
        containerRef.current.addEventListener('click', handleContainerClick);
        containerRef.current.addEventListener('keydown', handleKey);

        // Ensure focus stays in the terminal when container is focused
        const handleContainerFocus = () => {
          term.focus();
        };
        containerRef.current.addEventListener('focus', handleContainerFocus);

        // Force an initial resize to ensure the terminal picks up its container dimensions
        setTimeout(() => {
          if (fitAddonRef.current && termRef.current) {
            try {
              fitAddonRef.current.fit();
              onResizeRef.current(termRef.current.cols, termRef.current.rows);
            } catch { /* ignore */ }
          }
        }, 100);

        onReadyRef.current(term);

        return () => {
          containerRef.current?.removeEventListener('click', handleContainerClick);
          containerRef.current?.removeEventListener('keydown', handleKey);
          containerRef.current?.removeEventListener('focus', handleContainerFocus);
        };
      }
    }

    init();

    // Resize observer
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

  // Also listen for window resize
  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

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
      style={{ padding: 0 }}
      tabIndex={-1}
    />
  );
}
