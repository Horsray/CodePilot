"use client";

import { useCallback } from "react";
import {
  TerminalWindow,
  Globe,
  Folder,
  FolderOpen,
  GitBranch,
  SquaresFour,
} from "@/components/ui/icon";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

/**
 * 中文注释：右侧面板工具栏按钮组 —— 移植 cc-haha 的 ToolbarIconButton
 * （32×32、rounded-[10px]、选中态 user-bubble 底色 + 微阴影、hover 显示名称浮签）。
 * 按钮顺序与 cc-haha 一致：终端 / 浏览器 / 文件树 / Git / 仪表盘
 * （cc-haha 的「已更改文件」与「控制台/助手」按钮不移植：控制台改为终端面板内标签页，
 * 助手面板入口保留在侧边栏）。
 */
export function PanelToolbarButton({
  icon,
  label,
  onClick,
  active = false,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  count?: number;
}) {
  const hasCount = count !== undefined && count > 0;

  return (
    <div className="relative group/panelbtn">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        data-active={active ? "true" : "false"}
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center overflow-visible rounded-[10px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          active
            ? "bg-[var(--user-bubble)] text-[var(--user-bubble-foreground)] shadow-[0_2px_8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.15)]"
            : "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        )}
      >
        {icon}
        {hasCount && (
          <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-semibold leading-none tabular-nums text-white ring-2 ring-card">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {/* hover 时立即显示按钮名字（对齐 cc-haha） */}
      <div className="absolute -top-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-primary)] opacity-0 shadow-md transition-opacity pointer-events-none group-hover/panelbtn:opacity-100">
        {label}
      </div>
    </div>
  );
}

export function PanelToolbar() {
  const {
    bottomPanelOpen, setBottomPanelOpen,
    bottomPanelTab, setBottomPanelTab,
    fileTreeOpen, setFileTreeOpen,
    gitPanelOpen, setGitPanelOpen,
    gitDirtyCount,
    dashboardPanelOpen, setDashboardPanelOpen,
    previewOpen, setPreviewOpen,
    browserPanelOpen, setBrowserPanelOpen,
  } = usePanel();
  const { t } = useTranslation();

  // 中文注释：互斥打开 —— 打开目标面板前先关闭其他面板，避免右侧卡片里多面板堆叠。
  const closeOthers = useCallback((keep: string) => {
    if (keep !== 'terminal') setBottomPanelOpen(false);
    if (keep !== 'filetree') setFileTreeOpen(false);
    if (keep !== 'git') setGitPanelOpen(false);
    if (keep !== 'dashboard') setDashboardPanelOpen(false);
    if (keep !== 'preview') setPreviewOpen(false);
    if (keep !== 'browser') setBrowserPanelOpen(false);
  }, [setBottomPanelOpen, setFileTreeOpen, setGitPanelOpen, setDashboardPanelOpen, setPreviewOpen, setBrowserPanelOpen]);

  const terminalActive = bottomPanelOpen && bottomPanelTab === 'terminal';

  return (
    <>
      <PanelToolbarButton
        icon={<TerminalWindow size={17} />}
        label={t('bottomPanel.terminal')}
        active={terminalActive}
        onClick={() => {
          if (terminalActive) { setBottomPanelOpen(false); return; }
          closeOthers('terminal');
          setBottomPanelTab('terminal');
          setBottomPanelOpen(true);
          setTimeout(() => window.dispatchEvent(new CustomEvent('action:focus-terminal')), 50);
        }}
      />
      {/* 中文注释：浏览器改为在右侧面板内打开（对齐 cc-haha），不再用工作区标签顶掉聊天页；可拖拽调宽 */}
      <PanelToolbarButton
        icon={<Globe size={17} />}
        label="浏览器"
        active={browserPanelOpen}
        onClick={() => {
          if (browserPanelOpen) { setBrowserPanelOpen(false); return; }
          closeOthers('browser');
          setBrowserPanelOpen(true);
        }}
      />
      <PanelToolbarButton
        icon={<GitBranch size={17} />}
        label={gitDirtyCount > 0 ? `Git (${gitDirtyCount})` : "Git"}
        active={gitPanelOpen}
        count={gitDirtyCount}
        onClick={() => {
          if (gitPanelOpen) { setGitPanelOpen(false); return; }
          closeOthers('git');
          setGitPanelOpen(true);
        }}
      />
      <PanelToolbarButton
        icon={fileTreeOpen ? <FolderOpen size={17} /> : <Folder size={17} />}
        label={t('topBar.fileTree')}
        active={fileTreeOpen}
        onClick={() => {
          if (fileTreeOpen) { setFileTreeOpen(false); return; }
          closeOthers('filetree');
          setFileTreeOpen(true);
        }}
      />
      <PanelToolbarButton
        icon={<SquaresFour size={17} />}
        label={t('topBar.dashboard')}
        active={dashboardPanelOpen}
        onClick={() => {
          if (dashboardPanelOpen) { setDashboardPanelOpen(false); return; }
          closeOthers('dashboard');
          setDashboardPanelOpen(true);
        }}
      />
    </>
  );
}
