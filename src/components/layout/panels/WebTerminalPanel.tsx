"use client";

import { useCallback, useRef, useState } from "react";
import { useWebTerminal } from "@/hooks/useWebTerminal";
import { XtermTerminal } from "@/components/terminal/XtermTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { SpinnerGap } from "@/components/ui/icon";
import type { Terminal } from "@xterm/xterm";

/**
 * WebTerminalPanel — wraps XtermTerminal with the web-based PTY backend.
 */
export function WebTerminalPanel() {
  const { t } = useTranslation();
  const webTerminal = useWebTerminal();
  const xtermRef = useRef<Terminal | null>(null);
  const [ready, setReady] = useState(false);

  const handleData = useCallback(
    (data: string) => {
      webTerminal.write(data);
    },
    [webTerminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      webTerminal.resize(cols, rows);
    },
    [webTerminal]
  );

  const handleReady = useCallback(
    (term: Terminal) => {
      xtermRef.current = term;
      setReady(true);

      // Subscribe to PTY output → write to xterm
      webTerminal.setOnData((data: string) => {
        term.write(data);
      });

      // Create PTY session with current terminal dimensions
      webTerminal.create(term.cols, term.rows);
    },
    [webTerminal]
  );

  return (
    <div className="h-full w-full relative">
      <XtermTerminal
        onData={handleData}
        onResize={handleResize}
        onReady={handleReady}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
          <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
