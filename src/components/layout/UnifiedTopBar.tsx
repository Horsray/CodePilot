"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  GitBranch,
  TreeStructure,
  Copy,
  FileCode,
  PencilSimple,
  DotOutline,
  ChartBar,
  X,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useClientPlatform } from '@/hooks/useClientPlatform';
import { showToast } from '@/hooks/useToast';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, type Species } from '@/lib/buddy';

export function UnifiedTopBar() {
  const {
    sessionTitle,
    setSessionTitle,
    sessionId,
    workingDirectory,
    fileTreeOpen,
    setFileTreeOpen,
    gitPanelOpen,
    setGitPanelOpen,
    dashboardPanelOpen,
    setDashboardPanelOpen,
    isAssistantWorkspace,
    workspaceTabs,
    activeWorkspaceTabId,
    setActiveWorkspaceTabId,
    closeWorkspaceTab,
    currentBranch,
    gitDirtyCount,
  } = usePanel();
  const { t } = useTranslation();
  const { isWindows } = useClientPlatform();
  const [buddySpecies, setBuddySpecies] = useState('');

  useEffect(() => {
    if (!isAssistantWorkspace) return;
    let cancelled = false;
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) { setBuddySpecies(data?.buddy?.species || ''); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAssistantWorkspace]);
  const pathname = usePathname();

  // 中文注释：功能名称「聊天详情顶栏显示判定」。
  // 用法：沿用官方仅在真正聊天详情页显示顶栏的交互，同时保留当前分支在工作区标签页打开时仍需显示顶栏的能力。
  const isChatRoute = pathname.startsWith("/chat/") || workspaceTabs.length > 0;

  // --- Title editing ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditTitle = useCallback(() => {
    setEditTitle(sessionTitle || t('chat.newConversation'));
    setIsEditingTitle(true);
  }, [sessionTitle, t]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setSessionTitle(trimmed);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId, title: trimmed } }));
      }
    } catch {
      showToast({ type: 'error', message: t('error.titleSaveFailed') });
    }
    setIsEditingTitle(false);
  }, [editTitle, sessionId, setSessionTitle, t]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  }, [handleSaveTitle]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Extract project name from working directory
  const projectName = workingDirectory ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || '' : '';

  // On non-chat routes, render only a thin drag region (no visible bar)
  if (!isChatRoute) {
    // Thin drag region for macOS window dragging — just enough for traffic light area
    return (
      <div
        className="h-3 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
    );
  }

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 bg-background px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: project + current chat tab */}
        <div
          className="flex items-center gap-1.5 min-w-0 shrink"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && projectName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground/60 shrink-0 hover:text-foreground transition-colors h-auto p-0"
                  onClick={() => {
                    if (workingDirectory) {
                      if (window.electronAPI?.shell?.openPath) {
                        window.electronAPI.shell.openPath(workingDirectory);
                      } else {
                        fetch('/api/files/open', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: workingDirectory }),
                        }).catch(() => {});
                      }
                    }
                  }}
                >
                  {projectName}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs break-all">{workingDirectory}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {isChatRoute && projectName && sessionTitle && (
            <span className="text-xs text-muted-foreground/60 shrink-0">/</span>
          )}

          {sessionTitle && (
            isEditingTitle ? (
              <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  className="h-8 text-sm max-w-[220px]"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <Button
                  variant={activeWorkspaceTabId === null ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setActiveWorkspaceTabId(null)}
                  className="h-8 max-w-[220px] gap-1.5 rounded-2xl px-3 text-sm"
                >
                  <span className="truncate">{sessionTitle}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStartEditTitle}
                  className="shrink-0 h-auto w-auto p-0.5"
                >
                  <PencilSimple size={12} className="text-muted-foreground" />
                </Button>
              </div>
            )
          )}
        </div>

        <div
          className="flex min-w-0 flex-1 items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide pr-2">
            {workspaceTabs.map((tab) => {
              const isActive = activeWorkspaceTabId === tab.id;
              const isPreviewTab = tab.kind === "preview";

              return (
                <div
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  onClick={() => setActiveWorkspaceTabId(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveWorkspaceTabId(tab.id);
                    }
                  }}
                  className={`group flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md border px-3 text-xs transition-colors ${
                    isActive
                      ? "border-border bg-blue-500/20 text-blue-600 dark:text-blue-400"
                      : "border-transparent bg-muted/30 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {isPreviewTab ? (
                    <FileCode size={13} className="shrink-0" />
                  ) : (
                    <PencilSimple size={13} className="shrink-0" />
                  )}
                  <span className="max-w-[180px] truncate">{tab.title}</span>
                  {tab.closable && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeWorkspaceTab(tab.id);
                      }}
                      className="h-4 w-4 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                    >
                      <X size={10} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: action buttons */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={gitPanelOpen ? "secondary" : "ghost"}
                    size="sm"
                    className={`h-7 gap-1 px-1.5 ${gitPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setGitPanelOpen(!gitPanelOpen)}
                  >
                    <GitBranch size={16} />
                    {currentBranch && (
                      <span className="text-xs max-w-[100px] truncate">{currentBranch}</span>
                    )}
                    {gitDirtyCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                        <DotOutline size={10} weight="fill" />
                        {gitDirtyCount}
                      </span>
                    )}
                    <span className="sr-only">{t('topBar.git')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.git')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fileTreeOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={fileTreeOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setFileTreeOpen(!fileTreeOpen)}
                  >
                    <Folder size={16} weight={fileTreeOpen ? "fill" : "regular"} />
                    <span className="sr-only">{t('topBar.fileTree')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.fileTree')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={dashboardPanelOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={dashboardPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setDashboardPanelOpen(!dashboardPanelOpen)}
                  >
                    {isAssistantWorkspace
                      ? <img
                          src={buddySpecies ? (SPECIES_IMAGE_URL[buddySpecies as Species] || '') : EGG_IMAGE_URL}
                          alt="" width={16} height={16} className="rounded-sm"
                        />
                      : <ChartBar size={16} />}
                    <span className="sr-only">{t('topBar.dashboard')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isAssistantWorkspace ? 'Assistant' : t('topBar.dashboard')}
                </TooltipContent>
              </Tooltip>
            </>
          )}
          {isWindows && <div style={{ width: 138 }} className="shrink-0" />}
        </div>
      </div>
    </>
  );
}
