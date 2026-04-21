"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
// NavRail removed — navigation merged into ChatListPanel
import { ChatListPanel } from "./ChatListPanel";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { FeatureAnnouncementDialog } from "./FeatureAnnouncementDialog";
import { UpdateBanner } from "./UpdateBanner";
import { UnifiedTopBar } from "./UnifiedTopBar";
import { PanelZone } from "./PanelZone";
import { BottomPanelContainer } from "./BottomPanelContainer";
import { usePanelStore } from "@/store/usePanelStore";
import { PanelContext, type PreviewViewMode, type WorkspaceTab } from "@/hooks/usePanel";
import { UpdateContext } from "@/hooks/useUpdate";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { ImageGenContext, useImageGenState } from "@/hooks/useImageGen";
import { BatchImageGenContext, useBatchImageGenState } from "@/hooks/useBatchImageGen";
import { SplitContext, type SplitSession } from "@/hooks/useSplit";
import { SplitChatContainer } from "./SplitChatContainer";
import { ErrorBoundary } from "./ErrorBoundary";
import { SentryInit } from "./SentryInit";
import { getActiveSessionIds, getSnapshot } from "@/lib/stream-session-manager";
import { useGitStatus } from "@/hooks/useGitStatus";
import { SetupCenter } from '@/components/setup/SetupCenter';
import { Toaster } from '@/components/ui/toast';
import { useNotificationPoll } from '@/hooks/useNotificationPoll';
import { useGlobalSearchShortcut } from '@/hooks/useGlobalSearchShortcut';
import { GlobalSearchDialog } from './GlobalSearchDialog';

const PreviewPanel = dynamic(() => import("./panels/PreviewPanel").then(m => ({ default: m.PreviewPanel })), { ssr: false });

const SPLIT_SESSIONS_KEY = "codepilot:split-sessions";
const SPLIT_ACTIVE_COLUMN_KEY = "codepilot:split-active-column";

function loadSplitSessions(): SplitSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SPLIT_SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSplitSessions(sessions: SplitSession[]) {
  if (sessions.length >= 2) {
    localStorage.setItem(SPLIT_SESSIONS_KEY, JSON.stringify(sessions));
  } else {
    localStorage.removeItem(SPLIT_SESSIONS_KEY);
    localStorage.removeItem(SPLIT_ACTIVE_COLUMN_KEY);
  }
}

function loadActiveColumn(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SPLIT_ACTIVE_COLUMN_KEY) || "";
}

const EMPTY_SET = new Set<string>();
const CHATLIST_MIN = 180;
const CHATLIST_MAX = 300;

/** Extensions that default to "rendered" view mode */
const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}


