"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";
import { ArrowsClockwise, TerminalWindow, ClipboardText, Wrench, Plus, Eraser, X } from "@/components/ui/icon";
import { loadFileTreePanel } from "./panels/fileTreePanelLoader";
import { PanelToolbar } from "./PanelToolbar";
import { isRightPanelOpen } from "@/lib/panel-visibility";
import { PanelResizeHandle } from "./ResizeHandle";
import { cn } from "@/lib/utils";

const PreviewPanel = dynamic(() => import("./panels/PreviewPanel").then(m => ({ default: m.PreviewPanel })), { ssr: false });
const GitPanelContainer = dynamic(() => import("./panels/GitPanel").then(m => ({ default: m.GitPanelContainer })), { ssr: false });
const FileTreePanel = dynamic(loadFileTreePanel, {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <ArrowsClockwise size={16} className="animate-spin text-muted-foreground" />
    </div>
  ),
});
const DashboardPanel = dynamic(() => import("./panels/DashboardPanel").then(m => ({ default: m.DashboardPanel })), { ssr: false });
const AssistantPanel = dynamic(() => import("./panels/AssistantPanel").then(m => ({ default: m.AssistantPanel })), { ssr: false });

// 中文注释：终端/控制台从底部抽屉迁移到右侧面板后，仍需常驻挂载（PTY 会话与日志状态不能随面板关闭丢失），
// 因此用可见性切换而不是卸载。
const WebTerminalPanelTab = dynamic(
  () => import("./panels/WebTerminalPanel").then((m) => ({ default: m.WebTerminalPanel })),
  { ssr: false }
);
const ConsolePanelTab = dynamic(
  () => import("@/components/console/ConsolePanel").then((m) => ({ default: m.ConsolePanel })),
  { ssr: false }
);
// 中文注释：内置浏览器改为右侧面板内渲染（对齐 cc-haha），不再用工作区标签顶掉聊天页。
const BrowserPanel = dynamic(
  () => import("@/components/layout/BrowserTabView").then((m) => ({ default: m.BrowserTabView })),
  { ssr: false }
);

/** 分隔线样式：与 cc-haha 一致的 1px 线 + 极淡投影 */
const SEPARATOR_CLASS = "h-px shrink-0 bg-border opacity-50 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

/** 各面板默认宽度（可拖拽调整，按面板类型分别记忆） */
const DEFAULT_WIDTHS: Record<string, number> = {
  terminal: 400,
  console: 400,
  browser: 480,
  filetree: 340,
  git: 380,
  dashboard: 340,
  assistant: 360,
  preview: 480,
};

