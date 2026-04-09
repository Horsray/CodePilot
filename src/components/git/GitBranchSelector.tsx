"use client";

import { useState, useEffect } from "react";
import { GitBranch, Check, Lock, Plus, X } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import type { GitBranch as GitBranchType } from "@/types";

interface GitBranchSelectorProps {
  cwd: string;
  currentBranch: string;
  dirty: boolean;
  onCheckout: (branch: string) => Promise<void>;
  error?: string | null;
}

export function GitBranchSelector({ cwd, currentBranch, dirty, onCheckout, error }: GitBranchSelectorProps) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // New branch creation state
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isOpen || !cwd) return;
    setLoading(true);
    fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`)
      .then(res => res.json())
      .then(data => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, cwd]);

  const handleCheckout = async (branch: string) => {
    if (dirty || branch === currentBranch) return;
    setCheckingOut(branch);
    setLocalError(null);
    try {
      await onCheckout(branch);
      setIsOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckingOut(null);
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name || !cwd || creating) return;

    // Validate branch name
    if (!/^[\w.\-/]+$/.test(name)) {
      showToast({ type: 'error', message: 'Invalid branch name' });
      return;
    }

    setCreating(true);
    setLocalError(null);
    try {
      const res = await fetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, branch: name, create: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to create branch' }));
        throw new Error(data.error || 'Failed to create branch');
      }
      showToast({ type: 'success', message: `Branch "${name}" created` });
      setNewBranchName("");
      setShowNewBranch(false);
      setIsOpen(false);
      // Refresh will be triggered by parent
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setCreating(false);
    }
  };

  const localBranches = branches.filter(b => !b.isRemote);

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-xs"
        onClick={() => setIsOpen(!isOpen)}
      >
        <GitBranch size={14} className="mr-1.5" />
        {t('git.branchSelector')}
      </Button>

      {(error || localError) && (
        <p className="px-3 text-[11px] text-destructive">{error || localError}</p>
      )}

      {isOpen && (
        <div className="border rounded-md bg-background">
          {/* Create new branch input */}
          {showNewBranch ? (
            <div className="p-2 border-b space-y-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder={t('git.newBranchName')}
                  className="h-7 text-xs flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateBranch();
                    if (e.key === 'Escape') {
                      setShowNewBranch(false);
                      setNewBranchName("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setShowNewBranch(false);
                    setNewBranchName("");
                  }}
                >
                  <X size={12} />
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim() || creating}
                >
                  {creating ? t('git.loading') : t('git.createNewRepo')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left hover:bg-muted/50 text-muted-foreground"
              onClick={() => setShowNewBranch(true)}
            >
              <Plus size={14} />
              {t('git.createNewRepo')}
            </button>
          )}

          {/* Branch list */}
          <div className="max-h-[200px] overflow-y-auto">
            {loading ? (
              <div className="p-2 text-[11px] text-muted-foreground">{t('git.loading')}</div>
            ) : (
              localBranches.map(branch => {
                const isCurrent = branch.name === currentBranch;
                const isOccupied = !!branch.worktreePath && !isCurrent;
                const disabled = dirty || isOccupied || isCurrent;

                return (
                  <button
                    key={branch.name}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={disabled || checkingOut !== null}
                    onClick={() => handleCheckout(branch.name)}
                  >
                    {isCurrent && <Check size={12} className="text-green-500 shrink-0" />}
                    {isOccupied && <Lock size={12} className="text-muted-foreground shrink-0" />}
                    {!isCurrent && !isOccupied && <span className="w-3 shrink-0" />}
                    <span className="truncate">{branch.name}</span>
                    {isOccupied && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        {t('git.worktreeOccupied')}
                      </span>
                    )}
                    {dirty && !isCurrent && !isOccupied && (
                      <span className="ml-auto text-[10px] text-amber-500 shrink-0">
                        {t('git.dirtyWorkTree')}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
