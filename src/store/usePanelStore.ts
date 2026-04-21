"use client";

import { create } from "zustand";
import type { PreviewViewMode, WorkspaceTab, BottomPanelTab } from "@/hooks/usePanel";

interface PanelStore {
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
  openPreviewTab: (path: string, defaultViewMode: (path: string) => PreviewViewMode) => void;
  openBrowserTab: (url: string, title?: string) => void;
  openTerminalTab: (terminalId?: string, title?: string) => void;
  updateWorkspaceTab: (id: string, updates: Partial<WorkspaceTab>) => void;
  closeWorkspaceTab: (id: string) => void;
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
  setActiveStreamingSessions: (sessions: Set<string>) => void;
  pendingApprovalSessionIds: Set<string>;
  setPendingApprovalSessionIds: (ids: Set<string>) => void;
  previewFile: string | null;
  setPreviewFile: (path: string | null, defaultViewMode: (path: string) => PreviewViewMode) => void;
  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  fileTreeOpen: false,
  setFileTreeOpen: (open) => set({ fileTreeOpen: open }),
  gitPanelOpen: false,
  setGitPanelOpen: (open) => set({ gitPanelOpen: open }),
  previewOpen: false,
  setPreviewOpen: (open) => set({ previewOpen: open }),
  terminalOpen: false,
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  dashboardPanelOpen: true,
  setDashboardPanelOpen: (open) => set({ dashboardPanelOpen: open }),
  assistantPanelOpen: false,
  setAssistantPanelOpen: (open) => set({ assistantPanelOpen: open }),
  isAssistantWorkspace: false,
  setIsAssistantWorkspace: (is) => set({ isAssistantWorkspace: is }),
  bottomPanelOpen: false,
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  bottomPanelTab: "console",
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  workspaceTabs: [],
  activeWorkspaceTabId: null,
  setActiveWorkspaceTabId: (id) => set({ activeWorkspaceTabId: id }),
  openPreviewTab: (path, defaultViewMode) => {
    const { workspaceTabs, previewOpen, setPreviewOpen } = get();
    const existingTab = workspaceTabs.find((t) => t.filePath === path);
    if (existingTab) {
      set({ activeWorkspaceTabId: existingTab.id });
    } else {
      const newTab: WorkspaceTab = {
        id: `preview-${Date.now()}`,
        kind: "preview",
        title: path.split("/").pop() || path,
        closable: true,
        filePath: path,
      };
      set({
        workspaceTabs: [...workspaceTabs, newTab],
        activeWorkspaceTabId: newTab.id,
        previewViewMode: defaultViewMode(path),
      });
    }
    if (!previewOpen) setPreviewOpen(true);
  },
  openBrowserTab: (url, title) => {
    const { workspaceTabs, previewOpen, setPreviewOpen } = get();
    // Try to find an existing browser tab, or create a new one
    const existingTab = workspaceTabs.find((t) => t.kind === "browser");
    if (existingTab) {
      // Update existing tab url and title
      const newTabs = workspaceTabs.map(t => 
        t.id === existingTab.id ? { ...t, url, title: title || t.title } : t
      );
      set({ workspaceTabs: newTabs, activeWorkspaceTabId: existingTab.id });
    } else {
      const newTab: WorkspaceTab = {
        id: `browser-${Date.now()}`,
        kind: "browser",
        title: title || "新标签页",
        closable: true,
        url: url,
      };
      set({
        workspaceTabs: [...workspaceTabs, newTab],
        activeWorkspaceTabId: newTab.id,
      });
    }
    if (!previewOpen) setPreviewOpen(true);
  },
  openTerminalTab: (terminalId, title) => {
    const { workspaceTabs, previewOpen, setPreviewOpen } = get();
    const newTab: WorkspaceTab = {
      id: terminalId ? `terminal-${terminalId}` : `terminal-${Date.now()}`,
      kind: "terminal",
      title: title || "Terminal",
      closable: true,
      terminalId,
    };
    set({
      workspaceTabs: [...workspaceTabs, newTab],
      activeWorkspaceTabId: newTab.id,
    });
    if (!previewOpen) setPreviewOpen(true);
  },
  updateWorkspaceTab: (id, updates) => {
    const { workspaceTabs } = get();
    set({
      workspaceTabs: workspaceTabs.map(t => t.id === id ? { ...t, ...updates } : t)
    });
  },
  closeWorkspaceTab: (id) => {
    const { workspaceTabs, activeWorkspaceTabId } = get();
    const newTabs = workspaceTabs.filter((t) => t.id !== id);
    let newActiveId = activeWorkspaceTabId;
    if (activeWorkspaceTabId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    set({ workspaceTabs: newTabs, activeWorkspaceTabId: newActiveId });
  },
  currentWorktreeLabel: "",
  setCurrentWorktreeLabel: (label) => set({ currentWorktreeLabel: label }),
  workingDirectory: "",
  setWorkingDirectory: (dir) => set({ workingDirectory: dir }),
  sessionId: "",
  setSessionId: (id) => set({ sessionId: id }),
  sessionTitle: "",
  setSessionTitle: (title) => set({ sessionTitle: title }),
  streamingSessionId: "",
  setStreamingSessionId: (id) => set({ streamingSessionId: id }),
  pendingApprovalSessionId: "",
  setPendingApprovalSessionId: (id) => set({ pendingApprovalSessionId: id }),
  activeStreamingSessions: new Set(),
  setActiveStreamingSessions: (sessions) => set({ activeStreamingSessions: sessions }),
  pendingApprovalSessionIds: new Set(),
  setPendingApprovalSessionIds: (ids) => set({ pendingApprovalSessionIds: ids }),
  previewFile: null,
  setPreviewFile: (path, defaultViewMode) => {
    set({
      previewFile: path,
      previewViewMode: path ? defaultViewMode(path) : "source",
    });
  },
  previewViewMode: "source",
  setPreviewViewMode: (mode) => set({ previewViewMode: mode }),
}));
