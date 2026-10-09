"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  MagnifyingGlass,
  Globe,
  FileArrowDown,
  Plus,
  FolderPlus,
  Lightning,
  Stack,
  Terminal,
  Image,
  ShareNetwork,
  Gear,
  ListBullets,
  BookOpen,
  ClockCountdown,
  Shapes,
  PlugsConnected,
  SidebarSimple,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useSplit } from "@/hooks/useSplit";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { showToast } from '@/hooks/useToast';
// ConnectionStatus removed from header — CLI status now lives in Settings > Claude CLI
// ImportSessionDialog moved to Settings page
import { SessionListItem, SplitGroupSection } from "./SessionListItem";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { useAssistantWorkspace } from "@/hooks/useAssistantWorkspace";
import { AssistantPromoCard } from "@/components/chat/ChatEmptyState";
import {
  formatRelativeTime,
  groupSessionsByProject,
  loadCollapsedProjects,
  saveCollapsedProjects,
  loadUnreadCompletions,
  saveUnreadCompletions,
  COLLAPSED_INITIALIZED_KEY,
} from "./chat-list-utils";
import type { ChatSession } from "@/types";

interface ChatListPanelProps {
  open: boolean;
  width?: number;
  onToggle?: () => void;
}

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * 会话是否正在运行 —— 会话行（转圈 loading）与项目分组头部（收起时绿灯）
 * 共用同一判定，避免两处指示器出现不一致。
 */
function isSessionRunning(
  session: ChatSession,
  activeStreamingSessions: Set<string>,
  streamingSessionId: string
): boolean {
  return (
    activeStreamingSessions.has(session.id) ||
    streamingSessionId === session.id ||
    session.runtime_status === 'running'
  );
}

