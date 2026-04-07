"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, GitCommit, CloudArrowUp, GitBranch } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface CommitDialogProps {
  cwd: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type CommitMode = "commit" | "commit-and-push";
type PushTarget = "current" | "existing" | "new";

interface BranchInfo {
  name: string;
  isRemote: boolean;
}

export function CommitDialog({ cwd, open, onClose, onSuccess }: CommitDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CommitMode>("commit");
  const [pushTarget, setPushTarget] = useState<PushTarget>("current");
  const [targetBranch, setTargetBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setError(null);
      setPushTarget("current");
      setTargetBranch("");
      setNewBranchName("");
    }
  }, [open]);

  // Fetch branches when user selects "existing branch" push target
  useEffect(() => {
    if (!open || !cwd || pushTarget !== "existing") return;
    if (branches.length > 0) return; // already loaded

    setLoadingBranches(true);
    fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branches) {
          setBranches(data.branches);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  }, [open, cwd, pushTarget, branches.length]);

  // Reset branches cache when dialog opens
  useEffect(() => {
    if (open) setBranches([]);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const getResolvedTargetBranch = useCallback((): string | undefined => {
    if (mode !== "commit-and-push") return undefined;
    if (pushTarget === "current") return undefined; // push API default
    if (pushTarget === "existing") return targetBranch || undefined;
    if (pushTarget === "new") return newBranchName.trim() || undefined;
    return undefined;
  }, [mode, pushTarget, targetBranch, newBranchName]);

  const canSubmit = useCallback((): boolean => {
    if (!message.trim()) return false;
    if (mode === "commit-and-push") {
      if (pushTarget === "existing" && !targetBranch) return false;
      if (pushTarget === "new" && !newBranchName.trim()) return false;
    }
    return true;
  }, [message, mode, pushTarget, targetBranch, newBranchName]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit() || !cwd || committing) return;
    const trimmed = message.trim();
    setCommitting(true);
    setError(null);
    try {
      // Commit
      const commitRes = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: trimmed }),
      });
      if (!commitRes.ok) {
        const data = await commitRes.json();
        throw new Error(data.error || "Commit failed");
      }

      // Push if selected
      if (mode === "commit-and-push") {
        const resolved = getResolvedTargetBranch();
        const pushBody: Record<string, string> = { cwd };
        if (resolved) pushBody.targetBranch = resolved;

        const pushRes = await fetch("/api/git/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pushBody),
        });
        if (!pushRes.ok) {
          const data = await pushRes.json();
          throw new Error(data.error || "Push failed");
        }
      }

      setMessage("");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setCommitting(false);
    }
  }, [cwd, message, mode, committing, onClose, onSuccess, canSubmit, getResolvedTargetBranch]);

  if (!open) return null;

  // Filter branches for the dropdown: show local branches only, exclude current
  const selectableBranches = branches.filter((b) => !b.isRemote);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-[420px] rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">{t('git.commitAll')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('git.commitMessage')}
            className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Mode selector */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit"}
                onChange={() => setMode("commit")}
                className="accent-primary"
              />
              <GitCommit size={14} className="text-muted-foreground" />
              {t('topBar.commit')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit-and-push"}
                onChange={() => setMode("commit-and-push")}
                className="accent-primary"
              />
              <CloudArrowUp size={14} className="text-muted-foreground" />
              {t('git.commitAndPush')}
            </label>
          </div>

          {/* Push target selector — only visible when commit-and-push */}
          {mode === "commit-and-push" && (
            <div className="ml-6 space-y-2 border-l-2 border-border/60 pl-3">
              {/* Current branch */}
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="push-target"
                  checked={pushTarget === "current"}
                  onChange={() => setPushTarget("current")}
                  className="accent-primary"
                />
                <GitBranch size={12} className="text-muted-foreground" />
                {t('git.pushToCurrentBranch')}
              </label>

              {/* Existing branch */}
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="push-target"
                  checked={pushTarget === "existing"}
                  onChange={() => setPushTarget("existing")}
                  className="accent-primary"
                />
                <GitBranch size={12} className="text-muted-foreground" />
                {t('git.pushToOtherBranch')}
              </label>
              {pushTarget === "existing" && (
                <select
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                  className="ml-5 w-[calc(100%-20px)] rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{loadingBranches ? t('git.loading') : t('git.selectBranch')}</option>
                  {selectableBranches.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              )}

              {/* New branch */}
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="push-target"
                  checked={pushTarget === "new"}
                  onChange={() => setPushTarget("new")}
                  className="accent-primary"
                />
                <GitBranch size={12} className="text-muted-foreground" />
                {t('git.pushToNewBranch')}
              </label>
              {pushTarget === "new" && (
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder={t('git.newBranchName')}
                  className="ml-5 w-[calc(100%-20px)] rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              )}
            </div>
          )}

          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit() || committing}
            onClick={handleSubmit}
          >
            {mode === "commit-and-push" ? (
              <CloudArrowUp size={14} className="mr-1.5" />
            ) : (
              <GitCommit size={14} className="mr-1.5" />
            )}
            {committing
              ? t('git.loading')
              : mode === "commit-and-push"
                ? t('git.commitAndPush')
                : t('git.commitAll')
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
