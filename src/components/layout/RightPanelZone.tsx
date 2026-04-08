"use client";

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const PreviewPanel = dynamic(() => import("./panels/PreviewPanel").then(m => ({ default: m.PreviewPanel })), { ssr: false });
const GitPanelContainer = dynamic(() => import("./panels/GitPanel").then(m => ({ default: m.GitPanelContainer })), { ssr: false });
const DashboardPanel = dynamic(() => import("./panels/DashboardPanel").then(m => ({ default: m.DashboardPanel })), { ssr: false });
const AssistantPanel = dynamic(() => import("./panels/AssistantPanel").then(m => ({ default: m.AssistantPanel })), { ssr: false });

export function RightPanelZone() {
  const { previewOpen, previewFile, gitPanelOpen, dashboardPanelOpen, assistantPanelOpen } = usePanel();

  const anyOpen = (previewOpen && !!previewFile) || gitPanelOpen || dashboardPanelOpen || assistantPanelOpen;

  return (
    <div className="flex h-full shrink-0 border-l border-border/40 overflow-hidden">
      {anyOpen && (
        <>
          {assistantPanelOpen && <AssistantPanel />}
          {previewOpen && previewFile && <PreviewPanel />}
          {gitPanelOpen && <GitPanelContainer />}
          {dashboardPanelOpen && <DashboardPanel />}
        </>
      )}
    </div>
  );
}
