"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, ArrowsInLineVertical, ShareNetwork } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTerminal } from "@/hooks/useTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { XtermTerminal } from "./XtermTerminal";
import type { Terminal } from "@xterm/xterm";

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 600;

/**
 * TerminalDrawer — 统一终端面板，Electron 和 Web 都用 xterm.js 渲染。
 * Electron 路径：useTerminal → IPC → TerminalManager → node-pty
 * Web 路径：useWebTerminal → HTTP/SSE → pty-manager → node-pty
 * 中文注释：功能名称「统一终端面板」，用法是提供完整的终端交互体验，
 * 支持用户手动输入、AI Bash 工具的命令/输出镜像显示、选区发送到对话。
 */
export function TerminalDrawer() {
  const { terminalOpen, setTerminalOpen } = usePanel();
  const terminal = useTerminal();
  const { t } = useTranslation();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const xtermRef = useRef<Terminal | null>(null);
  const [terminalKey, setTerminalKey] = useState(0);
  const [ready, setReady] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [height]);

  // xterm.js 用户输入 → 写入 PTY
  const handleData = useCallback(
    (data: string) => {
      terminal.write(data);
    },
    [terminal]
  );

  // xterm.js 尺寸变化 → 通知 PTY resize
  const handleResize = useCallback(
    (cols: number, rows: number) => {
      terminal.resize(cols, rows);
    },
    [terminal]
  );

  // xterm.js 初始化完成 → 创建 PTY 会话 + 订阅输出
  const handleReady = useCallback(
    async (term: Terminal) => {
      xtermRef.current = term;
      setReady(true);

      // PTY 输出 → 写入 xterm.js
      terminal.setOnData((data: string) => {
        if (xtermRef.current) {
          xtermRef.current.write(data);
        }
      });

      // PTY 退出 → 在 xterm.js 中显示退出码
      // 中文注释：功能名称「终端退出显示」，用法是进程退出时在终端面板渲染退出提示。
      terminal.setOnExit((code: number) => {
        if (xtermRef.current) {
          xtermRef.current.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        }
      });

      // 创建 PTY 会话
      try {
        await terminal.create(term.cols, term.rows);
      } catch (err) {
        if (xtermRef.current) {
          xtermRef.current.write(
            `\r\n\x1b[31mFailed to create terminal: ${err instanceof Error ? err.message : "Unknown error"}\x1b[0m\r\n`
          );
        }
      }
    },
    [terminal]
  );

  // 监听 AI Bash 工具的终端镜像事件
  // 中文注释：功能名称「AI 命令镜像监听」，用法是接收 AI Bash 工具执行的命令和输出，
  // 在终端面板中以特殊样式显示，与用户手动输入的命令区分开来。
  useEffect(() => {
    if (!ready || !xtermRef.current) return;

    const handleMirror = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { action, command, output, exitCode, cwd } = customEvent.detail || {};
      const term = xtermRef.current;
      if (!term) return;

      switch (action) {
        case 'command':
          term.write(`\r\n\x1b[36m❯ AI: ${command}\x1b[0m\r\n`);
          break;
        case 'output':
          if (output) {
            term.write(output);
          }
          break;
        case 'exit':
          if (exitCode !== 0) {
            term.write(`\x1b[31m[Exit code: ${exitCode}]\x1b[0m\r\n`);
          }
          break;
      }
    };

    window.addEventListener('terminal:mirror', handleMirror);
    return () => window.removeEventListener('terminal:mirror', handleMirror);
  }, [ready]);

  // 终端面板关闭时清理
  useEffect(() => {
    if (!terminalOpen && ready) {
      terminal.kill();
      setReady(false);
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      setTerminalKey((k) => k + 1);
    }
  }, [terminalOpen, ready, terminal.kill]);

  // 窗口焦点事件：聚焦终端
  useEffect(() => {
    const handleFocus = () => {
      if (xtermRef.current) {
        xtermRef.current.focus();
      }
    };
    window.addEventListener("action:focus-terminal", handleFocus);
    return () => window.removeEventListener("action:focus-terminal", handleFocus);
  }, []);

  // 中文注释：功能名称「终端选区发送到对话」，用法是获取 xterm.js 中的选区文本，
  // 通过 window 事件注入到聊天输入框，让用户可以把终端输出作为上下文发送给 AI。
  const handleSendToChat = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;

    const selection = term.getSelection();
    if (!selection.trim()) return;

    // 用代码块格式包裹终端输出
    const content = `\`\`\`terminal\n${selection}\n\`\`\``;

    // 通过已有的 append-chat-text 事件将内容注入到聊天输入框
    window.dispatchEvent(new CustomEvent('append-chat-text', {
      detail: { text: content },
    }));
  }, []);

  if (!terminalOpen) return null;

  // 非 Electron 环境暂不支持（Web 端用 BottomPanelContainer 的 WebTerminalPanel）
  if (!terminal.isElectron) {
    return (
      <div className="shrink-0 border-t border-border/40 bg-background" style={{ height }}>
        <div
          className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleMouseDown}
        />
        <div className="flex items-center justify-between px-3 h-8 border-b border-border/40">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("terminal.title")}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={12} />
          </Button>
        </div>
        <div className="flex items-center justify-center h-[calc(100%-2.25rem-0.25rem)] text-sm text-muted-foreground">
          {t("terminal.notAvailable")}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border/40 bg-background" style={{ height }}>
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("terminal.title")}
        </span>
        <div className="flex items-center gap-1">
          {/* 发送选区到对话 */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSendToChat}
            title="Send selection to chat"
          >
            <ShareNetwork size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setHeight(DEFAULT_HEIGHT)}>
            <ArrowsInLineVertical size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={12} />
            <span className="sr-only">{t("terminal.close")}</span>
          </Button>
        </div>
      </div>

      {/* Terminal body — xterm.js */}
      <div className="h-[calc(100%-2.25rem-0.25rem)] overflow-hidden relative">
        <XtermTerminal
          key={terminalKey}
          onData={handleData}
          onResize={handleResize}
          onReady={handleReady}
        />
      </div>
    </div>
  );
}