export function ChatListPanel({ open, width, onToggle }: ChatListPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    streamingSessionId,
    pendingApprovalSessionId,
    activeStreamingSessions,
    pendingApprovalSessionIds,
    workingDirectory,
    bottomPanelOpen,
    setBottomPanelOpen,
    bottomPanelTab,
    setBottomPanelTab,
    openBrowserTab,
    setBrowserPanelOpen,
    setFileTreeOpen,
    setGitPanelOpen,
    setDashboardPanelOpen,
  } = usePanel();
  const { splitSessions, isSplitActive, activeColumnId, addToSplit, removeFromSplit, setActiveColumn, isInSplit } = useSplit();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<Set<string>>(new Set());
  const SESSION_TRUNCATE_LIMIT = 5;
  // importDialogOpen removed — Import CLI moved to Settings
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => loadCollapsedProjects()
  );
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const { workspacePath } = useAssistantWorkspace();
  const [assistantSummary, setAssistantSummary] = useState<{
    name: string;
    memoryCount: number;
    lastHeartbeatDate: string;
    configured: boolean;
    buddy?: { emoji: string; buddyName?: string; species?: string };
  } | null>(null);
  const [promoDismissed, setPromoDismissed] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [globalContextMenuOpen, setGlobalContextMenuOpen] = useState(false);
  const [globalContextMenuPosition, setGlobalContextMenuPosition] = useState({ x: 0, y: 0 });
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  /** 中文注释：任务已完成、用户还没点进去看的会话 —— 行左侧显示蓝色指示灯。 */
  const [unreadCompletions, setUnreadCompletions] = useState<Set<string>>(
    () => loadUnreadCompletions()
  );
  /** 上一轮仍在运行的会话 id，用于识别「运行 → 结束」这一瞬间。 */
  const prevRunningSessionIdsRef = useRef<Set<string> | null>(null);

  // Reload assistant summary when sessions change (e.g. after onboarding/rename)
  useEffect(() => {
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => setAssistantSummary(data))
      .catch(() => {});
  }, [sessions.length]);

  // Poll for active scheduled tasks count
  useEffect(() => {
    const fetchActiveTasks = async () => {
      try {
        const res = await fetch('/api/tasks/list?status=active');
        if (res.ok) {
          const data = await res.json();
          setActiveTaskCount(data.tasks?.length || 0);
        }
      } catch { /* ignore */ }
    };
    
    fetchActiveTasks();
    const interval = setInterval(fetchActiveTasks, 15000);
    return () => clearInterval(interval);
  }, []);

  /** Read current model + provider_id from localStorage for new session creation */
  const getCurrentModelAndProvider = useCallback(() => {
    const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
    const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
    return { model, provider_id };
  }, []);

  const handleFolderSelect = useCallback(async (path: string) => {
    try {
      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: path, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast({
          type: 'error',
          message: errData.error || t('error.createSessionFailed' as TranslationKey) || 'Failed to create session',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({
        type: 'error',
        message: t('error.createSessionFailed' as TranslationKey) || `Failed to create session: ${msg}`,
      });
    }
  }, [router, getCurrentModelAndProvider, t]);

  const openFolderPicker = useCallback(async (defaultPath?: string) => {
    if (isElectron) {
      const path = await openNativePicker({ defaultPath, title: t('folderPicker.title') });
      if (path) handleFolderSelect(path);
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t, handleFolderSelect]);

  const handleNewChat = useCallback(async () => {
    let lastDir = workingDirectory
      || (typeof window !== 'undefined' ? localStorage.getItem("codepilot:last-working-directory") : null);

    // Fall back to setup default project if no recent directory
    if (!lastDir) {
      try {
        const setupRes = await fetch('/api/setup');
        if (setupRes.ok) {
          const setupData = await setupRes.json();
          if (setupData.defaultProject) {
            lastDir = setupData.defaultProject;
            localStorage.setItem('codepilot:last-working-directory', lastDir!);
          }
        }
      } catch { /* ignore */ }
    }

    if (!lastDir) {
      // No saved directory — let user pick one
      openFolderPicker();
      return;
    }

    // Validate the saved directory still exists
    setCreatingChat(true);
    try {
      const checkRes = await fetch(
        `/api/files/browse?dir=${encodeURIComponent(lastDir)}`
      );
      if (!checkRes.ok) {
        // Directory is gone — clear stale value, try setup default before prompting
        localStorage.removeItem("codepilot:last-working-directory");
        let recovered = false;
        try {
          const setupRes = await fetch('/api/setup');
          if (setupRes.ok) {
            const setupData = await setupRes.json();
            if (setupData.defaultProject && setupData.defaultProject !== lastDir) {
              const defaultCheck = await fetch(`/api/files/browse?dir=${encodeURIComponent(setupData.defaultProject)}`);
              if (defaultCheck.ok) {
                lastDir = setupData.defaultProject;
                localStorage.setItem('codepilot:last-working-directory', lastDir!);
                recovered = true;
              }
            }
          }
        } catch { /* ignore */ }
        if (!recovered) {
          showToast({
            type: 'warning',
            message: t('error.directoryInvalid'),
            action: { label: t('error.selectDirectory'), onClick: () => openFolderPicker() },
          });
          openFolderPicker();
          return;
        }
      }

      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: lastDir, model, provider_id }),
      });
      if (!res.ok) {
        // Backend rejected it (e.g. INVALID_DIRECTORY) — prompt user
        localStorage.removeItem("codepilot:last-working-directory");
        openFolderPicker();
        return;
      }
      const data = await res.json();
      router.push(`/chat/${data.session.id}`);
      window.dispatchEvent(new CustomEvent("session-created"));
    } catch {
      openFolderPicker();
    } finally {
      setCreatingChat(false);
    }
  }, [router, workingDirectory, openFolderPicker, getCurrentModelAndProvider, t]);

  const toggleProject = useCallback((wd: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(wd)) next.delete(wd);
      else next.add(wd);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  // AbortController ref for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSessions = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat/sessions", { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (e) {
      // Ignore abort errors; log others
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }, []);

  const debouncedFetchSessions = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSessions();
    }, 300);
  }, [fetchSessions]);

  // Fetch on mount
  useEffect(() => {
    fetchSessions();
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchSessions]);

  // Refresh session list when a session is created or updated (debounced)
  useEffect(() => {
    const handler = () => debouncedFetchSessions();
    window.addEventListener("session-created", handler);
    window.addEventListener("session-updated", handler);
    return () => {
      window.removeEventListener("session-created", handler);
      window.removeEventListener("session-updated", handler);
    };
  }, [debouncedFetchSessions]);

  // Periodic poll to catch sessions created server-side (e.g. bridge)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSessions();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  /** 中文注释：当前正在查看的会话 id（从 /chat/{id} 解析，忽略查询串）。 */
  const activeSessionId = pathname?.startsWith('/chat/')
    ? pathname.split('/chat/')[1]?.split('?')[0] ?? ''
    : '';

  // 中文注释：任务完成提示 —— 某会话从「运行中」变为「已结束」、且用户不在该会话时，
  // 记入未读集合并点亮行左侧的蓝色指示灯；进入该会话后由下面的 effect 清除。
  useEffect(() => {
    const runningIds = new Set(
      sessions
        .filter((s) => isSessionRunning(s, activeStreamingSessions, streamingSessionId))
        .map((s) => s.id)
    );
    const prevRunning = prevRunningSessionIdsRef.current;
    prevRunningSessionIdsRef.current = runningIds;
    // 首帧只建立基线，避免把历史会话误标成「刚完成」
    if (!prevRunning) return;

    const justFinished = [...prevRunning].filter(
      (id) => !runningIds.has(id) && id !== activeSessionId
    );
    if (justFinished.length === 0) return;

    setUnreadCompletions((prev) => {
      const next = new Set(prev);
      justFinished.forEach((id) => next.add(id));
      saveUnreadCompletions(next);
      return next;
    });
  }, [sessions, activeStreamingSessions, streamingSessionId, activeSessionId]);

  // 中文注释：进入会话即视为已查看，抹掉蓝点。
  useEffect(() => {
    if (!activeSessionId) return;
    setUnreadCompletions((prev) => {
      if (!prev.has(activeSessionId)) return prev;
      const next = new Set(prev);
      next.delete(activeSessionId);
      saveUnreadCompletions(next);
      return next;
    });
  }, [activeSessionId]);

  // 中文注释：会话被删除后清掉残留的未读标记，避免集合无限增长。
  useEffect(() => {
    if (sessions.length === 0) return;
    const existingIds = new Set(sessions.map((s) => s.id));
    setUnreadCompletions((prev) => {
      const stale = [...prev].filter((id) => !existingIds.has(id));
      if (stale.length === 0) return prev;
      const next = new Set(prev);
      stale.forEach((id) => next.delete(id));
      saveUnreadCompletions(next);
      return next;
    });
  }, [sessions]);

  // 中文注释：监听侧边栏快捷按钮触发的新建会话事件
  useEffect(() => {
    const handler = () => handleNewChat();
    window.addEventListener('chatlist-new-chat', handler);
    return () => window.removeEventListener('chatlist-new-chat', handler);
  }, [handleNewChat]);

  // Global context menu for empty space
  const handleGlobalContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGlobalContextMenuPosition({ x: e.clientX, y: e.clientY });
    setGlobalContextMenuOpen(true);
  };

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('chatList.confirmDelete' as TranslationKey))) return;
    setDeletingSession(sessionId);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        // Remove from split if it's there
        if (isInSplit(sessionId)) {
          removeFromSplit(sessionId);
        }
        if (pathname === `/chat/${sessionId}`) {
          router.push("/chat");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast({
          type: 'error',
          message: errData.error || t('error.deleteSessionFailed' as TranslationKey) || 'Failed to delete session',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({
        type: 'error',
        message: t('error.deleteSessionFailed' as TranslationKey) || `Failed to delete session: ${msg}`,
      });
    } finally {
      setDeletingSession(null);
    }
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
        );
        window.dispatchEvent(new CustomEvent("session-updated"));
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast({
          type: 'error',
          message: errData.error || t('error.renameSessionFailed' as TranslationKey) || 'Failed to rename session',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({
        type: 'error',
        message: t('error.renameSessionFailed' as TranslationKey) || `Failed to rename session: ${msg}`,
      });
    }
  };

  const handleRemoveProject = async (workingDirectory: string) => {
    const projectName = workingDirectory.split('/').pop() || workingDirectory;
    if (!confirm(t('chatList.confirmRemoveProject' as TranslationKey, { projectName }))) return;
    const projectSessions = sessions.filter((s) => s.working_directory === workingDirectory);
    const deletedIds = new Set<string>();
    let failedCount = 0;
    for (const session of projectSessions) {
      try {
        const res = await fetch(`/api/chat/sessions/${session.id}`, { method: "DELETE" });
        if (res.ok) {
          deletedIds.add(session.id);
          if (isInSplit(session.id)) {
            removeFromSplit(session.id);
          }
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    }
    if (failedCount > 0) {
      showToast({
        type: 'error',
        message: t('error.deleteSessionFailed' as TranslationKey) || `Failed to delete ${failedCount} session(s)`,
      });
    }
    // Only remove sessions that were successfully deleted from backend
    if (deletedIds.size > 0) {
      setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
      if (pathname?.startsWith('/chat/')) {
        const currentSessionId = pathname.split('/chat/')[1];
        if (deletedIds.has(currentSessionId)) {
          router.push("/chat");
        }
      }
    }
  };

  const handleCreateSessionInProject = async (
    e: React.MouseEvent,
    workingDirectory: string
  ) => {
    e.stopPropagation();
    try {
      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: workingDirectory, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast({
          type: 'error',
          message: errData.error || t('error.createSessionFailed' as TranslationKey) || 'Failed to create session',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({
        type: 'error',
        message: t('error.createSessionFailed' as TranslationKey) || `Failed to create session: ${msg}`,
      });
    }
  };

  const handleToggleSessionSelection = (sessionId: string) => {
    setSelectedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
        if (next.size === 0) {
          setIsSelectionMode(false);
        }
      } else {
        next.add(sessionId);
        setIsSelectionMode(true);
      }
      return next;
    });
  };

  const handleToggleProjectSelection = (workingDirectory: string) => {
    const projectSessions = sessions.filter((s) => s.working_directory === workingDirectory);
    setSelectedSessions((prev) => {
      const next = new Set(prev);
      const allSelected = projectSessions.every((s) => next.has(s.id));
      
      projectSessions.forEach((session) => {
        if (allSelected) {
          next.delete(session.id);
        } else {
          next.add(session.id);
        }
      });
      
      if (next.size === 0) {
        setIsSelectionMode(false);
      } else {
        setIsSelectionMode(true);
      }
      
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedSessions(new Set());
    setIsSelectionMode(false);
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) return;
    if (!confirm(t('chatList.confirmDeleteMultiple' as TranslationKey, { count: selectedSessions.size }))) return;
    
    const deletedIds = new Set<string>();
    let failedCount = 0;
    
    for (const sessionId of selectedSessions) {
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
        if (res.ok) {
          deletedIds.add(sessionId);
          if (isInSplit(sessionId)) {
            removeFromSplit(sessionId);
          }
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    }
    
    if (failedCount > 0) {
      showToast({
        type: 'error',
        message: t('error.deleteSessionFailed' as TranslationKey) || `Failed to delete ${failedCount} session(s)`,
      });
    }
    
    if (deletedIds.size > 0) {
      setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
      setSelectedSessions((prev) => {
        const next = new Set(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      
      if (selectedSessions.size === deletedIds.size) {
        setIsSelectionMode(false);
      }
      
      if (pathname?.startsWith('/chat/')) {
        const currentSessionId = pathname.split('/chat/')[1];
        if (deletedIds.has(currentSessionId)) {
          router.push("/chat");
        }
      }
    }
  };

  const splitSessionIds = useMemo(
    () => new Set(splitSessions.map((s) => s.sessionId)),
    [splitSessions]
  );

  const filteredSessions = useMemo(() => {
    // Exclude sessions in split group (they are shown in the split section)
    if (isSplitActive) {
      return sessions.filter((s) => !splitSessionIds.has(s.id));
    }
    return sessions;
  }, [sessions, isSplitActive, splitSessionIds]);

  // Handle select all sessions
  const handleSelectAllSessions = () => {
    const allSessionIds = new Set(filteredSessions.map((s) => s.id));
    setSelectedSessions(allSessionIds);
    setIsSelectionMode(true);
  };

  // Listen for context menu events
  useEffect(() => {
    const handleSelectAll = () => {
      const allSessionIds = new Set(filteredSessions.map((s) => s.id));
      setSelectedSessions(allSessionIds);
      setIsSelectionMode(true);
    };
    
    const handleDeleteSelected = () => {
      handleBulkDelete();
    };
    
    const handleCancelSelection = () => {
      handleClearSelection();
    };
    
    window.addEventListener('select-all-sessions', handleSelectAll);
    window.addEventListener('delete-selected-sessions', handleDeleteSelected);
    window.addEventListener('cancel-selection', handleCancelSelection);
    return () => {
      window.removeEventListener('select-all-sessions', handleSelectAll);
      window.removeEventListener('delete-selected-sessions', handleDeleteSelected);
      window.removeEventListener('cancel-selection', handleCancelSelection);
    };
  }, [filteredSessions, setSelectedSessions, setIsSelectionMode, handleBulkDelete, handleClearSelection]);

  const projectGroups = useMemo(() => {
    const groups = groupSessionsByProject(filteredSessions);
    // Pin assistant workspace project to top
    if (workspacePath) {
      const wsIdx = groups.findIndex(g => g.workingDirectory === workspacePath);
      if (wsIdx > 0) {
        const [wsGroup] = groups.splice(wsIdx, 1);
        groups.unshift(wsGroup);
      }
    }
    return groups;
  }, [filteredSessions, workspacePath]);

  // Auto-collapse: only expand the project with the most recent session activity.
  // Runs on first use AND whenever the project list changes (new projects added).
  useEffect(() => {
    if (projectGroups.length <= 1) return;
    // Find the project with the latest session (highest latestUpdatedAt), ignoring pin order
    const sorted = [...projectGroups].sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
    const mostRecentWd = sorted[0]?.workingDirectory;
    const toCollapse = new Set(
      projectGroups
        .filter(g => g.workingDirectory !== mostRecentWd)
        .map(g => g.workingDirectory)
    );
    // Only update if collapsed set actually changed (avoid infinite loop)
    const currentKeys = [...collapsedProjects].sort().join(',');
    const newKeys = [...toCollapse].sort().join(',');
    // v2: re-initialize with improved logic (pin-aware)
    const initKey = COLLAPSED_INITIALIZED_KEY + '-v2';
    if (currentKeys !== newKeys && !localStorage.getItem(initKey)) {
      setCollapsedProjects(toCollapse);
      saveCollapsedProjects(toCollapse);
      localStorage.setItem(initKey, "1");
    }
  }, [projectGroups, collapsedProjects]);

  const navItems = [
    { href: "/skills", label: t('nav.skills' as TranslationKey), icon: Lightning },
    { href: "/mcp", label: t('nav.mcp' as TranslationKey), icon: Stack },
    { href: "/cli-tools", label: t('nav.cliTools' as TranslationKey), icon: Terminal },
    { href: "/gallery", label: t('nav.gallery' as TranslationKey), icon: Shapes },
    { href: "/knowledge-base", label: t('nav.knowledgeBase' as TranslationKey), icon: BookOpen },
    { href: "/scheduled-tasks", label: t('nav.scheduledTasks' as TranslationKey), icon: ClockCountdown },
    { href: "/bridge", label: t('nav.bridge' as TranslationKey), icon: PlugsConnected },
  ];

  return (
    <aside
      /* 中文注释：移植 cc-haha 侧边栏 —— 停靠式 + 折叠为 72px 图标栏（rail）。
         .sidebar-panel 按 data-state 在 270px / 72px 间做 280ms 缓动过渡（globals.css），
         不再整块卸载（原 if (!open) return null 已移除）。 */
      className="sidebar-panel relative z-30 flex h-full shrink-0 flex-col overflow-hidden bg-[var(--surface-sidebar)] select-none"
      data-state={open ? 'open' : 'closed'}
      onContextMenu={handleGlobalContextMenu}
    >
      {/* 中文注释：顶部区域对齐 cc-haha —— 展开态：右对齐的收起按钮 + logo；
          rail 态：竖向图标列（收起/展开 + 搜索），logo 隐藏。 */}
      <div className={`relative shrink-0 pb-1.5 ${open ? 'pt-2.5 px-3' : 'pt-9 px-0'}`} data-electron-drag-region>
        <div className={`flex items-center mb-1.5 ${open ? 'gap-0.5 justify-end' : 'flex-col items-center gap-1'}`}>
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              title={open ? '收起侧边栏' : '展开侧边栏'}
              className={`flex items-center justify-center transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] ${
                open ? 'h-6 w-6 rounded' : 'h-[34px] w-[34px] rounded-lg'
              }`}
            >
              <SidebarSimple size={open ? 15 : 16} />
            </button>
          )}
          {!open && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
              title={t('chatList.searchSessions')}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <MagnifyingGlass size={16} />
            </button>
          )}
        </div>
        {open && (
          <div className="mt-1.5 flex items-center justify-center">
            <img src="/icons/toplogo.png" alt="HueyingAgent" className="h-9 w-auto object-contain" />
          </div>
        )}
      </div>

      {/* Top action bar: New Chat + Search（rail 态：竖向图标，搜索移到顶部图标列） */}
      {open ? (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 justify-center gap-1.5 h-8 text-xs"
            disabled={creatingChat}
            onClick={handleNewChat}
          >
            <Plus size={14} />
            {t('chatList.newConversation')}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
            title={t('chatList.searchSessions')}
          >
            <MagnifyingGlass size={14} />
            <span className="sr-only">{t('chatList.searchSessions')}</span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              // 中文注释：与右侧面板工具栏一致 —— 浏览器在右侧面板内打开，不顶掉聊天页
              setFileTreeOpen(false);
              setGitPanelOpen(false);
              setDashboardPanelOpen(false);
              setBrowserPanelOpen(true);
            }}
            title="内置浏览器"
          >
            <Globe size={14} />
            <span className="sr-only">内置浏览器</span>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 px-0 pb-2">
          <button
            type="button"
            disabled={creatingChat}
            onClick={handleNewChat}
            title={t('chatList.newConversation')}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setFileTreeOpen(false);
              setGitPanelOpen(false);
              setDashboardPanelOpen(false);
              setBrowserPanelOpen(true);
            }}
            title="内置浏览器"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <Globe size={16} />
          </button>
        </div>
      )}

      {/* Feature nav items（rail 态：图标居中、label 淡出、徽标隐藏，对齐 cc-haha NavItem） */}
      <div className={`pb-2 ${open ? 'px-3' : 'px-3 flex flex-col items-center'}`}>
        <div className={`flex flex-col ${open ? 'gap-0.5 w-full' : 'gap-1 items-center'}`}>
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} title={!open ? item.label : undefined} className={open ? 'w-full' : ''}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`${open ? 'w-full justify-start gap-2 h-8' : 'justify-center h-9 w-9 px-0 gap-0'} text-xs relative ${
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <item.icon size={open ? 14 : 16} weight={isActive ? "fill" : "regular"} />
                  <span className={`sidebar-copy text-left ${open ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'}`}>{item.label}</span>
                  {open && item.href === "/scheduled-tasks" && activeTaskCount > 0 && (
                    <span className="absolute right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm">
                      {activeTaskCount > 99 ? '99+' : activeTaskCount}
                    </span>
                  )}
                </Button>
              </Link>
            );
          })}
        </div>
      </div>

      {open ? (
        <>
      {/* Separator */}
      <div className="mx-3 border-t border-border/40" />

      {/* Section title */}
      <div className="flex items-center justify-between px-5 pt-2 pb-1.5 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('chatList.threads')}
        </span>
        <div className="flex items-center gap-1">
          {selectedSessions.size > 0 && (
            <span className="text-[11px] font-medium text-muted-foreground/60">
              {selectedSessions.size} {t('chatList.selected')}
            </span>
          )}
          {isSelectionMode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground"
              onClick={handleClearSelection}
            >
              {t('chatList.cancelModification' as TranslationKey)}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground"
            onClick={() => openFolderPicker()}
          >
            <FolderPlus size={12} />
            {t('chatList.addProjectFolder')}
          </Button>
        </div>
      </div>

      {/* Session list grouped by project */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-3"
        onContextMenu={handleGlobalContextMenu}
      >
        <div className="flex flex-col pb-3">

          {/* Split group section */}
          {isSplitActive && (
            <SplitGroupSection
              splitSessions={splitSessions}
              activeColumnId={activeColumnId}
              streamingSessionId={streamingSessionId}
              pendingApprovalSessionId={pendingApprovalSessionId}
              activeStreamingSessions={activeStreamingSessions}
              pendingApprovalSessionIds={pendingApprovalSessionIds}
              t={t}
              setActiveColumn={setActiveColumn}
              removeFromSplit={removeFromSplit}
            />
          )}

          {/* Assistant promo card for unconfigured users */}
          {assistantSummary && !assistantSummary.configured && !promoDismissed && (
            <AssistantPromoCard
              onSetup={() => router.push('/settings#assistant')}
              onDismiss={() => setPromoDismissed(true)}
            />
          )}

          {filteredSessions.length === 0 && (!isSplitActive || splitSessions.length === 0) ? (
            <p className="px-2.5 py-3 text-[11px] text-muted-foreground/60">
              {t('chatList.noSessions')}
            </p>
          ) : (
            projectGroups.map((group) => {
              const isCollapsed =
                collapsedProjects.has(group.workingDirectory);
              const isFolderHovered =
                hoveredFolder === group.workingDirectory;

              const isSessionsExpanded = expandedSessionGroups.has(group.workingDirectory);
              const shouldTruncate = group.sessions.length > SESSION_TRUNCATE_LIMIT;
              let visibleSessions = group.sessions;
              if (shouldTruncate && !isSessionsExpanded) {
                const truncated = group.sessions.slice(0, SESSION_TRUNCATE_LIMIT);
                // Ensure the active session is always visible even when truncated
                const activeSession = group.sessions.find(s => pathname === `/chat/${s.id}`);
                if (activeSession && !truncated.includes(activeSession)) {
                  truncated.push(activeSession);
                }
                visibleSessions = truncated;
              }
              const hiddenCount = group.sessions.length - visibleSessions.length;

              const groupIsWorkspace = !!(workspacePath && group.workingDirectory === workspacePath);
              // 收起该文件夹时，右侧要显示"有任务在跑"的闪烁绿灯
              const hasRunningSession = group.sessions.some((s) =>
                isSessionRunning(s, activeStreamingSessions, streamingSessionId)
              );
              const hasUnreadCompletion = group.sessions.some((s) => unreadCompletions.has(s.id));

              return (
                <div key={group.workingDirectory || "__no_project"} className="mt-1 first:mt-0">
                  {/* Folder header */}
                  <ProjectGroupHeader
                    workingDirectory={group.workingDirectory}
                    displayName={group.displayName}
                    isCollapsed={isCollapsed}
                    isFolderHovered={isFolderHovered}
                    isWorkspace={groupIsWorkspace}
                    hasRunningSession={hasRunningSession}
                    hasUnreadCompletion={hasUnreadCompletion}
                    onToggle={() => toggleProject(group.workingDirectory)}
                    onMouseEnter={() => setHoveredFolder(group.workingDirectory)}
                    onMouseLeave={() => setHoveredFolder(null)}
                    onCreateSession={(e) => handleCreateSessionInProject(e, group.workingDirectory)}
                    onRemoveProject={handleRemoveProject}
                    onToggleProjectSelection={handleToggleProjectSelection}
                    assistantName={assistantSummary?.name}
                    assistantMemoryCount={assistantSummary?.memoryCount}
                    lastHeartbeatDate={assistantSummary?.lastHeartbeatDate}
                    buddyEmoji={assistantSummary?.buddy?.emoji}
                    buddyName={assistantSummary?.buddy?.buddyName}
                    buddySpecies={assistantSummary?.buddy?.species}
                  />

                  {/* Session items with animated collapse */}
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {visibleSessions.map((session) => {
                            const isActive = pathname === `/chat/${session.id}`;
                            const canSplit = !isActive && !isInSplit(session.id);

                            return (
                              <SessionListItem
                                key={session.id}
                                session={session}
                                isActive={isActive}
                                isHovered={hoveredSession === session.id}
                                isDeleting={deletingSession === session.id}
                                isSessionStreaming={isSessionRunning(session, activeStreamingSessions, streamingSessionId)}
                                needsApproval={pendingApprovalSessionIds.has(session.id) || pendingApprovalSessionId === session.id}
                                hasUnreadCompletion={unreadCompletions.has(session.id)}
                                canSplit={canSplit}
                                isWorkspace={groupIsWorkspace}
                                isSelected={selectedSessions.has(session.id)}
                                isSelectionMode={isSelectionMode}
                                formatRelativeTime={formatRelativeTime}
                                t={t}
                                onMouseEnter={() => setHoveredSession(session.id)}
                                onMouseLeave={() => setHoveredSession(null)}
                                onDelete={handleDeleteSession}
                                onRename={handleRenameSession}
                                onAddToSplit={(s) => addToSplit({
                                  sessionId: s.id,
                                  title: s.title,
                                  workingDirectory: s.working_directory || "",
                                  projectName: s.project_name || "",
                                  mode: s.mode,
                                })}
                                onToggleSelection={handleToggleSessionSelection}
                              />
                            );
                          })}

                          {/* Show more / Show less toggle */}
                          {shouldTruncate && (
                            <button
                              onClick={() => setExpandedSessionGroups(prev => {
                                const next = new Set(prev);
                                if (next.has(group.workingDirectory)) {
                                  next.delete(group.workingDirectory);
                                } else {
                                  next.add(group.workingDirectory);
                                }
                                return next;
                              })}
                              className="w-full py-1.5 text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                            >
                              {isSessionsExpanded
                                ? t('chatList.showLess' as TranslationKey)
                                : t('chatList.showMore' as TranslationKey, { count: String(hiddenCount) })
                              }
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>
        </>
      ) : (
        /* 中文注释：rail 态隐藏项目/会话列表（cc-haha：折叠时用占位撑开，只留图标入口） */
        <div className="flex-1" aria-hidden="true" />
      )}

      {/* Global Context Menu */}
      <DropdownMenu open={globalContextMenuOpen} onOpenChange={setGlobalContextMenuOpen}>
        <DropdownMenuTrigger asChild>
          <div 
            className="fixed top-0 left-0 w-1 h-1 opacity-0"
            style={{ top: globalContextMenuPosition.y, left: globalContextMenuPosition.x }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem onClick={() => {
            setGlobalContextMenuOpen(false);
            handleSelectAllSessions();
          }}>
            <span>全选会话</span>
          </DropdownMenuItem>
          {isSelectionMode && (
            <>
              <DropdownMenuItem onClick={() => {
                setGlobalContextMenuOpen(false);
                handleClearSelection();
              }}>
                <span>放弃修改</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => {
                setGlobalContextMenuOpen(false);
                handleBulkDelete();
              }}>
                <span>删除所选会话</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Bottom: Settings */}
      <div className={`shrink-0 px-3 py-2 ${open ? '' : 'flex justify-center'}`}>
        <Link href="/settings" title={!open ? t('nav.settings' as TranslationKey) : undefined}>
          <Button
            variant="ghost"
            size="sm"
            className={`${open ? 'w-full justify-start gap-2 h-8' : 'justify-center h-9 w-9 px-0 gap-0'} text-xs ${
              pathname.startsWith("/settings")
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gear size={open ? 14 : 16} weight={pathname.startsWith("/settings") ? "fill" : "regular"} />
            <span className={`sidebar-copy text-left ${open ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'}`}>{t('nav.settings' as TranslationKey)}</span>
          </Button>
        </Link>
      </div>

      {/* Folder Picker Dialog */}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderSelect}
      />

    </aside>
  );
}
