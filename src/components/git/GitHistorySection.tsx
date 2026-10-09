"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { GitCommit, Clock, Copy, Hash } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitLogEntry } from "@/types";

interface GitHistorySectionProps {
  cwd: string;
  onSelectCommit: (sha: string) => void;
}

export function GitHistorySection({ cwd, onSelectCommit }: GitHistorySectionProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: GitLogEntry } | null>(null);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [hoveredEntry, setHoveredEntry] = useState<{ entry: GitLogEntry; rect: DOMRect; above: boolean } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=30`);
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const handler = () => void fetchHistory();
    window.addEventListener("git-refresh", handler);
    return () => window.removeEventListener("git-refresh", handler);
  }, [fetchHistory]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: GitLogEntry) => {
    e.preventDefault();
    setHoveredEntry(null);
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleCopySha = useCallback(async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedSha(sha);
      setTimeout(() => setCopiedSha(null), 1500);
    } catch {
      // ignore
    }
    setContextMenu(null);
  }, []);

  const handleCopyDiff = useCallback(
    async (entry: GitLogEntry) => {
      try {
        const res = await fetch(`/api/git/commit-detail/${entry.sha}?cwd=${encodeURIComponent(cwd)}`);
        const detail = await res.json();
        if (detail?.diff) {
          await navigator.clipboard.writeText(detail.diff);
          setCopiedSha(entry.sha);
          setTimeout(() => setCopiedSha(null), 1500);
        }
      } catch {
        // ignore
      }
      setContextMenu(null);
    },
    [cwd],
  );

  const handleMouseEnter = useCallback((e: React.MouseEvent, entry: GitLogEntry) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      const spaceBelow = window.innerHeight - rect.bottom;
      setHoveredEntry({ entry, rect, above: spaceBelow < 200 });
    }, 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredEntry(null);
  }, []);

  if (loading) {
    return <div className="py-2 text-[11px] text-[var(--color-text-tertiary)]">加载中...</div>;
  }

  if (entries.length === 0) {
    return <div className="py-2 text-[11px] text-[var(--color-text-tertiary)]">提交历史</div>;
  }

  return (
    <>
      <div className="max-h-[300px] overflow-y-auto">
        {entries.map((entry) => (
          <button
            key={entry.sha}
            className="flex items-start gap-2 w-full py-1.5 text-left hover:bg-[var(--color-surface-container-low)] transition-colors"
            onClick={() => onSelectCommit(entry.sha)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
            onMouseEnter={(e) => handleMouseEnter(e, entry)}
            onMouseLeave={handleMouseLeave}
          >
            <GitCommit size={14} className="shrink-0 text-[var(--color-text-tertiary)] mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-[var(--color-text-tertiary)]">
                  {entry.sha.substring(0, 7)}
                </span>
                <p className="text-[12px] truncate text-[var(--color-text-primary)]">
                  {entry.message.split("\n")[0]}
                </p>
              </div>
              <p className="text-[10px] text-[var(--color-text-tertiary)] flex items-center gap-1 mt-0.5">
                <Clock size={10} />
                {entry.authorName} · {formatRelativeTime(entry.timestamp)}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Tooltip via portal — escapes overflow:hidden ancestors */}
      {hoveredEntry &&
        createPortal(
          <div
            className="fixed z-[200] max-w-[420px] max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-lg text-[11px] text-[var(--color-text-primary)] whitespace-pre-wrap break-words pointer-events-none"
            style={{
              left: hoveredEntry.rect.left,
              top: hoveredEntry.above ? hoveredEntry.rect.top - 6 : hoveredEntry.rect.bottom + 6,
              transform: hoveredEntry.above ? "translateY(-100%)" : "none",
            }}
          >
            {hoveredEntry.entry.message}
          </div>,
          document.body,
        )}

      {/* Context Menu via portal */}
      {contextMenu &&
        createPortal(
          <div
            className="fixed z-[200] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] transition-colors"
              onClick={() => handleCopySha(contextMenu.entry.sha)}
            >
              <Hash size={12} className="text-[var(--color-text-tertiary)]" />
              {copiedSha === contextMenu.entry.sha ? t("git.copied") : t("git.copyCommitId")}
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] transition-colors"
              onClick={() => handleCopyDiff(contextMenu.entry)}
            >
              <Copy size={12} className="text-[var(--color-text-tertiary)]" />
              {copiedSha === contextMenu.entry.sha ? t("git.copied") : t("git.copyDiff")}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

// 与 cc-haha 一致：分钟/小时/天不带空格
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 30) return `${diffDay}天前`;
  return date.toLocaleDateString();
}