export function PanelZone() {
  const {
    previewOpen, previewFile,
    gitPanelOpen,
    fileTreeOpen,
    dashboardPanelOpen,
    assistantPanelOpen,
    browserPanelOpen,
    bottomPanelOpen,
    bottomPanelTab,
    setBottomPanelOpen,
    setBottomPanelTab,
  } = usePanel();

  // 中文注释：与 UnifiedTopBar 的 rightPanelOpen 共用同一判定 —— 两者不一致就会出现
  // 顶栏与面板头同时渲染切换按钮的情况（见 src/lib/panel-visibility.ts）。
  const anyOpen = isRightPanelOpen({
    previewOpen,
    previewFile,
    gitPanelOpen,
    fileTreeOpen,
    dashboardPanelOpen,
    assistantPanelOpen,
    bottomPanelOpen,
    browserPanelOpen,
  });

  // 中文注释：当前激活面板决定卡片宽度；切换面板时宽度做 300ms 缓动过渡（cc-haha 同款动效），拖拽时按面板分别记忆。
  const activeKey = browserPanelOpen ? "browser"
    : gitPanelOpen ? "git"
    : fileTreeOpen ? "filetree"
    : dashboardPanelOpen ? "dashboard"
    : assistantPanelOpen ? "assistant"
    : (previewOpen && previewFile) ? "preview"
    : (bottomPanelTab === "console" ? "console" : "terminal");
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const activeWidth = widths[activeKey] ?? 400;
  const [isDragging, setIsDragging] = useState(false);

  return (
    /* 中文注释：外层负责宽度动画与左边缘拖拽手柄；内层卡片在关闭时缩短到 0 宽（子树保持挂载，终端 PTY 不中断）。 */
    <div
      className="relative flex h-full shrink-0"
      style={{
        width: anyOpen ? activeWidth : 0,
        transition: isDragging ? "none" : "width 300ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
    >
      {anyOpen && (
        <PanelResizeHandle
          width={activeWidth}
          setWidth={(w) => setWidths((prev) => ({ ...prev, [activeKey]: w }))}
          onDragChange={setIsDragging}
        />
      )}

      <div
        className={cn(
          "panel-card flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-card",
          "shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:border-white/5 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]",
          !anyOpen && "pointer-events-none invisible"
        )}
      >
        <div className={SEPARATOR_CLASS} />
        <div className="flex h-[52px] shrink-0 items-center justify-center px-3">
          <div className="flex w-full shrink-0 items-center justify-center gap-1">
            <PanelToolbar />
          </div>
        </div>
        <div className={SEPARATOR_CLASS} />

        {/* 中文注释：[&_.cursor-col-resize]:hidden 隐藏各面板自带的内部拖拽手柄（改由卡片级手柄统一控制宽度） */}
        <div className="relative flex min-h-0 flex-1 flex-col [&_.cursor-col-resize]:hidden">
          {/* 终端/控制台（常驻挂载保活 PTY 与日志状态）。
              与 cc-haha TerminalPanelContainer 对齐：面板内 pill 标签页切换 终端/控制台，
              终端页显示 快捷命令/新建终端/清屏 按钮 + 分隔线，右侧 X 隐藏面板。 */}
          <div className={cn("min-h-0 flex-1 flex-col", bottomPanelOpen ? "flex" : "hidden")}>
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2">
              <button
                onClick={() => setBottomPanelTab('terminal')}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
                  bottomPanelTab === 'terminal'
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shadow-sm"
                    : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
                )}
              >
                <TerminalWindow size={13} />
                终端
              </button>
              <button
                onClick={() => setBottomPanelTab('console')}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
                  bottomPanelTab === 'console'
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shadow-sm"
                    : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
                )}
              >
                <ClipboardText size={13} />
                控制台
              </button>

              <div className="flex-1" />

              {/* 终端页专用按钮（cc-haha：仅终端标签激活时显示） */}
              {bottomPanelTab === 'terminal' && (
                <>
                  <button
                    title="快捷命令"
                    className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent("terminal:toggle-quick-cmds"))}
                  >
                    <Wrench size={13} />
                  </button>
                  <button
                    title="新建终端"
                    className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent("terminal:new-session"))}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    title="清屏"
                    className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent("terminal:clear-screen"))}
                  >
                    <Eraser size={13} />
                  </button>
                  <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
                </>
              )}

              <button
                title="隐藏面板"
                className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                onClick={() => setBottomPanelOpen(false)}
              >
                <X size={13} />
              </button>
            </div>

            {/* 终端（隐藏不卸载，PTY 保持存活） */}
            <div className={cn("min-h-0 flex-1 flex-col", bottomPanelTab === "terminal" ? "flex" : "hidden")}>
              <WebTerminalPanelTab />
            </div>
            {/* 控制台（隐藏不卸载，日志状态保持） */}
            <div className={cn("min-h-0 flex-1 flex-col", bottomPanelTab === "console" ? "flex" : "hidden")}>
              <ConsolePanelTab />
            </div>
          </div>

          {/* 内置浏览器（面板内渲染，宽度默认 560，可拖拽） */}
          {browserPanelOpen && (
            <div className="min-h-0 w-full flex-1 [&>*]:!w-full">
              <BrowserPanel />
            </div>
          )}

          {/* 中文注释：[&>*]:!w-full 强制面板撑满卡片宽度——各面板自带的固定宽度与拖拽手柄已由卡片级宽度接管 */}
          {assistantPanelOpen && <div className="min-h-0 w-full flex-1 [&>*]:!w-full"><AssistantPanel /></div>}
          {previewOpen && previewFile && <div className="min-h-0 w-full flex-1 [&>*]:!w-full"><PreviewPanel /></div>}
          {gitPanelOpen && <div className="min-h-0 w-full flex-1 [&>*]:!w-full"><GitPanelContainer /></div>}
          {fileTreeOpen && <div className="min-h-0 w-full flex-1 [&>*]:!w-full"><FileTreePanel /></div>}
          {dashboardPanelOpen && <div className="min-h-0 w-full flex-1 [&>*]:!w-full"><DashboardPanel /></div>}
        </div>
      </div>
    </div>
  );
}
