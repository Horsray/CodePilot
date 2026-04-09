"use client";

import { useState, useCallback, useEffect } from "react";
import { X, CloudArrowUp, GitBranch, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface PushDialogProps {
  cwd: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type PushTarget = "current" | "existing" | "new";

interface BranchInfo {
  name: string;
  isRemote: boolean;
}

export function PushDialog({ cwd, open, onClose, onSuccess }: PushDialogProps) {
  const { t } = useTranslation();
  const [pushTarget, setPushTarget] = useState<PushTarget>("current");
  const [targetBranch, setTargetBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setError(null);
      setPushTarget("current");
      setTargetBranch("");
      setNewBranchName("");
      setBranches([]);
    }
  }, [open]);

  // Fetch branches when user selects "existing branch"
  useEffect(() => {
    if (!open || !cwd || pushTarget !== "existing") return;
    if (branches.length > 0) return;

    setLoadingBranches(true);
    fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branches) setBranches(data.branches);
      })
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  }, [open, cwd, pushTarget, branches.length]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const canSubmit = useCallback((): boolean => {
    if (pushTarget === "existing" && !targetBranch) return false;
    if (pushTarget === "new" && !newBranchName.trim()) return false;
    return true;
  }, [pushTarget, targetBranch, newBranchName]);

  const handlePush = useCallback(async () => {
    if (!cwd || pushing || !canSubmit()) return;
    setPushing(true);
    setError(null);
    try {
      const body: Record<string, string> = { cwd };
      if (pushTarget === "existing" && targetBranch) {
        body.targetBranch = targetBranch;
      } else if (pushTarget === "new" && newBranchName.trim()) {
        body.targetBranch = newBranchName.trim();
      }

      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Push failed" }));
        throw new Error(data.error || "Push failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }, [cwd, pushing, pushTarget, targetBranch, newBranchName, canSubmit, onClose, onSuccess]);

  if (!open) return null;

  const localBranches = branches.filter((b) => !b.isRemote);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-[380px] rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CloudArrowUp size={16} />
            {t('git.push')}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* Current branch */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="push-target"
              checked={pushTarget === "current"}
              onChange={() => setPushTarget("current")}
              className="accent-primary"
            />
            <GitBranch size={14} className="text-muted-foreground" />
            {t('git.pushToCurrentBranch')}
          </label>

          {/* Existing branch */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="push-target"
              checked={pushTarget === "existing"}
              onChange={() => setPushTarget("existing")}
              className="accent-primary"
            />
            <GitBranch size={14} className="text-muted-foreground" />
            {t('git.pushToOtherBranch')}
          </label>
          {pushTarget === "existing" && (
            <select
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="ml-6 w-[calc(100%-24px)] rounded-md border border-input bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">
                {loadingBranches ? t('git.loading') : t('git.selectBranch')}
              </option>
              {localBranches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          )}

          {/* New branch */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="push-target"
              checked={pushTarget === "new"}
              onChange={() => setPushTarget("new")}
              className="accent-primary"
            />
            <GitBranch size={14} className="text-muted-foreground" />
            {t('git.pushToNewBranch')}
          </label>
          {pushTarget === "new" && (
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={t('git.newBranchName')}
              className="ml-6 w-[calc(100%-24px)] rounded-md border border-input bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handlePush();
                }
              }}
            />
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
            disabled={!canSubmit() || pushing}
            onClick={handlePush}
          >
            {pushing ? (
              <SpinnerGap size={14} className="mr-1.5 animate-spin" />
            ) : (
              <CloudArrowUp size={14} className="mr-1.5" />
            )}
            {pushing ? t('git.loading') : t('git.push')}
          </Button>
        </div>
      </div>
    </div>
  );
}
