"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { GitCommit, ArrowUp, ArrowDown, Plus, Minus, Trash, Eye, SpinnerGap, Sparkle, CaretDown, Check } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { GitDiffViewer } from "./GitDiffViewer";
import type { GitStatus, GitChangedFile } from "@/types";

// 与 cc-haha GitStatusSection 对齐：三组文件卡片（已采纳/未采纳/未跟踪）、原生 textarea、
// AI 提交说明（失败降级为统计文案）、提交并推送/仅提交到本地/推送到远端。
interface GitStatusSectionProps {
  status: GitStatus;
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
}

export function GitStatusSection({ status, commitMessage, onCommitMessageChange }: GitStatusSectionProps) {
  const { t } = useTranslation();
  const { workingDirectory, sessionId } = usePanel();
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [diffFile, setDiffFile] = useState<{ path: string; staged: boolean } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea（对齐 cc-haha，最高 200px）
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [commitMessage, adjustTextareaHeight]);

  const refresh = () => window.dispatchEvent(new CustomEvent("git-refresh"));

  const handleGenerateMessage = useCallback(async () => {
    if (!workingDirectory || generating) return;

    setGenerating(true);
    onCommitMessageChange("");

    const changedFiles = Array.isArray(status.changedFiles) ? status.changedFiles : [];
    const staged = changedFiles.filter((f) => f.staged);
    // AI 失败时的降级文案：按变更统计拼出 chore 信息（对齐 cc-haha fallback）
    const fallback = () => {
      const all = staged.length > 0 ? staged : changedFiles;
      const added = all.filter((f) => f.status === "added" || f.status === "untracked").length;
      const modified = all.filter((f) => f.status === "modified").length;
      const deleted = all.filter((f) => f.status === "deleted").length;
      const parts: string[] = [];
      if (added > 0) parts.push(`新增了 ${added} 个文件`);
      if (modified > 0) parts.push(`修改了 ${modified} 个文件`);
      if (deleted > 0) parts.push(`删除了 ${deleted} 个文件`);
      onCommitMessageChange(parts.length > 0 ? `chore: ${parts.join("，")}` : "chore: 更新");
    };

    try {
      const res = await fetch("/api/git/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: workingDirectory,
          action: "summary",
          sessionId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Generate failed");
      }
      const data = await res.json();
      onCommitMessageChange(data.result || "");
    } catch (err) {
      console.error("AI commit message failed:", err);
      fallback();
    } finally {
      setGenerating(false);
    }
  }, [workingDirectory, generating, sessionId, status.changedFiles, onCommitMessageChange]);

  const handleStage = useCallback(async (paths: string[], all?: boolean) => {
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, paths, all }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Stage failed");
      }
      refresh();
    } catch (err) {
      console.error("Stage failed:", err);
    }
  }, [workingDirectory]);

  const handleUnstage = useCallback(async (paths: string[], all?: boolean) => {
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, paths, all }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unstage failed");
      }
      refresh();
    } catch (err) {
      console.error("Unstage failed:", err);
    }
  }, [workingDirectory]);

  const handleDiscard = useCallback(async (paths: string[]) => {
    if (!confirm(`确定要放弃对 ${paths.length} 个文件的更改吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, paths }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Discard failed");
      }
      refresh();
    } catch (err) {
      console.error("Discard failed:", err);
    }
  }, [workingDirectory]);

  const handleCommit = useCallback(async () => {
    if (!workingDirectory || committing || !status.dirty) return;
    setCommitting(true);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, message: commitMessage.trim() || "Update" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Commit failed");
      }
      onCommitMessageChange("");
      refresh();
    } catch (err) {
      console.error("Commit failed:", err);
    } finally {
      setCommitting(false);
    }
  }, [workingDirectory, committing, commitMessage, status.dirty, onCommitMessageChange]);

  const handleCommitAndPush = useCallback(async () => {
    if (!workingDirectory || committing || pushing || !status.dirty) return;
    setCommitting(true);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, message: commitMessage.trim() || "Update" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Commit failed");
      }
      onCommitMessageChange("");
    } catch (err) {
      console.error("Commit failed:", err);
      setCommitting(false);
      return;
    }
    setCommitting(false);
    setPushing(true);
    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) throw new Error("Push failed");
      refresh();
    } catch (err) {
      console.error("Push failed:", err);
      refresh();
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, committing, pushing, commitMessage, status.dirty, onCommitMessageChange]);

  const handlePush = useCallback(async () => {
    if (!workingDirectory || pushing) return;
    setPushing(true);
    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) throw new Error("Push failed");
      refresh();
    } catch (err) {
      console.error("Push failed:", err);
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, pushing]);

  const changedFilesArray = Array.isArray(status.changedFiles) ? status.changedFiles : [];
  const staged = changedFilesArray.filter((f) => f.staged);
  const unstaged = changedFilesArray.filter((f) => !f.staged && f.status !== "untracked");
  const untracked = changedFilesArray.filter((f) => f.status === "untracked");

  return (
    <div className="space-y-3">
      {/* Ahead / behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="flex items-center gap-3">
          {status.ahead > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--color-success)]">
              <ArrowUp size={12} />领先 {status.ahead} 个提交
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--color-warning)]">
              <ArrowDown size={12} />落后 {status.behind} 个提交
            </span>
          )}
        </div>
      )}

      {/* Staged changes */}
      {staged.length > 0 && (
        <FileGroup
          label="已采纳"
          count={staged.length}
          files={staged}
          onAction={(file) => handleUnstage([file.path])}
          actionIcon={<Minus size={12} />}
          actionTitle="取消采纳"
          onBulkAction={() => handleUnstage([], true)}
          bulkLabel="全部取消采纳"
          onViewDiff={(file) => setDiffFile({ path: file.path, staged: true })}
        />
      )}

      {/* Unstaged changes */}
      {unstaged.length > 0 && (
        <FileGroup
          label="未采纳"
          count={unstaged.length}
          files={unstaged}
          onAction={(file) => handleStage([file.path])}
          actionIcon={<Plus size={12} />}
          actionTitle="采纳"
          onBulkAction={() => handleStage([], true)}
          bulkLabel="全部采纳"
          onDiscard={(file) => handleDiscard([file.path])}
          onViewDiff={(file) => setDiffFile({ path: file.path, staged: false })}
        />
      )}

      {/* Untracked files */}
      {untracked.length > 0 && (
        <FileGroup
          label="未跟踪"
          count={untracked.length}
          files={untracked}
          onAction={(file) => handleStage([file.path])}
          actionIcon={<Plus size={12} />}
          actionTitle="采纳"
          onDiscard={(file) => handleDiscard([file.path])}
        />
      )}

      {/* Clean state */}
      {staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && (
        <div className="py-2 text-xs text-[var(--color-text-tertiary)]">
          工作区干净，所有更改已提交
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={commitMessage}
            onChange={(e) => !generating && onCommitMessageChange(e.target.value)}
            placeholder={`${t("git.commitPlaceholder")} (${status.branch})`}
            className={`w-full min-h-[56px] text-xs py-2 px-2.5 pr-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] resize-none overflow-y-auto focus:outline-none focus:border-[var(--color-brand)]/50 ${generating ? "opacity-70" : ""}`}
            rows={3}
            readOnly={generating}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey && !generating && status.dirty) {
                e.preventDefault();
                handleCommitAndPush();
              }
            }}
          />
          <button
            type="button"
            onClick={handleGenerateMessage}
            disabled={generating}
            className={`absolute right-2 top-2 transition-all disabled:cursor-not-allowed ${
              generating
                ? "text-[var(--color-success)] animate-pulse"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-success)] hover:scale-110"
            }`}
            title="AI 生成提交说明"
          >
            {generating ? <SpinnerGap size={14} className="animate-spin" /> : <Sparkle size={14} />}
          </button>
        </div>
        {status.dirty ? (
          <>
            <button
              onClick={handleCommitAndPush}
              disabled={committing || pushing || staged.length === 0}
              title={staged.length === 0 ? "请先采纳要提交的文件" : undefined}
              className="flex items-center justify-center gap-1.5 h-8 w-full text-xs font-medium rounded-lg bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {committing || pushing ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              {committing ? "提交中..." : pushing ? "推送中..." : "提交并推送"}
            </button>
            <button
              onClick={handleCommit}
              disabled={committing || pushing || staged.length === 0}
              title={staged.length === 0 ? "请先采纳要提交的文件" : undefined}
              className="flex items-center justify-center gap-1.5 h-8 w-full text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {committing ? <SpinnerGap size={14} className="animate-spin" /> : <GitCommit size={14} />}
              仅提交到本地
            </button>
          </>
        ) : (
          <button
            onClick={handlePush}
            disabled={pushing || status.ahead === 0}
            className="flex items-center justify-center gap-1.5 h-8 w-full text-xs font-medium rounded-lg bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {pushing ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowUp size={14} />}
            {pushing ? "推送中..." : status.ahead > 0 ? `推送到远端 (${status.ahead})` : "没有需要推送的提交"}
          </button>
        )}
      </div>

      {/* Diff viewer */}
      {diffFile && (
        <GitDiffViewer
          cwd={workingDirectory}
          filePath={diffFile.path}
          staged={diffFile.staged}
          onClose={() => setDiffFile(null)}
        />
      )}
    </div>
  );
}

/* ── FileGroup sub-component ─────────────────────────────────── */

const statusColors: Record<string, string> = {
  modified: "var(--color-warning)",
  added: "var(--color-success)",
  deleted: "var(--color-error)",
  renamed: "var(--color-brand)",
  copied: "var(--color-brand)",
  untracked: "var(--color-text-tertiary)",
};

const statusLetters: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
};

function FileGroup({
  label,
  count,
  files,
  onAction,
  actionIcon,
  actionTitle,
  onBulkAction,
  bulkLabel,
  onDiscard,
  onViewDiff,
}: {
  label: string;
  count: number;
  files: GitChangedFile[];
  onAction: (file: GitChangedFile) => void;
  actionIcon: React.ReactNode;
  actionTitle: string;
  onBulkAction?: () => void;
  bulkLabel?: string;
  onDiscard?: (file: GitChangedFile) => void;
  onViewDiff?: (file: GitChangedFile) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalAdditions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const totalDeletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-[var(--color-surface-hover)]/50 transition-colors text-left"
      >
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {label === "已采纳" && <Check size={12} className="text-[var(--color-success)]" />}
          {label} <span className="text-[#3b82f6]">({count})</span>
        </span>
        <div className="flex items-center gap-2">
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono">
              {totalAdditions > 0 && (
                <span className="text-[var(--color-success)]">+{totalAdditions}</span>
              )}
              {totalDeletions > 0 && (
                <span className="text-[var(--color-error)]">-{totalDeletions}</span>
              )}
            </span>
          )}
          {onBulkAction && bulkLabel && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onBulkAction();
              }}
              className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              {bulkLabel}
            </span>
          )}
          <CaretDown
            size={14}
            className="text-[var(--color-text-tertiary)] transition-transform duration-200"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </div>
      </button>
      <div
        className="transition-all duration-200 ease-out overflow-hidden"
        style={{ maxHeight: expanded ? "200px" : "0px", opacity: expanded ? 1 : 0 }}
      >
        <div className="max-h-[200px] overflow-y-auto border-t border-[var(--color-border)]/40">
          {files.map((file, i) => (
            <div
              key={`${file.path}-${file.staged}-${i}`}
              className="flex items-center gap-2 py-1 px-3 text-[12px] hover:bg-[var(--color-surface-container-low)]/50 group"
            >
              <span
                className="shrink-0 font-mono text-[11px] font-medium"
                style={{ color: statusColors[file.status] || "var(--color-text-tertiary)" }}
              >
                {statusLetters[file.status] || "?"}
              </span>
              {file.staged && (
                <span
                  className="shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "var(--color-success)" }}
                />
              )}
              <span className="truncate flex-1 text-[var(--color-text-primary)]/80">{file.path}</span>
              {file.status !== "untracked" && typeof file.additions === "number" && (
                <span className="text-[10px] text-[var(--color-success)] shrink-0 font-mono">+{file.additions}</span>
              )}
              {file.status !== "untracked" && typeof file.deletions === "number" && (
                <span className="text-[10px] text-[var(--color-error)] shrink-0 font-mono">-{file.deletions}</span>
              )}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {onViewDiff && (
                  <button
                    onClick={() => onViewDiff(file)}
                    className="p-0.5 hover:bg-[var(--color-surface-container-low)] rounded text-[var(--color-text-tertiary)]"
                    title="查看差异"
                  >
                    <Eye size={12} />
                  </button>
                )}
                <button
                  onClick={() => onAction(file)}
                  className="p-0.5 hover:bg-[var(--color-surface-container-low)] rounded text-[var(--color-text-tertiary)]"
                  title={actionTitle}
                >
                  {actionIcon}
                </button>
                {onDiscard && (
                  <button
                    onClick={() => onDiscard(file)}
                    className="p-0.5 hover:bg-[var(--color-surface-container-low)] rounded"
                    style={{ color: "var(--color-error)" }}
                    title="放弃更改"
                  >
                    <Trash size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
