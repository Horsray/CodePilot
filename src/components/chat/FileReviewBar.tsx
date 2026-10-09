'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  X,
  CaretUpDown,
  NotePencil,
  Code,
  Eye,
  XCircle,
  ArrowUp,
  ArrowDown,
  Play,
  SpinnerGap
} from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';
import { usePanel } from '@/hooks/usePanel';

const RENDERABLE_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.csv', '.tsv']);

function canPreview(filename: string): boolean {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return RENDERABLE_EXTENSIONS.has(ext);
}

interface ModifiedFile {
  path: string;
  added: number;
  removed: number;
  originalContent: string;
  currentContent: string;
  diffLines?: Array<{
    type: 'added' | 'removed' | 'unchanged';
    content: string;
    oldLineNumber?: number;
    newLineNumber?: number;
  }>;
}

interface FileReviewBarProps {
  sessionId: string;
  isStreaming?: boolean;
}

const REVIEW_POLL_INTERVAL_MS = 10000;

export function FileReviewBar({ sessionId, isStreaming = false }: FileReviewBarProps) {
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([]);
  const [totalAdded, setTotalAdded] = useState(0);
  const [totalRemoved, setTotalRemoved] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<ModifiedFile | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);

  // 文件审查状态重置：切换会话、放弃修改或接口返回空结果时调用。
  const resetReviewState = useCallback(() => {
    setModifiedFiles([]);
    setTotalAdded(0);
    setTotalRemoved(0);
    setExpanded(false);
    setDiffModalFile(null);
  }, []);

  // 文件审查状态拉取：同一时间只保留一个请求，开始流式回复或切换会话时立即中止。
  const fetchStatus = useCallback(async () => {
    if (!sessionId || isStreaming || processing) return;
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    try {
      const res = await fetch(`/api/chat/review?sessionId=${encodeURIComponent(sessionId)}`, {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (controller.signal.aborted) return;
      if (res.status === 404) {
        resetReviewState();
        return;
      }
      if (!res.ok) return;

      const data = await res.json();
      if (controller.signal.aborted) return;

      const nextFiles = Array.isArray(data.modifiedFiles) ? data.modifiedFiles : [];
      setModifiedFiles(nextFiles);
      setTotalAdded(data.totalAdded || 0);
      setTotalRemoved(data.totalRemoved || 0);
      if (nextFiles.length === 0) {
        setExpanded(false);
        setDiffModalFile(null);
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        return;
      }
      // 网络短暂波动时静默降级，避免干扰聊天主流程。
    } finally {
      if (fetchControllerRef.current === controller) {
        fetchControllerRef.current = null;
      }
    }
  }, [isStreaming, processing, resetReviewState, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      fetchControllerRef.current?.abort();
      actionControllerRef.current?.abort();
      resetReviewState();
      return;
    }

    if (isStreaming) {
      fetchControllerRef.current?.abort();
      return;
    }

    void fetchStatus();
    // 文件审查轮询：仅在当前会话空闲时启用，避免与聊天主请求并发争抢。
    const interval = window.setInterval(() => {
      void fetchStatus();
    }, REVIEW_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      fetchControllerRef.current?.abort();
      actionControllerRef.current?.abort();
    };
  }, [fetchStatus, isStreaming, resetReviewState, sessionId]);

  const pendingCount = modifiedFiles.length;

  const handleAccept = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProcessing(true);
    fetchControllerRef.current?.abort();
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    try {
      // 中文注释：功能名称「文件审查动作提交」，用法是在用户点击接受/放弃后持续等待
      // 后端真实完成，不再由前端 60 秒定时器提前中止，避免持久化回滚链路被误判超时。
      const res = await fetch('/api/chat/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'accept' }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`accept failed: ${res.status}`);
      }
      resetReviewState();
      setExpanded(false);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        console.error('Failed to accept changes: request timed out.');
        return;
      }
      console.error('Failed to accept changes:', e);
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
      }
      setProcessing(false);
    }
  };

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`确定要放弃这 ${pendingCount} 个文件的所有更改吗？此操作不可撤销。`)) return;
    setProcessing(true);
    fetchControllerRef.current?.abort();
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    try {
      const res = await fetch('/api/chat/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'discard' }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`discard failed: ${res.status}`);
      }
      resetReviewState();
      setExpanded(false);
      // Dispatch events to notify other components (like FileTree) to refresh
      window.dispatchEvent(new CustomEvent('session-updated'));
      window.dispatchEvent(new CustomEvent('files-changed'));
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        console.error('Failed to discard changes: request timed out.');
        return;
      }
      console.error('Failed to discard changes:', e);
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
      }
      setProcessing(false);
    }
  };

  if (pendingCount === 0) return null;

  return (
    <>
      {/* 中文注释：对齐 cc-haha CurrentTurnChangeCard——待审查卡片位于提示词输入框上方，
          与输入框同宽（px-2.5 与输入框内缩对齐，pb-2 与下方输入框留出间距）。
          header 为图标 chip + 文案 + 增删计数，右侧同一行放置
          「放弃全部 / 采纳」操作按钮，展开后是逐文件列表。 */}
      <div className="w-full px-2.5 pb-2">
        <div className="overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:bg-[var(--color-surface-container)]">
          {/* Header：图标 chip + 文案 + 增删计数，右侧同一行放置「放弃全部 / 采纳」操作按钮 */}
          <div className="flex min-h-[34px] w-full items-center gap-1.5 px-2.5">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left transition-colors hover:bg-[#f8f8f8] dark:hover:bg-[var(--color-surface-hover)]/40"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[#E8F0FE] text-[#0A56D0] dark:bg-[#0A56D0]/20 dark:text-[#8CB4F2]">
                <Code size={13} weight="bold" />
              </span>
              <span className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                {pendingCount} 个文件待审查
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
                <span className="text-[var(--color-success)]">+{totalAdded}</span>
                <span className="text-[var(--color-error)]">-{totalRemoved}</span>
              </span>
              {processing ? (
                <SpinnerGap size={14} className="animate-spin text-[var(--color-text-tertiary)]" />
              ) : (
                <CaretUpDown size={14} className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-200" />
              )}
            </button>

            <button
              type="button"
              onClick={handleDiscard}
              disabled={processing}
              className="flex shrink-0 items-center gap-1 rounded-[5px] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:opacity-50"
              title="放弃整个会话中的全部修改"
            >
              <X size={13} />
              放弃全部
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={processing}
              className="flex shrink-0 items-center gap-1 rounded-[5px] bg-[#0A56D0] px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#0842A0] disabled:opacity-50"
              title="接受整个会话中的全部修改"
            >
              {processing ? <SpinnerGap size={13} className="animate-spin" /> : <Check size={13} weight="bold" />}
              采纳
            </button>
          </div>

          {/* Expanded list of files */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="max-h-[260px] overflow-y-auto border-t border-[var(--color-border)]/60">
                  {modifiedFiles.map((file) => (
                    <FileRow
                      key={file.path}
                      file={file}
                      onClick={() => setDiffModalFile(file)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Diff Modal */}
      {diffModalFile && (
        <DiffModal
          file={diffModalFile}
          onClose={() => setDiffModalFile(null)}
        />
      )}
    </>
  );
}

function FileRow({ file, onClick }: { file: ModifiedFile, onClick: () => void }) {
  const filename = file.path.split('/').pop() || file.path;
  const { openPreviewTab } = usePanel();
  const showPreviewBtn = canPreview(filename);

  // 中文注释：对齐 cc-haha CurrentTurnChangeCard 的逐文件行——图标 + 文件名 + 路径 +
  // 增删徽标，右侧常驻 diff 查看与渲染预览按钮。
  return (
    <div className="group flex w-full items-center gap-1.5 border-b border-[var(--color-border)]/10 px-2.5 py-1.5 transition-colors last:border-0 hover:bg-[var(--color-surface-hover)]/40">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <NotePencil size={14} className="text-[#d97706]" />
        </span>
        <span className="shrink-0 truncate font-mono text-[12px] font-semibold text-[var(--color-text-primary)]">{filename}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">{file.path}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px]">
          {file.added > 0 && <span className="rounded bg-[var(--color-success)]/10 px-1 text-[var(--color-success)]">+{file.added}</span>}
          {file.removed > 0 && <span className="rounded bg-[var(--color-error)]/10 px-1 text-[var(--color-error)]">-{file.removed}</span>}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-tertiary)] transition-colors hover:bg-[#E8F0FE] hover:text-[#0A56D0]"
        title="查看 diff"
      >
        <Eye size={13} />
      </button>

      {showPreviewBtn && (
         <button
           type="button"
           onClick={(e) => {
             e.stopPropagation();
             openPreviewTab(file.path);
           }}
           className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
           title="预览渲染效果"
         >
           <Play size={13} weight="fill" />
         </button>
       )}
    </div>
  );
}

function DiffModal({ file, onClose }: { file: ModifiedFile, onClose: () => void }) {
  const filename = file.path.split('/').pop() || file.path;
  const diffLines = useMemo(() => file.diffLines || [], [file.diffLines]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(-1);

  // Find all indices of lines that are either added or removed, grouping consecutive changes
  const changeIndices = useMemo(() => {
    const indices: number[] = [];
    let inChangeBlock = false;
    
    diffLines.forEach((line, idx) => {
      const isChange = line.type === 'added' || line.type === 'removed';
      if (isChange) {
        if (!inChangeBlock) {
          indices.push(idx);
          inChangeBlock = true;
        }
      } else {
        inChangeBlock = false;
      }
    });
    
    return indices;
  }, [diffLines]);

  const scrollToChange = useCallback((index: number) => {
    if (index < 0 || index >= changeIndices.length || !scrollRef.current) return;
    
    const targetIdx = changeIndices[index];
    const row = scrollRef.current.querySelector(`div[data-idx="${targetIdx}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentChangeIndex(index);
    }
  }, [changeIndices]);

  // Scroll to first change on open
  useEffect(() => {
    if (changeIndices.length > 0) {
      // Small delay to ensure table is rendered
      const timer = setTimeout(() => {
        scrollToChange(0);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [changeIndices, scrollToChange]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-background/40 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-background rounded-2xl border border-border/50 shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/10 bg-muted/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Code size={18} weight="bold" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-[15px] font-bold font-mono truncate max-w-md">{filename}</h3>
              <p className="text-[11px] text-muted-foreground/60 font-mono">{file.path}</p>
            </div>
            <div className="flex items-center gap-2 ml-4 px-3 py-1 rounded-full bg-muted/30 font-mono text-[12px]">
              <span className="text-emerald-500 font-bold">+{file.added}</span>
              <span className="text-red-500 font-bold">-{file.removed}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Navigation Buttons */}
            {changeIndices.length > 0 && (
              <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg border border-border/10">
                <button
                  onClick={() => scrollToChange(currentChangeIndex - 1)}
                  disabled={currentChangeIndex <= 0}
                  className="p-1.5 rounded-md hover:bg-background/50 disabled:opacity-30 transition-colors"
                  title="上一个修改点"
                >
                  <ArrowUp size={14} weight="bold" />
                </button>
                <span className="text-[11px] font-mono px-2 min-w-[60px] text-center">
                  {currentChangeIndex + 1} / {changeIndices.length}
                </span>
                <button
                  onClick={() => scrollToChange(currentChangeIndex + 1)}
                  disabled={currentChangeIndex >= changeIndices.length - 1}
                  className="p-1.5 rounded-md hover:bg-background/50 disabled:opacity-30 transition-colors"
                  title="下一个修改点"
                >
                  <ArrowDown size={14} weight="bold" />
                </button>
              </div>
            )}
            
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-muted/50 text-muted-foreground transition-colors"
            >
              <XCircle size={22} />
            </button>
          </div>
        </div>

        {/* Modal Body - Unified Diff View */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-x-hidden overflow-y-auto bg-background font-mono text-[12px] leading-relaxed scrollbar-thin"
        >
          <div className="w-full flex flex-col pb-4">
            {diffLines.length > 0 ? (
              diffLines.map((line, idx) => (
                <div 
                  key={idx} 
                  data-idx={idx}
                  className={cn(
                    "flex group border-b border-border/5 transition-colors",
                    line.type === 'added' && "bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12]",
                    line.type === 'removed' && "bg-red-500/[0.08] hover:bg-red-500/[0.12]",
                    line.type === 'unchanged' && "hover:bg-muted/5",
                    changeIndices[currentChangeIndex] === idx && "ring-1 ring-inset ring-primary/30"
                  )}
                >
                  <div className="w-12 shrink-0 py-0.5 text-right pr-2 select-none border-r border-border/5 align-top text-muted-foreground/40">
                    {line.oldLineNumber || ''}
                  </div>
                  <div className="w-12 shrink-0 py-0.5 text-right pr-2 select-none border-r border-border/5 align-top text-muted-foreground/40">
                    {line.newLineNumber || ''}
                  </div>
                  <div className={cn(
                    "w-6 shrink-0 py-0.5 text-center select-none align-top",
                    line.type === 'added' ? "text-emerald-500/60" :
                    line.type === 'removed' ? "text-red-500/60" : "text-muted-foreground/30"
                  )}>
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </div>
                  <div className={cn(
                    "flex-1 px-2 py-0.5 whitespace-pre-wrap break-all align-top",
                    line.type === 'added' ? "text-emerald-600 dark:text-emerald-400 font-medium" : 
                    line.type === 'removed' ? "text-red-600 dark:text-red-400 font-medium line-through opacity-80" : "text-foreground/80"
                  )}>
                    {line.content || ' '}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-12 text-center text-muted-foreground italic">
                No differences found or diff is still loading...
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/10 bg-muted/5">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            关闭预览
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
