"use client";

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
import { BrowserTabView } from "./BrowserTabView";
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
import { PreviewPanel } from "./panels/PreviewPanel";

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

function getFileTabTitle(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function getBrowserTabTitle(url?: string): string {
  if (!url) return "Browser";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || "Browser";
  } catch {
    return "Browser";
  }
}

function createWorkspaceId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

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
  useEffect(() => {
    setChatListOpenRaw(window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches);
  }, []);

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(240);

  // Restore persisted width after hydration
  useEffect(() => {
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
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<"terminal" | "console">("terminal");
  const [browserUrl, setBrowserUrl] = useState("");
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabIdRaw] = useState<string | null>(null);

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
      
      setActiveStreamingSessions(prev => {
        if (prev.size !== activeIds.length) return new Set(activeIds);
        for (const id of activeIds) {
          if (!prev.has(id)) return new Set(activeIds);
        }
        return prev;
      });

      const approvals = new Set<string>();
      for (const sid of activeIds) {
        const snap = getSnapshot(sid);
        if (snap?.pendingPermission && !snap.permissionResolved) {
          approvals.add(sid);
        }
      }
      
      setPendingApprovalSessionIds(prev => {
        if (prev.size !== approvals.size) return approvals;
        for (const id of approvals) {
          if (!prev.has(id)) return approvals;
        }
        return prev;
      });
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
  useEffect(() => {
    setPreviewFileRaw(null);
    setPreviewOpen(false);
  }, [pathname]);

  const setActiveWorkspaceTabId = useCallback((id: string | null) => {
    setActiveWorkspaceTabIdRaw(id);
  }, []);

  const openPreviewTab = useCallback((path: string) => {
    const existingTab = workspaceTabs.find((tab) => tab.kind === "preview" && tab.filePath === path);
    setPreviewFileRaw(path);
    setPreviewViewMode(defaultViewMode(path));
    setPreviewOpen(false);
    if (existingTab) {
      setActiveWorkspaceTabIdRaw(existingTab.id);
      return;
    }
    const id = createWorkspaceId("preview");
    setWorkspaceTabs((prev) => [
      ...prev,
      {
        id,
        kind: "preview",
        title: getFileTabTitle(path),
        filePath: path,
        closable: true,
      },
    ]);
    setActiveWorkspaceTabIdRaw(id);
  }, [workspaceTabs]);

  const openBrowserTab = useCallback((url?: string) => {
    const nextUrl = url?.trim() || browserUrl || "";
    const id = createWorkspaceId("browser");
    setWorkspaceTabs((prev) => [
      ...prev,
      {
        id,
        kind: "browser",
        title: getBrowserTabTitle(nextUrl),
        url: nextUrl,
        closable: true,
      },
    ]);
    setBrowserUrl(nextUrl);
    setActiveWorkspaceTabIdRaw(id);
  }, [browserUrl]);

  const closeWorkspaceTab = useCallback((id: string) => {
    setWorkspaceTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      if (index === -1) return prev;
      const next = prev.filter((tab) => tab.id !== id);
      if (activeWorkspaceTabId === id) {
        const fallback = next[index] || next[index - 1] || next[0] || null;
        setActiveWorkspaceTabIdRaw(fallback?.id ?? null);
      }
      return next;
    });
  }, [activeWorkspaceTabId]);

  const updateWorkspaceTab = useCallback((id: string, patch: Partial<WorkspaceTab>) => {
    setWorkspaceTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    );
  }, []);

  const syncBrowserContextMeta = useCallback((meta: { url?: string; title?: string }) => {
    if (!sessionId) return;
    fetch("/api/browser-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        type: "meta",
        ...(meta.url ? { url: meta.url } : {}),
        ...(meta.title ? { title: meta.title } : {}),
      }),
    }).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && (isChatRoute || isSplitActive)) {
        setActiveWorkspaceTabIdRaw(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, sessionId, isChatRoute, isSplitActive]);

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (typeof url === "string" && url.trim()) {
        openBrowserTab(url);
      }
    };
    window.addEventListener("browser-navigate", handler);
    return () => window.removeEventListener("browser-navigate", handler);
  }, [openBrowserTab]);

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab === "console") {
        setBottomPanelTab("console");
      } else {
        setBottomPanelTab("terminal");
      }
      setBottomPanelOpen(true);
    };
    window.addEventListener("terminal-ensure-visible", handler);
    return () => window.removeEventListener("terminal-ensure-visible", handler);
  }, [setBottomPanelOpen, setBottomPanelTab]);

  useEffect(() => {
    if (!sessionId || !browserUrl) return;
    syncBrowserContextMeta({ url: browserUrl });
  }, [browserUrl, sessionId, syncBrowserContextMeta]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!sessionId || detail?.source !== "browser" || !detail?.message) return;
      fetch("/api/browser-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          type: "log",
          level: detail.level || "log",
          message: detail.message,
          source: detail.source,
          url: browserUrl || undefined,
        }),
      }).catch(() => {});
    };
    window.addEventListener("console-log", handler);
    return () => window.removeEventListener("console-log", handler);
  }, [browserUrl, sessionId]);

  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) || null,
    [workspaceTabs, activeWorkspaceTabId]
  );
  const mainViewMode: "chat" | "browser" = activeWorkspaceTab?.kind === "browser" ? "browser" : "chat";
  const browserTabOpen = workspaceTabs.some((tab) => tab.kind === "browser");
  const setMainViewMode = useCallback((mode: "chat" | "browser") => {
    if (mode === "chat") {
      setActiveWorkspaceTabIdRaw(null);
      return;
    }
    const firstBrowser = workspaceTabs.find((tab) => tab.kind === "browser");
    if (firstBrowser) {
      setActiveWorkspaceTabIdRaw(firstBrowser.id);
      return;
    }
    openBrowserTab(browserUrl);
  }, [browserUrl, openBrowserTab, workspaceTabs]);
  const setBrowserTabOpen = useCallback((open: boolean) => {
    if (open) {
      const firstBrowser = workspaceTabs.find((tab) => tab.kind === "browser");
      if (firstBrowser) {
        setActiveWorkspaceTabIdRaw(firstBrowser.id);
        return;
      }
      openBrowserTab(browserUrl);
      return;
    }
    const browserTabIds = new Set(workspaceTabs.filter((tab) => tab.kind === "browser").map((tab) => tab.id));
    if (browserTabIds.size === 0) return;
    setWorkspaceTabs((prev) => prev.filter((tab) => !browserTabIds.has(tab.id)));
    if (activeWorkspaceTab && browserTabIds.has(activeWorkspaceTab.id)) {
      setActiveWorkspaceTabIdRaw(null);
    }
  }, [activeWorkspaceTab, browserUrl, openBrowserTab, workspaceTabs]);

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
      mainViewMode,
      setMainViewMode,
      browserTabOpen,
      setBrowserTabOpen,
      browserUrl,
      setBrowserUrl,
      currentBranch,
      gitDirtyCount,
      currentWorktreeLabel,
      setCurrentWorktreeLabel,
      workspaceTabs,
      activeWorkspaceTabId,
      setActiveWorkspaceTabId,
      openBrowserTab,
      openPreviewTab,
      closeWorkspaceTab,
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
    }),
    [fileTreeOpen, gitPanelOpen, previewOpen, terminalOpen, dashboardPanelOpen, assistantPanelOpen, isAssistantWorkspace, bottomPanelOpen, bottomPanelTab, mainViewMode, setMainViewMode, browserTabOpen, setBrowserTabOpen, browserUrl, workspaceTabs, activeWorkspaceTabId, setActiveWorkspaceTabId, openBrowserTab, openPreviewTab, closeWorkspaceTab, currentBranch, gitDirtyCount, currentWorktreeLabel, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, activeStreamingSessions, pendingApprovalSessionIds, previewFile, setPreviewFile, previewViewMode]
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
                          {activeWorkspaceTab.kind === "browser" ? (
                            <BrowserTabView
                              initialUrl={activeWorkspaceTab.url}
                              onMetaChange={(meta) => {
                                const nextUrl = meta.url?.trim() || activeWorkspaceTab.url || "";
                                if (nextUrl) setBrowserUrl(nextUrl);
                                syncBrowserContextMeta({
                                  ...(nextUrl ? { url: nextUrl } : {}),
                                  ...(meta.title?.trim() ? { title: meta.title.trim() } : {}),
                                });
                                updateWorkspaceTab(activeWorkspaceTab.id, {
                                  ...(nextUrl ? { url: nextUrl } : {}),
                                  ...(meta.title?.trim() ? { title: meta.title.trim() } : nextUrl ? { title: getBrowserTabTitle(nextUrl) } : {}),
                                });
                              }}
                            />
                          ) : activeWorkspaceTab.kind === "preview" && activeWorkspaceTab.filePath ? (
                            <PreviewPanel
                              standalone
                              filePath={activeWorkspaceTab.filePath}
                              onClose={() => closeWorkspaceTab(activeWorkspaceTab.id)}
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
                  {isChatDetailRoute && <BottomPanelContainer />}
                </div>
                {isChatDetailRoute && <PanelZone />}
              </div>
            </div>
          </div>
          <UpdateDialog />
          <FeatureAnnouncementDialog />
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
