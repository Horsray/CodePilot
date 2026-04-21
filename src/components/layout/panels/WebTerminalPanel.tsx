"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useWebTerminal } from "@/hooks/useWebTerminal";
import { usePanel } from "@/hooks/usePanel";
import { XtermTerminal } from "@/components/terminal/XtermTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@/components/ui/icon";
import type { Terminal } from "@xterm/xterm";

/**
 * WebTerminalPanel — wraps XtermTerminal with the web-based PTY backend.
 */
export function WebTerminalPanel({ terminalId, onClose }: { terminalId?: string; onClose?: () => void }) {
  const { workingDirectory, sessionId } = usePanel();
  const terminalIdentity = terminalId || `${sessionId || 'default'}:${workingDirectory || 'workspace-default'}`;

  return <WebTerminalSession key={terminalIdentity} terminalId={terminalId} />;
}

function WebTerminalSession({ terminalId }: { terminalId?: string }) {
  const { t } = useTranslation();
  const terminal = useWebTerminal();
  const xtermRef = useRef<Terminal | null>(null);
  const [terminalKey, setTerminalKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionAttempted, setConnectionAttempted] = useState(false);

  const handleData = useCallback(
    (data: string) => {
      void terminal.write(data);
    },
    [terminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      void terminal.resize(cols, rows);
    },
    [terminal]
  );

  const handleReady = useCallback(
    async (term: Terminal) => {
      xtermRef.current = term;
      setReady(true);
      setConnectionAttempted(true);
      setError(null);

      // Subscribe to PTY output → write to xterm
      terminal.setOnData((data: string) => {
        if (xtermRef.current) {
          xtermRef.current.write(data);
        }
      });

      terminal.setOnExit((code: number) => {
        if (xtermRef.current) {
          xtermRef.current.write(`\r\n[Process exited with code ${code}]\r\n`);
        }
      });

      // Create PTY session with current terminal dimensions
      try {
        const id = terminalId || "default";
        
        await terminal.create(term.cols, term.rows, id);
      } catch (err) {
        setError(t('terminal.terminalError', { error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    },
    [terminal, t]
  );

  // Check if terminal connection failed
  useEffect(() => {
    if (!connectionAttempted || terminal.connected || error || terminal.exited) return;
    // 中文注释：功能名称「首连容错超时」，用法是为网页端首次建立 PTY+SSE 连接预留更长时间，避免慢启动被误判为失败。
    const timer = setTimeout(() => {
      setError(t('terminal.failedToConnect'));
    }, 8000);
    return () => clearTimeout(timer);
  }, [connectionAttempted, error, t, terminal.connected, terminal.exited]);

  useEffect(() => {
    if (!terminal.connected) return;
    // 中文注释：功能名称「连接成功自动清错」，用法是在连接恢复后移除错误遮罩，避免必须手动刷新页面。
    setError(null);
  }, [terminal.connected]);

  useEffect(() => {
    // If we're not in electron, the backend might use fallback spawn which needs a push to show prompt
    if (!terminal.isElectron && terminal.connected) {
      setTimeout(() => {
        void terminal.write('\n');
      }, 500);
    }
  }, [terminal.connected, terminal.isElectron]);

  const handleRetry = useCallback(() => {
    setError(null);
    setConnectionAttempted(false);
    setReady(false);
    void terminal.kill();
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    setTerminalKey((k) => k + 1);
  }, [terminal]);

  return (
    <div className="h-full w-full relative min-h-[100px]">
      <XtermTerminal
        key={terminalKey}
        onData={handleData}
        onResize={handleResize}
        onReady={handleReady}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background p-4">
          <div className="text-red-400 mb-2">⚠️ {t('terminal.terminalErrorTitle')}</div>
          <div className="text-sm text-gray-400 mb-4 text-center max-w-md">
            {error}
          </div>
          <div className="text-xs text-gray-500 mb-4">
            {t('terminal.terminalErrorHint')}
          </div>
          <Button
            onClick={handleRetry}
            className="px-4 py-2 text-sm"
          >
            {t('terminal.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
