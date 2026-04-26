"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, ArrowsInLineVertical, ShareNetwork } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTerminal } from "@/hooks/useTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { XtermTerminal } from "./XtermTerminal";
import type { Terminal } from "@xterm/xterm";

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

// 中文注释：功能名称「终端镜像事件缓存」，用法是当终端面板未打开时，
// 缓存 AI Bash 工具的镜像事件，等面板打开后回放到 xterm.js 中，
// 确保用户不会错过 AI 执行的命令和输出。
const mirrorBuffer: Array<{ action: string; command?: string; output?: string; exitCode?: number }> = [];
let mirrorBufferActive = true;
// 中文注释：功能名称「终端历史回放缓存」，用法是缓存用户点击"在终端查看"时
// 传递的命令和结果数据，等终端面板 ready 后写入 xterm.js
let pendingHistory: { command: string; result: string; isError: boolean } | null = null;

// 中文注释：功能名称「全局镜像事件监听」，用法是始终监听 terminal:mirror 事件，
// 当终端面板未打开时将事件缓存到 mirrorBuffer 中。
if (typeof window !== 'undefined') {
  window.addEventListener('terminal:mirror', (e: Event) => {
    const customEvent = e as CustomEvent;
    const detail = customEvent.detail;
    if (!detail) return;
    console.log('[TerminalDrawer] terminal:mirror received, bufferActive:', mirrorBufferActive, 'detail:', detail);
    if (mirrorBufferActive) {
      mirrorBuffer.push(detail);
      // 限制缓存大小，避免内存泄漏
      if (mirrorBuffer.length > 500) {
        mirrorBuffer.splice(0, mirrorBuffer.length - 500);
      }
    }
  });

  // 中文注释：功能名称「终端历史回放监听」，用法是监听用户点击"在终端查看"事件，
  // 缓存命令和结果数据，等终端面板 ready 后写入 xterm.js
  window.addEventListener('terminal:show-history', (e: Event) => {
    const customEvent = e as CustomEvent;
    const detail = customEvent.detail as { command: string; result: string; isError: boolean } | undefined;
    if (!detail) return;
    console.log('[TerminalDrawer] terminal:show-history received:', detail.command?.slice(0, 100));
    pendingHistory = detail;
  });
}

