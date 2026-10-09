"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Trash,
  Bell,
  Columns,
  X,
  DotsThree,
  Copy,
  PencilSimple,
  PushPin,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/types";
import type { TranslationKey } from "@/i18n";

interface SessionListItemProps {
  session: ChatSession;
  isActive: boolean;
  isHovered: boolean;
  isDeleting: boolean;
  isSessionStreaming: boolean;
  needsApproval: boolean;
  /** 任务已完成、用户尚未查看 —— 行左侧显示蓝色指示灯，进入会话后消失 */
  hasUnreadCompletion?: boolean;
  canSplit: boolean;
  /** Whether this session belongs to the assistant workspace */
  isWorkspace?: boolean;
  /** Whether the session is selected in batch mode */
  isSelected?: boolean;
  /** Whether batch selection mode is active */
  isSelectionMode?: boolean;
  /** 中文注释：是否已收藏（固定在顶部「收藏会话」模块中）—— 图钉常驻高亮，时间戳让位。 */
  isPinned?: boolean;
  formatRelativeTime: (dateStr: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDelete: (e: React.MouseEvent, sessionId: string) => void;
  onRename: (sessionId: string, newTitle: string) => void;
  onAddToSplit: (session: ChatSession) => void;
  onToggleSelection?: (sessionId: string) => void;
  /** 中文注释：切换收藏状态（点击行右侧图钉按钮）——不传则不渲染图钉按钮。 */
  onTogglePin?: (e: React.MouseEvent, sessionId: string) => void;
}

export function SessionListItem({
  session,
  isActive,
  isHovered,
  isDeleting,
  isSessionStreaming,
  needsApproval,
  hasUnreadCompletion = false,
  canSplit,
  isWorkspace,
  isSelected = false,
  isSelectionMode = false,
  isPinned = false,
  formatRelativeTime,
  t,
  onMouseEnter,
  onMouseLeave,
  onDelete,
  onRename,
  onAddToSplit,
  onToggleSelection,
  onTogglePin,
}: SessionListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const showActions = isHovered || menuOpen || isDeleting;
  /** 中文注释：已收藏且不在运行时，图钉常驻显示（运行中转圈占位优先，hover 时图钉仍可操作）。 */
  const showPinnedPin = isPinned && !isSessionStreaming;
  const showPin = showPinnedPin || showActions;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  };



