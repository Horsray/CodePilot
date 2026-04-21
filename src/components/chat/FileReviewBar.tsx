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
  Play
} from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';
import { usePanel } from '@/hooks/usePanel';

const RENDERABLE_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.tsx', '.jsx', '.csv', '.tsv']);

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

export function FileReviewBar({ sessionId, isStreaming = false }: FileReviewBarProps) {
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([]);
  const [totalAdded, setTotalAdded] = useState(0);
  const [totalRemoved, setTotalRemoved] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<ModifiedFile | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);

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
    if (!sessionId || isStreaming) return;
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
  }, [isStreaming, resetReviewState, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      fetchControllerRef.current?.abort();
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
    }, 3000);

    return () => {
      window.clearInterval(interval);
      fetchControllerRef.current?.abort();
    };
  }, [fetchStatus, isStreaming, resetReviewState, sessionId]);

  const pendingCount = modifiedFiles.length;

  const handleAccept = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProcessing(true);
    fetchControllerRef.current?.abort();
    try {
      const res = await fetch('/api/chat/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'accept' }),
      });
      if (!res.ok) {
        throw new Error(`accept failed: ${res.status}`);
      }
      resetReviewState();
      setExpanded(false);
    } catch (e) {
      console.error('Failed to accept changes:', e);
    } finally {
      setProcessing(false);
    }
  };

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`确定要放弃这 ${pendingCount} 个文件的所有更改吗？此操作不可撤销。`)) return;
    setProcessing(true);
    fetchControllerRef.current?.abort();
    try {
      const res = await fetch('/api/chat/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'discard' }),
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
      console.error('Failed to discard changes:', e);
    } finally {
      setProcessing(false);
    }
  };

  if (pendingCount === 0) return null;

  return (
    <>
      <div className="px-4 pb-2 flex justify-start pointer-events-none">
        <div className={cn(
          "overflow-hidden rounded-xl border bg-background shadow-lg backdrop-blur-md transition-all duration-300 w-fit min-w-[320px] max-w-[500px] pointer-events-auto",
          pendingCount > 0 ? "border-primary/30 opacity-100 translate-y-0 scale-100" : "border-border/10 opacity-0 translate-y-4 scale-95 pointer-events-none"
        )}>
          {/* Expanded list of files */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-b border-border/10 max-h-[320px] overflow-y-auto bg-muted/5 scrollbar-thin"
              >
                <div className="py-1 flex flex-col">
                  {modifiedFiles.map((file, i) => (
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

          {/* Bottom Bar */}
          <div className="flex items-center h-10">
            {/* Left Icon Box */}
            <div className="flex h-full w-10 shrink-0 items-center justify-center border-r border-border/10 text-primary/80">
              <NotePencil size={18} weight="bold" className="text-[#7C3AED]" />
            </div>

            <button 
              onClick={() => setExpanded(!expanded)}
              className="flex flex-1 items-center gap-2 px-3 hover:bg-muted/10 transition-colors h-full text-left min-w-0 group"
            >
              <span className="text-[13px] font-medium text-foreground/80 truncate">
                当前会话有 {pendingCount} 个文件待审查
              </span>
              <CaretUpDown size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-transform" />
              
              <div className="flex items-center gap-1.5 font-mono text-[11px] ml-auto pr-2">
                <span className="text-emerald-500/80">+{totalAdded}</span>
                <span className="text-red-500/70">-{totalRemoved}</span>
              </div>
            </button>

            <div className="flex items-center gap-1 px-2 border-l border-border/10 h-full">
              <button
                onClick={handleDiscard}
                disabled={processing}
                className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
                title="放弃整个会话中的全部修改"
              >
                <X size={16} />
              </button>
              <button
                onClick={handleAccept}
                disabled={processing}
                className="flex h-7 w-7 items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm rounded-lg transition-all disabled:opacity-50 active:scale-95 ml-1"
                title="接受整个会话中的全部修改"
              >
                <Check size={14} weight="bold" />
              </button>
            </div>
          </div>
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
  
  return (
    <div className="flex items-center group w-full border-b border-border/5 last:border-0 hover:bg-muted/40 transition-colors">
      <button 
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex items-center gap-3 px-4 py-2.5 text-left flex-1"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <NotePencil size={14} weight="bold" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-[12px] font-mono text-foreground/80 truncate font-semibold leading-tight">{filename}</span>
          <span className="text-[10px] text-muted-foreground/40 truncate tracking-tight">{file.path}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0 mr-2">
          {file.added > 0 && <span className="text-emerald-500/60">+{file.added}</span>}
          {file.removed > 0 && <span className="text-red-500/50">-{file.removed}</span>}
          <Eye size={12} className="ml-1 text-muted-foreground/30 group-hover:text-primary/60 transition-colors" />
        </div>
      </button>

      {showPreviewBtn && (
         <button
           onClick={(e) => {
             e.stopPropagation();
             openPreviewTab(file.path);
           }}
           className="flex h-7 w-7 items-center justify-center rounded-md mr-4 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
           title="预览渲染效果"
         >
           <Play size={14} weight="fill" />
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
    const row = scrollRef.current.querySelector(`tr[data-idx="${targetIdx}"]`);
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

        {/* Modal Body - Aligned Diff View */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-x-hidden overflow-y-auto bg-background font-mono text-[12px] leading-relaxed scrollbar-thin"
        >
          <div className="w-full">
            {diffLines.length > 0 ? (
              <table className="w-full border-collapse table-fixed">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-muted-foreground/50 border-b border-border/5 bg-muted/5 sticky top-0 z-10">
                    <th className="w-12 py-2 font-normal">Line</th>
                    <th className="py-2 px-4 font-bold text-left border-r border-border/10">Original (原始内容)</th>
                    <th className="w-12 py-2 font-normal">Line</th>
                    <th className="py-2 px-4 font-bold text-left">Modified (修改后内容)</th>
                  </tr>
                </thead>
                <tbody>
                  {diffLines.map((line, idx) => (
                    <tr 
                      key={idx} 
                      data-idx={idx}
                      className={cn(
                        "group border-b border-border/5 transition-colors",
                        line.type === 'added' && "bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12]",
                        line.type === 'removed' && "bg-red-500/[0.08] hover:bg-red-500/[0.12]",
                        line.type === 'unchanged' && "hover:bg-muted/5",
                        changeIndices[currentChangeIndex] === idx && "ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      {/* Original Side */}
                      <td className={cn(
                        "w-12 py-0.5 text-right pr-2 select-none border-r border-border/5 align-top",
                        line.type === 'removed' ? "text-red-500/50" : "text-muted-foreground/20"
                      )}>
                        {line.oldLineNumber || ''}
                      </td>
                      <td className={cn(
                        "px-4 py-0.5 whitespace-pre-wrap break-all border-r border-border/10 align-top",
                        line.type === 'removed' ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground/40"
                      )}>
                        {line.type !== 'added' ? (
                          <div className="flex gap-2">
                            <span className="opacity-30 select-none">{line.type === 'removed' ? '-' : ' '}</span>
                            <span className="break-words">{line.content || ' '}</span>
                          </div>
                        ) : ' '}
                      </td>

                      {/* Modified Side */}
                      <td className={cn(
                        "w-12 py-0.5 text-right pr-2 select-none border-r border-border/5 align-top",
                        line.type === 'added' ? "text-emerald-500/50" : "text-muted-foreground/20"
                      )}>
                        {line.newLineNumber || ''}
                      </td>
                      <td className={cn(
                        "px-4 py-0.5 whitespace-pre-wrap break-all align-top",
                        line.type === 'added' ? "text-emerald-600 dark:text-emerald-400 font-medium" : 
                        line.type === 'unchanged' ? "text-foreground/80" : "text-muted-foreground/40"
                      )}>
                        {line.type !== 'removed' ? (
                          <div className="flex gap-2">
                            <span className="opacity-30 select-none">{line.type === 'added' ? '+' : ' '}</span>
                            <span className="break-words">{line.content || ' '}</span>
                          </div>
                        ) : ' '}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
