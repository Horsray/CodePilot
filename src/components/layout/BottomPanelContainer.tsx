"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  ListBullets,
  TerminalWindow,
  X,
  ArrowsInLineVertical,
  CaretUp,
  Plus,
  Wrench,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel, type BottomPanelTab } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

const WebTerminalPanelTab = dynamic(
  () => import("@/components/layout/panels/WebTerminalPanel").then((m) => ({ default: m.WebTerminalPanel })),
  { ssr: false }
);

const ConsolePanelTab = dynamic(
  () => import("@/components/console/ConsolePanel").then((m) => ({ default: m.ConsolePanel })),
  { ssr: false }
);

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 600;

export function BottomPanelContainer() {
  const { bottomPanelOpen, setBottomPanelOpen, bottomPanelTab, setBottomPanelTab } = usePanel();
  const { t } = useTranslation();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;

      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height, collapsed]
  );

  // 中文注释：终端按钮——+ 新建会话，扳手 快捷命令
  const handleNewSession = useCallback(() => {
    window.dispatchEvent(new CustomEvent("terminal:new-session"));
  }, []);

  const handleToggleQuickCmds = useCallback(() => {
    window.dispatchEvent(new CustomEvent("terminal:toggle-quick-cmds"));
  }, []);

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "console",
      label: t("bottomPanel.console"),
      icon: <ListBullets size={14} />,
    },
    {
      id: "terminal",
      label: t("bottomPanel.terminal"),
      icon: <TerminalWindow size={14} />,
    },
  ];

  // Always render to preserve PTY session & console state; hide with display:none when closed
  return (
    <div
      className="shrink-0 border-t border-border/40 bg-background/95 backdrop-blur-md flex flex-col relative z-20 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
      style={{ height: collapsed ? 36 : height, display: bottomPanelOpen ? undefined : "none" }}
    >
      {!collapsed && (
        <div
          className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors shrink-0 rounded-t-xl"
          onMouseDown={handleMouseDown}
        />
      )}

      <div className="flex items-center h-10 px-3 border-b border-border/40 shrink-0 gap-2 bg-muted/20">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={bottomPanelTab === tab.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setBottomPanelTab(tab.id);
              if (collapsed) setCollapsed(false);
              if (tab.id === "terminal") {
                setTimeout(() => window.dispatchEvent(new CustomEvent('action:focus-terminal')), 50);
              }
            }}
            className={cn(
              "h-7 gap-1.5 px-3 text-xs font-medium rounded-lg transition-all",
              bottomPanelTab === tab.id
                ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                : "hover:bg-muted/60"
            )}
          >
            {tab.icon}
            {tab.label}
          </Button>
        ))}

        <div className="flex-1" />

        {/* 终端专用按钮：+ 新建会话、扳手 快捷命令，仅终端标签时显示 */}
        {bottomPanelTab === "terminal" && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              title="快捷命令"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
              onClick={handleToggleQuickCmds}
            >
              <Wrench size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="新建终端"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
              onClick={handleNewSession}
            >
              <Plus size={14} />
            </Button>
            <div className="w-px h-4 bg-border/40 mx-0.5" />
          </>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          title={collapsed ? "展开面板" : "收起面板"}
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground"
        >
          {collapsed ? <CaretUp size={12} /> : <ArrowsInLineVertical size={12} />}
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          title="关闭面板"
          onClick={() => setBottomPanelOpen(false)}
          className="text-muted-foreground"
        >
          <X size={12} />
          <span className="sr-only">{t("bottomPanel.close")}</span>
        </Button>
      </div>

      <div className={`flex-1 min-h-0 overflow-hidden relative ${collapsed ? "hidden" : "flex flex-col"}`}>
        <div className={bottomPanelTab === "console" ? "flex-1 min-h-0 w-full relative" : "hidden"}>
          <ConsolePanelTab />
        </div>
        <div className={bottomPanelTab === "terminal" ? "flex-1 min-h-0 w-full relative" : "hidden"}>
          <WebTerminalPanelTab />
        </div>
      </div>
    </div>
  );
}