/**
 * TerminalDrawer — 统一终端面板，Electron 和 Web 都用 xterm.js 渲染。
 * Electron 路径：useTerminal → IPC → TerminalManager → node-pty
 * Web 路径：useWebTerminal → HTTP/SSE → pty-manager → node-pty
 * 中文注释：功能名称「统一终端面板」，用法是提供完整的终端交互体验，
 * 支持用户手动输入、AI Bash 工具的命令/输出镜像显示、选区发送到对话。
 * UI 风格对标 Trae IDE：干净清爽、紧凑布局、深色背景融合。
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

  const handleData = useCallback(
    (data: string) => {
      terminal.write(data);
    },
    [terminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      terminal.resize(cols, rows);
    },
    [terminal]
  );

  // 中文注释：功能名称「终端就绪回调」，用法是 xterm.js 初始化完成后创建 PTY 会话，
  // 订阅 PTY 输出写入 xterm.js，注册退出和 AI 镜像事件监听，回放缓存事件。
  const handleReady = useCallback(
    async (term: Terminal) => {
      xtermRef.current = term;
      setReady(true);

      terminal.setOnData((data: string) => {
        if (xtermRef.current) {
          xtermRef.current.write(data);
        }
      });

      terminal.setOnExit((code: number) => {
        if (xtermRef.current) {
          xtermRef.current.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        }
      });

      try {
        await terminal.create(term.cols, term.rows);
      } catch (err) {
        if (xtermRef.current) {
          xtermRef.current.write(
            `\r\n\x1b[31mFailed to create terminal: ${err instanceof Error ? err.message : "Unknown error"}\x1b[0m\r\n`
          );
        }
      }

      // 中文注释：回放缓存的镜像事件，确保用户打开终端面板后能看到之前 AI 执行的命令
      if (mirrorBuffer.length > 0 && xtermRef.current) {
        xtermRef.current.write('\r\n\x1b[90m── AI 执行的命令 ──\x1b[0m\r\n');
        for (const evt of mirrorBuffer) {
          switch (evt.action) {
            case 'command':
              xtermRef.current.write(`\x1b[33m❯ ${evt.command}\x1b[0m\r\n`);
              break;
            case 'output':
              if (evt.output) {
                xtermRef.current.write(evt.output);
              }
              break;
            case 'exit':
              if (evt.exitCode !== 0) {
                xtermRef.current.write(`\x1b[31m[Exit code: ${evt.exitCode}]\x1b[0m\r\n`);
              }
              break;
          }
        }
        xtermRef.current.write('\x1b[90m── 回放结束 ──\x1b[0m\r\n\r\n');
        mirrorBuffer.length = 0;
      }

      // 中文注释：功能名称「历史命令回放」，用法是回放用户点击"在终端查看"时
      // 传递的命令和结果，确保终端面板打开后能看到该条命令的完整执行记录
      if (pendingHistory && xtermRef.current) {
        const hist = pendingHistory;
        pendingHistory = null;
        xtermRef.current.write('\r\n\x1b[90m── 历史命令 ──\x1b[0m\r\n');
        xtermRef.current.write(`\x1b[33m❯ ${hist.command}\x1b[0m\r\n`);
        if (hist.result) {
          xtermRef.current.write(hist.result + '\r\n');
        }
        if (hist.isError) {
          xtermRef.current.write('\x1b[31m[执行失败]\x1b[0m\r\n');
        } else {
          xtermRef.current.write('\x1b[32m[执行成功]\x1b[0m\r\n');
        }
        xtermRef.current.write('\x1b[90m── 结束 ──\x1b[0m\r\n\r\n');
      }
    },
    [terminal]
  );

  // 中文注释：功能名称「AI 命令镜像监听」，用法是接收 AI Bash 工具执行的命令和输出，
  // 在终端面板中以特殊样式显示，与用户手动输入的命令区分开来。
  useEffect(() => {
    if (!ready || !xtermRef.current) return;

    const handleMirror = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { action, command, output, exitCode } = customEvent.detail || {};
      const term = xtermRef.current;
      if (!term) return;

      switch (action) {
        case 'command':
          term.write(`\r\n\x1b[33m❯ ${command}\x1b[0m\r\n`);
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

  // 中文注释：功能名称「终端历史回放监听（组件内）」，用法是当终端面板已打开且 ready 时，
  // 监听用户点击"在终端查看"事件，直接写入 xterm.js 显示命令和结果
  useEffect(() => {
    if (!ready) return;

    const handleShowHistory = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail as { command: string; result: string; isError: boolean } | undefined;
      if (!detail) return;
      const term = xtermRef.current;
      if (!term) return;

      term.write('\r\n\x1b[90m── 历史命令 ──\x1b[0m\r\n');
      term.write(`\x1b[33m❯ ${detail.command}\x1b[0m\r\n`);
      if (detail.result) {
        term.write(detail.result + '\r\n');
      }
      if (detail.isError) {
        term.write('\x1b[31m[执行失败]\x1b[0m\r\n');
      } else {
        term.write('\x1b[32m[执行成功]\x1b[0m\r\n');
      }
      term.write('\x1b[90m── 结束 ──\x1b[0m\r\n\r\n');
    };

    window.addEventListener('terminal:show-history', handleShowHistory);
    return () => window.removeEventListener('terminal:show-history', handleShowHistory);
  }, [ready]);

  // 中文注释：功能名称「终端面板关闭清理」，用法是面板关闭时销毁 PTY 会话和 xterm 实例，
  // 重置 key 以便下次打开时重新初始化。同时重新启用镜像缓存。
  useEffect(() => {
    if (!terminalOpen && ready) {
      mirrorBufferActive = true;
      terminal.kill();
      setReady(false);
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      setTerminalKey((k) => k + 1);
    }
  }, [terminalOpen, ready, terminal.kill]);

  // 中文注释：终端面板打开时停止缓存，改为实时写入
  useEffect(() => {
    if (terminalOpen && ready) {
      mirrorBufferActive = false;
    }
  }, [terminalOpen, ready]);

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

    const content = `\`\`\`terminal\n${selection}\n\`\`\``;

    window.dispatchEvent(new CustomEvent('append-chat-text', {
      detail: { text: content },
    }));
  }, []);

  if (!terminalOpen) return null;

  // 非 Electron 环境暂不支持
  if (!terminal.isElectron) {
    return (
      <div className="shrink-0 border-t border-border/30 bg-[#1e1e1e]" style={{ height }}>
        <div
          className="h-[3px] cursor-row-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleMouseDown}
        />
        <div className="flex items-center justify-between px-3 h-7 border-b border-border/20">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
            {t("terminal.title")}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={11} />
          </Button>
        </div>
        <div className="flex items-center justify-center h-[calc(100%-1.75rem-0.75rem)] text-xs text-muted-foreground/50">
          {t("terminal.notAvailable")}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border/30 bg-[#1e1e1e]" style={{ height }}>
      {/* 中文注释：拖拽调整高度的手柄，3px 高度，hover 时显示主色调 */}
      <div
        className="h-[3px] cursor-row-resize hover:bg-primary/20 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* 中文注释：终端标题栏，紧凑 7px 高度，左侧标题右侧操作按钮 */}
      <div className="flex items-center justify-between px-3 h-7 border-b border-border/20">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
          {t("terminal.title")}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSendToChat}
            title={t("terminal.sendToChat")}
          >
            <ShareNetwork size={11} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setHeight(DEFAULT_HEIGHT)}>
            <ArrowsInLineVertical size={11} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={11} />
          </Button>
        </div>
      </div>

      {/* 中文注释：终端主体区域，xterm.js 渲染，背景色与终端主题一致 */}
      <div className="h-[calc(100%-1.75rem-0.75rem)] overflow-hidden relative bg-[#1e1e1e]">
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