const LG_BREAKPOINT = 1024;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [chatListOpenRaw, setChatListOpenRaw] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialCard, setSetupInitialCard] = useState<'claude' | 'provider' | 'project' | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  // Poll server-side notification queue and display as toasts
  useNotificationPoll();

  // Check if setup is needed
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.completed) {
          setSetupOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  // Listen for open-setup-center events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSetupInitialCard(detail?.initialCard);
      setSetupOpen(true);
    };
    window.addEventListener('open-setup-center', handler);
    return () => window.removeEventListener('open-setup-center', handler);
  }, []);

  // Hash bridge: error messages render `[Open Settings](/settings#providers)`
  // markdown links as fallback when the frontend cannot directly dispatch the
  // open-setup-center event (e.g. rendering inside the SSE text stream). When
  // such a link is clicked the hash changes to `#providers`, and we surface
  // the SetupCenter Provider card here.
  useEffect(() => {
    const maybeOpenFromHash = () => {
      if (typeof window === 'undefined') return;
      if (window.location.hash === '#providers') {
        setSetupInitialCard('provider');
        setSetupOpen(true);
        // Clear the hash so a second navigation to /#providers fires again.
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    maybeOpenFromHash();
    window.addEventListener('hashchange', maybeOpenFromHash);
    return () => window.removeEventListener('hashchange', maybeOpenFromHash);
  }, []);

  // Listen for open-global-search events from ChatListPanel
  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener('open-global-search', handler);
    return () => window.removeEventListener('open-global-search', handler);
  }, []);

  // Sync with viewport after hydration to avoid SSR mismatch
  useEffect(() => {
    // 中文注释：首屏挂载后按视口同步聊天列表开关，避免 SSR 与客户端宽度不一致。
    setChatListOpenRaw(window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches);
  }, []);

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(240);

  // Restore persisted width after hydration
  useEffect(() => {
    // 中文注释：恢复聊天列表宽度；仅在客户端读取本地缓存并回填。
    const saved = localStorage.getItem("codepilot_chatlist_width");
    if (saved) setChatListWidth(parseInt(saved));
  }, []);

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.min(CHATLIST_MAX, Math.max(CHATLIST_MIN, w + delta)));
  }, []);
  const handleChatListResizeEnd = useCallback(() => {
    setChatListWidth((w) => {
      localStorage.setItem("codepilot_chatlist_width", String(w));
      return w;
    });
  }, []);

  // Panel state — chatListOpen is no longer gated by route (sidebar always visible)
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const chatListOpen = chatListOpenRaw;


  // --- New independent panel states ---
  const store = usePanelStore();

  // Listen for global stream events from stream-session-manager
  useEffect(() => {
    const handler = () => {
      const activeIds = getActiveSessionIds();
      store.setActiveStreamingSessions(activeIds.length > 0 ? new Set(activeIds) : EMPTY_SET);

      const approvals = new Set<string>();
      for (const sid of activeIds) {
        const snap = getSnapshot(sid);
        if (snap?.pendingPermission && !snap.permissionResolved) {
          approvals.add(sid);
        }
      }
      store.setPendingApprovalSessionIds(approvals.size > 0 ? approvals : EMPTY_SET);
    };
    window.addEventListener('stream-session-event', handler);
    return () => window.removeEventListener('stream-session-event', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.setActiveStreamingSessions, store.setPendingApprovalSessionIds]);

  // --- Split-screen state ---
  const [splitSessions, setSplitSessions] = useState<SplitSession[]>(() => loadSplitSessions());
  const [activeColumnId, setActiveColumnIdRaw] = useState<string>(() => loadActiveColumn());
  const isSplitActive = splitSessions.length >= 2;
  const isChatDetailRoute = pathname.startsWith("/chat/") || isSplitActive;

  // Persist split sessions to localStorage
  useEffect(() => {
    saveSplitSessions(splitSessions);
    if (activeColumnId) {
      localStorage.setItem(SPLIT_ACTIVE_COLUMN_KEY, activeColumnId);
    }
  }, [splitSessions, activeColumnId]);

  // URL sync: when activeColumn changes, update router
  useEffect(() => {
    if (isSplitActive && activeColumnId) {
      const target = `/chat/${activeColumnId}`;
      if (pathname !== target) {
        router.replace(target);
      }
    }
  }, [isSplitActive, activeColumnId, pathname, router]);

  const setActiveColumn = useCallback((sessionId: string) => {
    setActiveColumnIdRaw(sessionId);
  }, []);

  const addToSplit = useCallback((session: SplitSession) => {
    setSplitSessions((prev) => {
      if (prev.some((s) => s.sessionId === session.sessionId)) return prev;

      if (prev.length < 2) {
        const currentSessionId = store.sessionId;
        if (currentSessionId && currentSessionId !== session.sessionId) {
          const currentSession: SplitSession = {
            sessionId: currentSessionId,
            title: store.sessionTitle || "New Conversation",
            workingDirectory: store.workingDirectory || "",
            projectName: "",
            mode: store.isAssistantWorkspace ? "architect" : "code",
          };
          const hasCurrentAlready = prev.some((s) => s.sessionId === currentSessionId);
          const next = hasCurrentAlready ? [...prev, session] : [...prev, currentSession, session];
          setActiveColumnIdRaw(session.sessionId);
          return next;
        }
      }

      const next = [...prev, session];
      setActiveColumnIdRaw(session.sessionId);
      return next;
    });
  }, [store.sessionId, store.sessionTitle, store.workingDirectory, store.isAssistantWorkspace]);

  const pendingNavigateRef = useRef<string | null>(null);

  const removeFromSplit = useCallback((removeId: string) => {
    setSplitSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== removeId);
      if (next.length <= 1) {
        if (next.length === 1) {
          pendingNavigateRef.current = next[0].sessionId;
        }
        return [];
      }
      setActiveColumnIdRaw((currentActive) =>
        currentActive === removeId ? next[0].sessionId : currentActive
      );
      return next;
    });
  }, []);

  useEffect(() => {
    if (pendingNavigateRef.current) {
      const target = pendingNavigateRef.current;
      pendingNavigateRef.current = null;
      router.replace(`/chat/${target}`);
    }
  }, [splitSessions, router]);

  const exitSplit = useCallback(() => {
    const firstSession = splitSessions[0];
    setSplitSessions([]);
    setActiveColumnIdRaw("");
    if (firstSession) {
      router.replace(`/chat/${firstSession.sessionId}`);
    }
  }, [splitSessions, router]);

  const isInSplit = useCallback((sid: string) => {
    return splitSessions.some((s) => s.sessionId === sid);
  }, [splitSessions]);

  useEffect(() => {
    const handler = () => {
      setSplitSessions((prev) => prev);
    };
    window.addEventListener("session-deleted", handler);
    return () => window.removeEventListener("session-deleted", handler);
  }, []);

  useEffect(() => {
    if (isSplitActive && !pathname.startsWith("/chat")) {
      // 中文注释：离开聊天路由时清空分栏状态，避免旧会话残留在工作区。
      setSplitSessions([]);
      setActiveColumnIdRaw("");
    }
  }, [pathname, isSplitActive]);

  const splitContextValue = useMemo(
    () => ({
      splitSessions,
      activeColumnId,
      isSplitActive,
      addToSplit,
      removeFromSplit,
      setActiveColumn,
      exitSplit,
      isInSplit,
    }),
    [splitSessions, activeColumnId, isSplitActive, addToSplit, removeFromSplit, setActiveColumn, exitSplit, isInSplit]
  );

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    if (store.activeStreamingSessions.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store.activeStreamingSessions]);

  // Reset doc preview and panels when navigating between pages/sessions
  useEffect(() => {
    // 中文注释：切换页面或会话时重置预览面板，防止沿用上一页的文件上下文。
    store.setPreviewFile(null, defaultViewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, store.setPreviewFile]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && (isChatRoute || isSplitActive)) {
        store.setActiveWorkspaceTabId(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, store.sessionId, isChatRoute, isSplitActive, store.setActiveWorkspaceTabId]);

  // Keep chat list state in sync when resizing across the breakpoint
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);


  // --- Git Status ---
  // 中文注释：获取当前工作目录的 Git 状态，用于更新面板上下文的当前分支和变更文件数。
  const { status: gitStatus } = useGitStatus(store.workingDirectory || "");


  // --- Update checker (native Electron + browser fallback) ---
  const updateContextValue = useUpdateChecker();

  const activeWorkspaceTab = useMemo(
    () => store.workspaceTabs.find((t: WorkspaceTab) => t.id === store.activeWorkspaceTabId) || null,
    [store.workspaceTabs, store.activeWorkspaceTabId]
  );

  const panelContextValue = useMemo(
    () => ({
      fileTreeOpen: store.fileTreeOpen,
      setFileTreeOpen: store.setFileTreeOpen,
      gitPanelOpen: store.gitPanelOpen,
      setGitPanelOpen: store.setGitPanelOpen,
      previewOpen: store.previewOpen,
      setPreviewOpen: store.setPreviewOpen,
      terminalOpen: store.terminalOpen,
      setTerminalOpen: store.setTerminalOpen,
      dashboardPanelOpen: store.dashboardPanelOpen,
      setDashboardPanelOpen: store.setDashboardPanelOpen,
      assistantPanelOpen: store.assistantPanelOpen,
      setAssistantPanelOpen: store.setAssistantPanelOpen,
      isAssistantWorkspace: store.isAssistantWorkspace,
      setIsAssistantWorkspace: store.setIsAssistantWorkspace,
      currentBranch: gitStatus?.branch || "",
      gitDirtyCount: gitStatus?.changedFiles?.length || 0,
      currentWorktreeLabel: store.currentWorktreeLabel,
      setCurrentWorktreeLabel: store.setCurrentWorktreeLabel,
      workingDirectory: store.workingDirectory,
      setWorkingDirectory: store.setWorkingDirectory,
      sessionId: store.sessionId,
      setSessionId: store.setSessionId,
      sessionTitle: store.sessionTitle,
      setSessionTitle: store.setSessionTitle,
      streamingSessionId: store.streamingSessionId,
      setStreamingSessionId: store.setStreamingSessionId,
      pendingApprovalSessionId: store.pendingApprovalSessionId,
      setPendingApprovalSessionId: store.setPendingApprovalSessionId,
      activeStreamingSessions: store.activeStreamingSessions,
      pendingApprovalSessionIds: store.pendingApprovalSessionIds,
      previewFile: store.previewFile,
      setPreviewFile: (p: string | null) => store.setPreviewFile(p, defaultViewMode),
      previewViewMode: store.previewViewMode,
      setPreviewViewMode: store.setPreviewViewMode,
      bottomPanelOpen: store.bottomPanelOpen,
      setBottomPanelOpen: store.setBottomPanelOpen,
      bottomPanelTab: store.bottomPanelTab,
      setBottomPanelTab: store.setBottomPanelTab,
      workspaceTabs: store.workspaceTabs,
      activeWorkspaceTabId: store.activeWorkspaceTabId,
      setActiveWorkspaceTabId: store.setActiveWorkspaceTabId,
      openPreviewTab: (p: string) => store.openPreviewTab(p, defaultViewMode),
      closeWorkspaceTab: store.closeWorkspaceTab,
    }),
    [store, gitStatus?.branch, gitStatus?.changedFiles?.length]
  );

  const imageGenValue = useImageGenState();
  const batchImageGenValue = useBatchImageGenState();

  return (
    <UpdateContext.Provider value={updateContextValue}>
      <SentryInit />
      <PanelContext.Provider value={panelContextValue}>
        <SplitContext.Provider value={splitContextValue}>
        <ImageGenContext.Provider value={imageGenValue}>
        <BatchImageGenContext.Provider value={batchImageGenValue}>
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen overflow-hidden">
            <ErrorBoundary>
              <ChatListPanel
                open={chatListOpen}
                width={chatListWidth}
                hasUpdate={updateContextValue.updateInfo?.updateAvailable ?? false}
                readyToInstall={updateContextValue.updateInfo?.readyToInstall ?? false}
              />
            </ErrorBoundary>
            {chatListOpen && (
              <ResizeHandle side="left" onResize={handleChatListResize} onResizeEnd={handleChatListResizeEnd} />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <UnifiedTopBar />
              <UpdateBanner />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <main className="relative flex-1 overflow-hidden">
                    {isChatRoute || isSplitActive ? (
                      activeWorkspaceTab ? (
                        <div className="absolute inset-0 min-h-0">
                          {activeWorkspaceTab.kind === "preview" && activeWorkspaceTab.filePath ? (
                            <PreviewPanel
                              standalone
                              filePath={activeWorkspaceTab.filePath}
                              onClose={() => store.closeWorkspaceTab(activeWorkspaceTab.id)}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div className="absolute inset-0 min-h-0">
                          {isSplitActive ? (
                            <SplitChatContainer />
                          ) : (
                            <ErrorBoundary>{children}</ErrorBoundary>
                          )}
                        </div>
                      )
                    ) : (
                      <ErrorBoundary>{children}</ErrorBoundary>
                    )}
                  </main>
                  <BottomPanelContainer />
                </div>
                {isChatDetailRoute && <PanelZone />}
              </div>
            </div>
          </div>
          <UpdateDialog />
          <FeatureAnnouncementDialog />
          <Toaster />
          <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
          {setupOpen && (
            <SetupCenter
              onClose={() => setSetupOpen(false)}
              initialCard={setupInitialCard}
            />
          )}
        </TooltipProvider>
        </BatchImageGenContext.Provider>
        </ImageGenContext.Provider>
        </SplitContext.Provider>
      </PanelContext.Provider>
    </UpdateContext.Provider>
  );
}