  return (
    <div
      className="group relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <div
        className={cn(
          "animate-list-item-enter flex items-center gap-1.5 rounded-md pl-2 pr-2 py-1.5 transition-all duration-150 min-w-0",
          isWorkspace
            ? isActive
              ? "bg-primary/[0.12] text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-primary/[0.06]"
            : isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-accent/50"
        )}
      >
        {/* Checkbox for batch selection */}
        {isSelectionMode && onToggleSelection && (
          <button
            className={cn(
              "shrink-0 h-4 w-4 rounded border border-border flex items-center justify-center transition-colors",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelection(session.id);
            }}
          >
            {isSelected && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )}
        {/* Link to chat */}
        <Link
          href={`/chat/${session.id}`}
          className="flex-1 flex items-center gap-1.5 min-w-0"
          onClick={(e) => {
            if (isSelectionMode && onToggleSelection) {
              e.preventDefault();
              onToggleSelection(session.id);
            }
          }}
        >
          {/* Left icon area — approval / completion indicator.
              运行中状态改到行右侧显示转圈（对齐 cc-haha 的 SessionItem）；
              此处保留待批准铃铛，以及「任务已完成但未查看」的蓝色指示灯。 */}
          <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {needsApproval && !isSessionStreaming ? (
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-status-warning-muted">
                <Bell size={10} className="text-status-warning-foreground" />
              </span>
            ) : hasUnreadCompletion ? (
              <span
                className="h-2 w-2 rounded-full bg-status-info shadow-[0_0_5px_var(--status-info)]"
                title={t('session.completedUnread' as TranslationKey)}
                aria-label={t('session.completedUnread' as TranslationKey)}
              />
            ) : null}
          </span>
        {/* Title — flex-1 + truncate ensures it shrinks */}
        <span className="flex-1 min-w-0 line-clamp-1 text-[13px] font-medium leading-tight break-all">
          {session.title}
        </span>
      </Link>
        {/* Right area — fixed width, spinner / time or dots swap via opacity */}
        <span className="shrink-0 w-[38px] flex items-center justify-end">
          {isSessionStreaming ? (
            /* 任务进行中：替换时间戳显示转圈（对齐 cc-haha：1.35s 线性旋转的 180° 弧） */
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center transition-opacity",
                showActions ? "opacity-0" : "opacity-100"
              )}
              aria-label={t('session.running' as TranslationKey)}
              title={t('session.running' as TranslationKey)}
            >
              <span className="h-[14px] w-[14px] animate-[spin_1.35s_linear_infinite] rounded-full border-[1.5px] border-muted-foreground/35 border-t-muted-foreground border-r-muted-foreground" />
            </span>
          ) : (
            <span className={cn(
              "text-[11px] text-muted-foreground/40 truncate transition-opacity",
              (showActions || showPinnedPin) ? "opacity-0" : "opacity-100"
            )}>
              {formatRelativeTime(session.updated_at, t)}
            </span>
          )}
        </span>
      </div>
      {/* Pin button — 已收藏常驻（高亮），未收藏 hover 显示；位于三点菜单左侧 */}
      {onTogglePin && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-[26px] top-1/2 -translate-y-1/2 z-10 flex items-center justify-center transition-opacity h-5 w-5 p-0",
            isPinned
              ? "text-primary hover:text-primary"
              : "text-muted-foreground/60 hover:text-foreground",
            showPin ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          title={isPinned ? t('chatList.unpinSession' as TranslationKey) : t('chatList.pinSession' as TranslationKey)}
          aria-label={isPinned ? t('chatList.unpinSession' as TranslationKey) : t('chatList.pinSession' as TranslationKey)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTogglePin(e, session.id);
          }}
        >
          <PushPin size={14} weight={isPinned ? "fill" : "regular"} />
        </Button>
      )}
      {/* Three-dot menu — absolute over the right area */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-opacity h-5 w-5 p-0",
              showActions ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DotsThree size={16} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuItem
            disabled={isActive || !canSplit}
            onClick={() => onAddToSplit(session)}
          >
            <Columns size={14} />
            <span>{t('chatList.splitScreen' as TranslationKey)}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              // Prevent the default close-menu → focus-trigger behavior.
              // Radix DropdownMenu tries to restore focus to the trigger
              // when the menu closes, which fights with the dialog's
              // autoFocus. Calling preventDefault lets us manage close
              // independently and open the dialog cleanly.
              e.preventDefault();
              setMenuOpen(false);
              setRenameOpen(true);
            }}
          >
            <PencilSimple size={14} />
            <span>{t('chatList.renameConversation' as TranslationKey)}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            navigator.clipboard.writeText(session.id);
          }}>
            <Copy size={14} />
            <span>{t('chatList.copySessionId' as TranslationKey)}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => onDelete(e as unknown as React.MouseEvent, session.id)}
          >
            <Trash size={14} />
            <span>{t('chatList.deleteConversation' as TranslationKey)}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Rename dialog — replaces window.prompt() which is unsupported in
          Electron renderers (throws TypeError: prompt() is not supported).
          See docs/exec-plans/active/v0.48-post-release-issues.md §5.6. */}
      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('prompt.rename.title' as TranslationKey)}
        defaultValue={session.title}
        placeholder={t('prompt.rename.placeholder' as TranslationKey)}
        confirmLabel={t('common.confirm' as TranslationKey)}
        cancelLabel={t('common.cancel' as TranslationKey)}
        onConfirm={(value) => {
          if (value !== session.title) {
            onRename(session.id, value);
          }
        }}
      />
      
      {/* Context Menu */}
      <DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
        <DropdownMenuTrigger asChild>
          <div 
            className="fixed top-0 left-0 w-1 h-1 opacity-0"
            style={{ top: contextMenuPosition.y, left: contextMenuPosition.x }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem onClick={() => {
            setContextMenuOpen(false);
            if (onToggleSelection) {
              onToggleSelection(session.id);
            }
          }}>
            <span>{isSelected ? '取消选择会话' : '选择会话'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setContextMenuOpen(false);
            window.dispatchEvent(new CustomEvent('select-all-sessions'));
          }}>
            <span>全选会话</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setContextMenuOpen(false);
            window.dispatchEvent(new CustomEvent('cancel-selection'));
          }}>
            <span>放弃修改</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={(e) => {
            setContextMenuOpen(false);
            if (onDelete) {
              onDelete(e as unknown as React.MouseEvent, session.id);
            }
          }}>
            <span>删除当前会话</span>
          </DropdownMenuItem>
          {isSelectionMode && (
            <DropdownMenuItem variant="destructive" onClick={() => {
              setContextMenuOpen(false);
              window.dispatchEvent(new CustomEvent('delete-selected-sessions'));
            }}>
              <span>删除所选会话</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface SplitGroupSectionProps {
  splitSessions: Array<{ sessionId: string; title: string }>;
  activeColumnId: string;
  streamingSessionId: string;
  pendingApprovalSessionId: string;
  activeStreamingSessions: Set<string>;
  pendingApprovalSessionIds: Set<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setActiveColumn: (sessionId: string) => void;
  removeFromSplit: (sessionId: string) => void;
}

export function SplitGroupSection({
  splitSessions,
  activeColumnId,
  streamingSessionId,
  pendingApprovalSessionId,
  activeStreamingSessions,
  pendingApprovalSessionIds,
  t,
  setActiveColumn,
  removeFromSplit,
}: SplitGroupSectionProps) {
  return (
    <div className="mb-2 rounded-lg border border-border/60 bg-muted/30 p-1.5">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Columns className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{t('split.splitGroup' as TranslationKey)}</span>
      </div>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {splitSessions.map((session) => {
          const isActiveInSplit = activeColumnId === session.sessionId;
          const isSessionStreaming =
            activeStreamingSessions.has(session.sessionId) || streamingSessionId === session.sessionId;
          const needsApproval =
            pendingApprovalSessionIds.has(session.sessionId) || pendingApprovalSessionId === session.sessionId;

          return (
            <div
              key={session.sessionId}
              className={cn(
                "animate-list-item-enter group relative flex items-center gap-1.5 rounded-md pl-7 pr-2 py-1.5 transition-all duration-150 min-w-0 cursor-pointer",
                isActiveInSplit
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-accent/50"
              )}
              onClick={(e) => {
                e.preventDefault();
                setActiveColumn(session.sessionId);
              }}
            >
              {isSessionStreaming && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
                </span>
              )}
              {needsApproval && (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-status-warning-muted">
                  <Bell size={10} className="text-status-warning-foreground" />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <span className="line-clamp-1 text-[13px] font-medium leading-tight break-all">
                  {session.title}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-4 w-4 shrink-0 text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromSplit(session.sessionId);
                }}
              >
                <X className="h-2.5 w-2.5" />
                <span className="sr-only">{t('split.closeSplit' as TranslationKey)}</span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
