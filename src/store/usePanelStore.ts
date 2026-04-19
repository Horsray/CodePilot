import { create } from 'zustand';
import type { PreviewViewMode, BottomPanelTab, WorkspaceTab } from '@/hooks/usePanel';

interface PanelState {
  fileTreeOpen: boolean;
  setFileTreeOpen: (open: boolean) => void;
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
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

  currentBranch: string;
  gitDirtyCount: number;
  setGitSummary: (branch: string, dirtyCount: number) => void;

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
  setPreviewFile: (path: string | null) => void;
  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;

  openPreviewTab: (path: string) => void;
  closeWorkspaceTab: (id: string) => void;
}

const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

function createWorkspaceId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

function getFileTabTitle(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export const usePanelStore = create<PanelState>((set, get) => ({
  fileTreeOpen: false,
  setFileTreeOpen: (open) => set({ fileTreeOpen: open }),
  gitPanelOpen: false,
  setGitPanelOpen: (open) => set({ gitPanelOpen: open }),
  previewOpen: false,
  setPreviewOpen: (open) => set({ previewOpen: open }),
  dashboardPanelOpen: false,
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

  currentBranch: "",
  gitDirtyCount: 0,
  setGitSummary: (currentBranch, gitDirtyCount) => set({ currentBranch, gitDirtyCount }),

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
  setPreviewFile: (path) => {
    set({ previewFile: path });
    if (path) {
      set({ previewViewMode: defaultViewMode(path), previewOpen: true });
    } else {
      set({ previewOpen: false });
    }
  },
  previewViewMode: "source",
  setPreviewViewMode: (mode) => set({ previewViewMode: mode }),

  openPreviewTab: (path: string) => {
    const state = get();
    const existingTab = state.workspaceTabs.find((tab) => tab.kind === "preview" && tab.filePath === path);
    set({
      previewFile: path,
      previewViewMode: defaultViewMode(path),
      previewOpen: false,
    });
    if (existingTab) {
      set({ activeWorkspaceTabId: existingTab.id });
      return;
    }
    const id = createWorkspaceId("preview");
    set({
      workspaceTabs: [
        ...state.workspaceTabs,
        {
          id,
          kind: "preview",
          title: getFileTabTitle(path),
          filePath: path,
          closable: true,
        },
      ],
      activeWorkspaceTabId: id,
    });
  },

  closeWorkspaceTab: (id: string) => {
    const state = get();
    const index = state.workspaceTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = state.workspaceTabs.filter((tab) => tab.id !== id);
    if (state.activeWorkspaceTabId === id) {
      const fallback = next[index] || next[index - 1] || next[0] || null;
      set({ activeWorkspaceTabId: fallback?.id ?? null });
    }
    set({ workspaceTabs: next });
  },
}));