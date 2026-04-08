"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Terminal as TerminalIcon,
  ListBullets,
  X,
  ArrowsInLineVertical,
  CaretUp,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel, type BottomPanelTab } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";

const WebTerminalTab = dynamic(
  () => import("./panels/WebTerminalPanel").then((m) => ({ default: m.WebTerminalPanel })),
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

  if (!bottomPanelOpen) return null;

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "terminal",
      label: t("bottomPanel.terminal"),
      icon: <TerminalIcon size={14} />,
    },
    {
      id: "console",
      label: t("bottomPanel.console"),
      icon: <ListBullets size={14} />,
    },
  ];

  return (
    <div
      className="shrink-0 border-t border-border/40 bg-background flex flex-col"
      style={{ height: collapsed ? 36 : height }}
    >
      {/* Resize handle — hidden when collapsed */}
      {!collapsed && (
        <div
          className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors shrink-0"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Tab bar */}
      <div className="flex items-center h-8 px-2 border-b border-border/40 shrink-0 gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setBottomPanelTab(tab.id);
              if (collapsed) setCollapsed(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              bottomPanelTab === tab.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Minimize / Restore */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground"
        >
          {collapsed ? <CaretUp size={12} /> : <ArrowsInLineVertical size={12} />}
        </Button>

        {/* Close */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setBottomPanelOpen(false)}
          className="text-muted-foreground"
        >
          <X size={12} />
          <span className="sr-only">{t("bottomPanel.close")}</span>
        </Button>
      </div>

      <div className={`flex-1 min-h-0 overflow-hidden ${collapsed ? "hidden" : ""}`}>
        <div className={bottomPanelTab === "terminal" ? "h-full" : "hidden h-full"}>
          <WebTerminalTab />
        </div>
        <div className={bottomPanelTab === "console" ? "h-full" : "hidden h-full"}>
          <ConsolePanelTab />
        </div>
      </div>
    </div>
  );
}
