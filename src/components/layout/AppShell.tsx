"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
// NavRail removed — navigation merged into ChatListPanel
import { ChatListPanel } from "./ChatListPanel";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { UpdateBanner } from "./UpdateBanner";
import { UnifiedTopBar } from "./UnifiedTopBar";
import { PanelZone } from "./PanelZone";
import { FileTreePanel } from "./panels/FileTreePanel";
import { RightPanelZone } from "./RightPanelZone";
import { PanelContext, type PreviewViewMode } from "@/hooks/usePanel";
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
import { BottomPanelContainer } from './BottomPanelContainer';
import { BrowserTabView } from './BrowserTabView';

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

  // Sync with viewport after hydration to avoid SSR mismatch
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setChatListOpenRaw(window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(240);

  // Restore persisted width after hydration
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = localStorage.getItem("codepilot_chatlist_width");
    if (saved) setChatListWidth(parseInt(saved));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  // --- New independent panel states ---
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [dashboardPanelOpen, setDashboardPanelOpen] = useState(false);
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [isAssistantWorkspace, setIsAssistantWorkspace] = useState(false);

  // --- Bottom panel (Terminal / Console) ---
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<import("@/hooks/usePanel").BottomPanelTab>("terminal");

  // --- Main area view mode (chat vs browser) ---
  const [mainViewMode, setMainViewMode] = useState<"chat" | "browser">("chat");

  // --- Browser tab (shown in main content area) ---
  const [browserTabOpen, setBrowserTabOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("");

  // --- Git summary (derived from polling hook, no setState needed) ---
  const [currentWorktreeLabel, setCurrentWorktreeLabel] = useState("");

  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  const { status: gitStatusFromHook } = useGitStatus(workingDirectory);
  const currentBranch = gitStatusFromHook?.branch ?? "";
  const gitDirtyCount = gitStatusFromHook?.changedFiles.filter(f => f.status !== 'untracked').length ?? 0;

  // --- Multi-session stream tracking (driven by stream-session-manager) ---
  const [activeStreamingSessions, setActiveStreamingSessions] = useState<Set<string>>(EMPTY_SET);
  const [pendingApprovalSessionIds, setPendingApprovalSessionIds] = useState<Set<string>>(EMPTY_SET);

  // Listen for global stream events from stream-session-manager
  useEffect(() => {
    const handler = () => {
      const activeIds = getActiveSessionIds();
      setActiveStreamingSessions(activeIds.length > 0 ? new Set(activeIds) : EMPTY_SET);

      const approvals = new Set<string>();
      for (const sid of activeIds) {
        const snap = getSnapshot(sid);
        if (snap?.pendingPermission && !snap.permissionResolved) {
          approvals.add(sid);
        }
      }
      setPendingApprovalSessionIds(approvals.size > 0 ? approvals : EMPTY_SET);
    };
    window.addEventListener('stream-session-event', handler);
    return () => window.removeEventListener('stream-session-event', handler);
  }, []);

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
        const currentSessionId = sessionId;
        if (currentSessionId && currentSessionId !== session.sessionId) {
          const currentSession: SplitSession = {
            sessionId: currentSessionId,
            title: sessionTitle || "New Conversation",
            workingDirectory: workingDirectory || "",
            projectName: "",
            mode: "code",
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
  }, [sessionId, sessionTitle, workingDirectory]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // --- Main view mode control functions ---
  const switchToBrowser = useCallback((url?: string) => {
    if (url) {
      setBrowserUrl(url);
      setBrowserTabOpen(true);
    }
    setMainViewMode("browser");
  }, []);

  const switchToChat = useCallback(() => {
    setMainViewMode("chat");
    // Optionally close browser
    // setBrowserTabOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode === "chat" || detail?.mode === "browser") {
        setMainViewMode(detail.mode);
      }
    };
    window.addEventListener("main-view-switch", handler);
    return () => window.removeEventListener("main-view-switch", handler);
  }, []);

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode === "chat" || detail?.mode === "browser") {
        setMainViewMode(detail.mode);
      }
    };
    window.addEventListener("main-view-switch", handler);
    return () => window.removeEventListener("main-view-switch", handler);
  }, []);

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    if (activeStreamingSessions.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeStreamingSessions]);

  // --- Doc Preview state ---
  const [previewFile, setPreviewFileRaw] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");

  const setPreviewFile = useCallback((path: string | null) => {
    setPreviewFileRaw(path);
    if (path) {
      setPreviewViewMode(defaultViewMode(path));
      setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, []);

  // Reset doc preview and panels when navigating between pages/sessions
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewFileRaw(null);
    setPreviewOpen(false);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep chat list state in sync when resizing across the breakpoint
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);


  // --- Skip-permissions indicator ---
  const [skipPermissionsActive, setSkipPermissionsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      try {
        const res = await fetch("/api/settings/app");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSkipPermissionsActive(data.settings?.dangerously_skip_permissions === "true");
        }
      } catch { /* ignore */ }
    };
    doFetch();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") doFetch();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", doFetch);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", doFetch);
    };
  }, []);

  // --- Update checker (native Electron + browser fallback) ---
  const updateContextValue = useUpdateChecker();

  const panelContextValue = useMemo(
    () => ({
      // --- Independent panels ---
      fileTreeOpen,
      setFileTreeOpen,
      gitPanelOpen,
      setGitPanelOpen,
      previewOpen,
      setPreviewOpen,
      terminalOpen,
      setTerminalOpen,
      dashboardPanelOpen,
      setDashboardPanelOpen,
      assistantPanelOpen,
      setAssistantPanelOpen,
      isAssistantWorkspace,
      setIsAssistantWorkspace,

      // --- Bottom panel (Terminal / Console) ---
      bottomPanelOpen,
      setBottomPanelOpen,
      bottomPanelTab,
      setBottomPanelTab,

      // --- Browser tab (shown in main content area) ---
      browserTabOpen,
      setBrowserTabOpen,
      browserUrl,
      setBrowserUrl,

      // --- Main area view mode (chat vs browser) ---
      mainViewMode,
      setMainViewMode,

      // --- Git summary (for top bar, derived — no setters) ---
      currentBranch,
      gitDirtyCount,
      currentWorktreeLabel,
      setCurrentWorktreeLabel,

      // --- Preserved from old API (workspace) ---
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,

      // --- Multi-session streaming & approvals ---
      activeStreamingSessions,
      pendingApprovalSessionIds,

      // --- Document preview ---
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [
      fileTreeOpen,
      setFileTreeOpen,
      gitPanelOpen,
      setGitPanelOpen,
      previewOpen,
      setPreviewOpen,
      terminalOpen,
      setTerminalOpen,
      dashboardPanelOpen,
      setDashboardPanelOpen,
      assistantPanelOpen,
      setAssistantPanelOpen,
      isAssistantWorkspace,
      setIsAssistantWorkspace,
      bottomPanelOpen,
      setBottomPanelOpen,
      bottomPanelTab,
      setBottomPanelTab,
      browserTabOpen,
      setBrowserTabOpen,
      browserUrl,
      setBrowserUrl,
      mainViewMode,
      setMainViewMode,
      currentBranch,
      gitDirtyCount,
      currentWorktreeLabel,
      setCurrentWorktreeLabel,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      activeStreamingSessions,
      pendingApprovalSessionIds,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    ]
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
            {/* Left Panel Zone - File Tree */}
            {isChatDetailRoute && fileTreeOpen && mainViewMode === "chat" && (
              <>
                <div className="flex h-full shrink-0 border-r border-border/40 overflow-hidden w-64">
                  <FileTreePanel />
                </div>
                <ResizeHandle side="right" onResize={() => {}} onResizeEnd={() => {}} />
              </>
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <UnifiedTopBar />
              <UpdateBanner />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <main className="relative flex-1 overflow-hidden">
                    {mainViewMode === "browser" && browserTabOpen ? (
                      <BrowserTabView />
                    ) : isSplitActive ? (
                      <SplitChatContainer />
                    ) : (
                      <ErrorBoundary>{children}</ErrorBoundary>
                    )}
                  </main>
                  <BottomPanelContainer />
                </div>
                {isChatDetailRoute && mainViewMode === "chat" && <RightPanelZone />}
              </div>
            </div>
          </div>
          <UpdateDialog />
          <Toaster />
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
