"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

interface XtermTerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (term: Terminal) => void;
}

/**
 * XtermTerminal — renders a real xterm.js terminal with full ANSI support.
 * Lazy-loads xterm.js and addons to avoid SSR issues.
 */
export function XtermTerminal({ onData, onResize, onReady }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
        const { cols, rows } = termRef.current;
        onResize(cols, rows);
      } catch { /* ignore */ }
    }
  }, [onResize]);

  useEffect(() => {
    if (!containerRef.current || readyRef.current) return;
    readyRef.current = true;

    let term: Terminal;
    let fitAddon: FitAddon;
    let disposed = false;

    async function init() {
      const [xtermMod, fitMod, webLinksMod] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      if (disposed) return;

      // Import xterm CSS
      await import("@xterm/xterm/css/xterm.css");

      term = new xtermMod.Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: "#1a1a2e",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#3b3b5c",
          black: "#1a1a2e",
          red: "#ff6b6b",
          green: "#51cf66",
          yellow: "#ffd43b",
          blue: "#74c0fc",
          magenta: "#cc5de8",
          cyan: "#66d9e8",
          white: "#e4e4e7",
          brightBlack: "#4a4a6a",
          brightRed: "#ff8787",
          brightGreen: "#69db7c",
          brightYellow: "#ffe066",
          brightBlue: "#91d5ff",
          brightMagenta: "#da77f2",
          brightCyan: "#99e9f2",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });

      fitAddon = new fitMod.FitAddon();
      const webLinksAddon = new webLinksMod.WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      if (containerRef.current && !disposed) {
        term.open(containerRef.current);
        fitAddon.fit();

        // Forward user input to parent
        term.onData((data) => {
          onData(data);
        });

        onReady(term);
      }
    }

    init();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
          onResize(termRef.current.cols, termRef.current.rows);
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
  }, [onData, onResize, onReady]);

  // Also listen for window resize
  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: 0 }}
    />
  );
}
