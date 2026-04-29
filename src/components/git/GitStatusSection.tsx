"use client";

import { useState, useCallback } from "react";
import { GitBranch, GitCommit, CloudArrowUp, ArrowUp, ArrowLeft, ArrowDown, Circle, Plus, Minus, Trash, Eye, SpinnerGap, Sparkle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { showToast } from "@/hooks/useToast";
import { GitDiffViewer } from "./GitDiffViewer";
import type { GitStatus, GitChangedFile } from "@/types";

interface GitStatusSectionProps {
  status: GitStatus;
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
}

export function GitStatusSection({ status, commitMessage, onCommitMessageChange }: GitStatusSectionProps) {
  const { t } = useTranslation();
  const { workingDirectory, sessionId } = usePanel();
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [diffFile, setDiffFile] = useState<{ path: string; staged: boolean } | null>(null);

  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);

  const handleGenerateMessage = useCallback(async () => {
    if (!workingDirectory || generating) return;

    setGenerating(true);
    try {
      const res = await fetch('/api/git/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cwd: workingDirectory, 
          action: 'summary',
          sessionId
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || 'Generate failed' });
        return;
      }
      const data = await res.json();
      onCommitMessageChange(data.result);
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Generate failed' });
    } finally {
      setGenerating(false);
    }
  }, [workingDirectory, generating, sessionId]);

  const handleCommit = useCallback(async () => {
    if (!workingDirectory || committing || !status.dirty) return;
    setCommitting(true);
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, message: commitMessage.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || 'Commit failed' });
        return;
      }
      onCommitMessageChange('');
      showToast({ type: 'success', message: '提交成功' });
      handleCommitSuccess();
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Commit failed' });
    } finally {
      setCommitting(false);
    }
  }, [workingDirectory, committing, commitMessage, status.dirty]);

  const handleCommitAndPush = useCallback(async () => {
    if (!workingDirectory || committing || pushing || !status.dirty) return;
    
    // First, commit
    setCommitting(true);
    let commitSuccess = false;
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, message: commitMessage.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || 'Commit failed' });
        setCommitting(false);
        return;
      }
      onCommitMessageChange('');
      commitSuccess = true;
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Commit failed' });
      setCommitting(false);
      return;
    }

    if (!commitSuccess) return;
    
    // Update state to show pushing
    setCommitting(false);
    setPushing(true);

    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Push failed' }));
        showToast({ type: 'error', message: data.error || 'Push failed' });
        // Refresh git status so user sees the commit went through, even if push failed
        window.dispatchEvent(new CustomEvent('git-refresh'));
        return;
      }
      showToast({ type: 'success', message: '提交并推送成功' });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, committing, pushing, commitMessage, status.dirty]);

  const handlePush = useCallback(async () => {
    if (!workingDirectory || pushing) return;
    setPushing(true);
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Push failed' }));
        showToast({ type: 'error', message: data.error || 'Push failed' });
        return;
      }
      showToast({ type: 'success', message: t('git.pushSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, pushing, t]);

  const handlePull = useCallback(async () => {
    if (!workingDirectory || pulling) return;
    setPulling(true);
    try {
      const res = await fetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || t('git.pullFailed') });
        return;
      }
      showToast({ type: 'success', message: t('git.pullSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('git.pullFailed') });
    } finally {
      setPulling(false);
    }
  }, [workingDirectory, pulling, t]);

  const handleFetch = useCallback(async () => {
    if (!workingDirectory || fetching) return;
    setFetching(true);
    try {
      const res = await fetch('/api/git/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || t('git.fetchFailed') });
        return;
      }
      showToast({ type: 'success', message: t('git.fetchSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('git.fetchFailed') });
    } finally {
      setFetching(false);
    }
  }, [workingDirectory, fetching, t]);

  const handleStage = useCallback(async (paths: string[], all?: boolean) => {
    try {
      const res = await fetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, paths, all }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Stage failed');
      }
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Stage failed' });
    }
  }, [workingDirectory]);

  const handleUnstage = useCallback(async (paths: string[], all?: boolean) => {
    try {
      const res = await fetch('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, paths, all }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unstage failed');
      }
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Unstage failed' });
    }
  }, [workingDirectory]);

  const handleDiscard = useCallback(async (paths: string[]) => {
    if (!confirm(t('git.discardConfirm'))) return;
    try {
      const res = await fetch('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, paths }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Discard failed');
      }
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Discard failed' });
    }
  }, [workingDirectory, t]);

  const handleCommitSuccess = useCallback(() => {
    window.dispatchEvent(new CustomEvent('git-refresh'));
  }, []);

  if (!status.isRepo) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
        {t('git.notARepo')}
      </div>
    );
  }

  const staged = status.changedFiles.filter(f => f.staged);
  const unstaged = status.changedFiles.filter(f => !f.staged && f.status !== 'untracked');
  const untracked = status.changedFiles.filter(f => f.status === 'untracked');

  return (
    <div className="space-y-3">
      {/* Branch + upstream */}
      <div className="flex items-center gap-2 px-3">
        <GitBranch size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{status.branch || t('git.noBranch')}</span>
        {status.upstream && (
          <span className="text-[11px] text-muted-foreground truncate">
            → {status.upstream}
          </span>
        )}
      </div>

      {/* Ahead / behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="flex items-center gap-3 px-3">
          {status.ahead > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
              <ArrowUp size={12} />
              {t('git.ahead', { count: String(status.ahead) })}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-400">
              <ArrowLeft size={12} />
              {t('git.behind', { count: String(status.behind) })}
            </span>
          )}
        </div>
      )}

      {/* Staged changes */}
      {staged.length > 0 && (
        <FileGroup
          label={t('git.stagedChanges')}
          count={staged.length}
          files={staged}
          onAction={(file) => handleUnstage([file.path])}
          actionIcon={<Minus size={12} />}
          actionTitle={t('git.unstageFile')}
          onBulkAction={() => handleUnstage([], true)}
          bulkLabel={t('git.unstageAll')}
          onViewDiff={(file) => setDiffFile({ path: file.path, staged: true })}
        />
      )}

      {/* Unstaged changes */}
      {unstaged.length > 0 && (
        <FileGroup
          label={t('git.unstagedChanges')}
          count={unstaged.length}
          files={unstaged}
          onAction={(file) => handleStage([file.path])}
          actionIcon={<Plus size={12} />}
          actionTitle={t('git.stageFile')}
          onBulkAction={() => handleStage([], true)}
          bulkLabel={t('git.stageAll')}
          onDiscard={(file) => handleDiscard([file.path])}
          onViewDiff={(file) => setDiffFile({ path: file.path, staged: false })}
        />
      )}

      {/* Untracked files */}
      {untracked.length > 0 && (
        <FileGroup
          label={t('git.untrackedFiles')}
          count={untracked.length}
          files={untracked}
          onAction={(file) => handleStage([file.path])}
          actionIcon={<Plus size={12} />}
          actionTitle={t('git.stageFile')}
          onDiscard={(file) => handleDiscard([file.path])}
        />
      )}

      {/* Clean state */}
      {staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t('git.allCommitted')}
        </div>
      )}

      {/* Action buttons: Commit, Push */}
      <div className="flex flex-col gap-1.5 px-3 pt-1">
        {status.dirty ? (
          <>
            <div className="relative">
              <Textarea
                value={commitMessage}
                onChange={(e) => onCommitMessageChange(e.target.value)}
                placeholder={`提交变更内容(⌘↵ 在"${status.branch}"上)`}
                className="min-h-[32px] text-xs pr-8 py-2 resize-y"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault();
                    handleCommitAndPush();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleGenerateMessage}
                disabled={generating || !status.dirty}
                className="absolute right-2 top-2 text-emerald-500 hover:text-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="AI 生成提交说明"
              >
                {generating ? <SpinnerGap size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
              </button>
            </div>
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs w-full gap-1.5"
              onClick={handleCommitAndPush}
              disabled={committing || pushing || !status.dirty}
            >
              {committing || pushing ? <SpinnerGap size={14} className="animate-spin" /> : <CloudArrowUp size={14} />}
              {committing ? '提交中...' : pushing ? '推送中...' : '提交并推送'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs w-full gap-1.5"
              onClick={handleCommit}
              disabled={committing || pushing || !status.dirty}
            >
              {committing ? <SpinnerGap size={14} className="animate-spin" /> : <GitCommit size={14} />}
              {committing ? '提交中...' : '仅提交到本地'}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="h-8 text-xs w-full gap-1.5"
            onClick={handlePush}
            disabled={pushing || status.ahead === 0}
          >
            {pushing ? <SpinnerGap size={14} className="animate-spin" /> : <CloudArrowUp size={14} />}
            {pushing ? '推送中...' : status.ahead > 0 ? `推送到远端 (${status.ahead})` : '没有需要推送的提交'}
          </Button>
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

/* ── File group sub-component ─────────────────────────────────── */

const statusColors: Record<string, string> = {
  modified: 'text-amber-500',
  added: 'text-green-500',
  deleted: 'text-red-500',
  renamed: 'text-blue-500',
  copied: 'text-blue-500',
  untracked: 'text-muted-foreground',
};

const statusLetters: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
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
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} ({count})
        </span>
        {onBulkAction && bulkLabel && (
          <button
            onClick={onBulkAction}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {bulkLabel}
          </button>
        )}
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {files.map((file, i) => (
          <div
            key={`${file.path}-${file.staged}-${i}`}
            className="flex items-center gap-2 px-3 py-0.5 text-[12px] hover:bg-muted/50 group"
          >
            <span className={`shrink-0 font-mono ${statusColors[file.status] || 'text-muted-foreground'}`}>
              {statusLetters[file.status] || '?'}
            </span>
            {file.staged && (
              <Circle size={6} weight="fill" className="text-green-500 shrink-0" />
            )}
            <span className="truncate flex-1 text-foreground/80">{file.path}</span>
            {file.status !== 'untracked' && typeof file.additions === 'number' && (
              <span className="text-[10px] text-green-500 shrink-0 font-mono">
                +{file.additions}
              </span>
            )}
            {file.status !== 'untracked' && typeof file.deletions === 'number' && (
              <span className="text-[10px] text-red-500 shrink-0 font-mono">
                -{file.deletions}
              </span>
            )}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {onViewDiff && (
                <button
                  onClick={() => onViewDiff(file)}
                  className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                  title="Diff"
                >
                  <Eye size={12} />
                </button>
              )}
              <button
                onClick={() => onAction(file)}
                className="p-0.5 hover:bg-muted rounded text-muted-foreground"
                title={actionTitle}
              >
                {actionIcon}
              </button>
              {onDiscard && (
                <button
                  onClick={() => onDiscard(file)}
                  className="p-0.5 hover:bg-muted rounded text-red-500"
                  title="Discard"
                >
                  <Trash size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
