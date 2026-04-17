"use client";

import { createContext, useContext, useMemo } from "react";
import { usePanelStore } from "@/stores/panelStore";
import { useGitStatus } from "@/hooks/useGitStatus";

export type PanelContent = "files" | "tasks";

export type PreviewViewMode = "source" | "rendered";
export type BottomPanelTab = "console";
export type WorkspaceTabKind = "preview";

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  closable: boolean;
  url?: string;
  filePath?: string;
  sessionId?: string;
}

export interface PanelContextValue {
  fileTreeOpen: boolean;
  setFileTreeOpen: (open: boolean) => void;
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  dashboardPanelOpen: boolean;
  setDashboardPanelOpen: (open: boolean) => void;
  assistantPanelOpen: boolean;
  setAssistantPanelOpen: (open: boolean) => void;
  isAssistantWorkspace: boolean;
  setIsAssistantWorkspace: (is: boolean) => void;
  bottomPanelOpen: boolean;
  setBottomPanelOpen: (open: boolean) => void;
  bottomPanelTab: BottomPanelTab;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  workspaceTabs: WorkspaceTab[];
  activeWorkspaceTabId: string | null;
  setActiveWorkspaceTabId: (id: string | null) => void;
  openPreviewTab: (path: string) => void;
  closeWorkspaceTab: (id: string) => void;

  currentBranch: string;
  gitDirtyCount: number;
  currentWorktreeLabel: string;
  setCurrentWorktreeLabel: (label: string) => void;

  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  streamingSessionId: string;
  setStreamingSessionId: (id: string) => void;
  pendingApprovalSessionId: string;
  setPendingApprovalSessionId: (id: string) => void;
  activeStreamingSessions: Set<string>;
  pendingApprovalSessionIds: Set<string>;
  previewFile: string | null;
  setPreviewFile: (path: string | null) => void;
  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;
}

export const PanelContext = createContext<PanelContextValue | null>(null);

const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

export function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

export function usePanel(): PanelContextValue {
  const store = usePanelStore();
  const { status: gitStatusFromHook } = useGitStatus(store.workingDirectory);
  
  const currentBranch = gitStatusFromHook?.branch ?? "";
  const gitDirtyCount = gitStatusFromHook?.changedFiles.filter(f => f.status !== 'untracked').length ?? 0;

  return useMemo(() => ({
    ...store,
    currentBranch,
    gitDirtyCount,
    openPreviewTab: (path: string) => store.openPreviewTab(path, defaultViewMode),
    setPreviewFile: (path: string | null) => store.setPreviewFile(path, defaultViewMode),
  }), [store, currentBranch, gitDirtyCount]);
}
