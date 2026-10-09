"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Lock, Check, X, Trash, Copy } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitBranch as GitBranchType } from "@/types";

interface GitBranchSelectorProps {
  cwd: string;
  currentBranch: string;
  dirty: boolean;
  onCheckout: (branch: string) => Promise<void>;
  error?: string | null;
}

/** 将 ISO 时间转为相对时间描述（与 cc-haha 一致，分钟级带空格） */
function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffHour < 24) return `${diffHour} 小时前`;
    if (diffDay < 30) return `${diffDay} 天前`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function GitBranchSelector({ cwd, currentBranch, dirty, onCheckout, error }: GitBranchSelectorProps) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // 新建分支状态
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branch: GitBranchType } | null>(null);
  const [copied, setCopied] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 直接加载分支列表
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
        const data = await res.json();
        if (!cancelled) setBranches(Array.isArray(data.branches) ? data.branches : []);
      } catch {
        if (!cancelled) setLocalError("获取分支列表失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // 外部变更（提交、切换等）后刷新分支列表
  useEffect(() => {
    const handler = () => {
      void (async () => {
        try {
          const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
          const data = await res.json();
          setBranches(Array.isArray(data.branches) ? data.branches : []);
        } catch {
          // ignore
        }
      })();
    };
    window.addEventListener("git-refresh", handler);
    return () => window.removeEventListener("git-refresh", handler);
  }, [cwd]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  const handleCheckout = async (branch: string) => {
    if (dirty || branch === currentBranch || checkingOut) return;
    setCheckingOut(branch);
    setLocalError(null);
    try {
      await onCheckout(branch);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "切换分支失败");
    } finally {
      setCheckingOut(null);
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name || !cwd || creating) return;
    if (!/^[\w.\-/]+$/.test(name)) {
      setLocalError("无效的分支名称");
      return;
    }
    setCreating(true);
    setLocalError(null);
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, branch: name, create: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to create branch" }));
        throw new Error(data.error || "Failed to create branch");
      }
      setNewBranchName("");
      setShowNewBranch(false);
      window.dispatchEvent(new CustomEvent("git-refresh"));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "创建分支失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBranch = useCallback(
    async (branch: GitBranchType) => {
      setContextMenu(null);
      if (!confirm(`确定要删除分支 "${branch.name}" 吗？`)) return;
      try {
        const res = await fetch(
          `/api/git/branches?cwd=${encodeURIComponent(cwd)}&branch=${encodeURIComponent(branch.name)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to delete branch" }));
          throw new Error(data.error || "Failed to delete branch");
        }
        // 刷新列表
        const refreshRes = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
        const data = await refreshRes.json();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "删除分支失败");
      }
    },
    [cwd],
  );

  const handleCopyBranchId = useCallback(async (branch: GitBranchType) => {
    setContextMenu(null);
    if (!branch.commitSha) return;
    try {
      await navigator.clipboard.writeText(branch.commitSha);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, branch: GitBranchType) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, branch });
  }, []);

  const localBranches = branches.filter((b) => !b.isRemote);

  if (loading) {
    return (
      <div className="py-2 text-center">
        <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {(error || localError) && (
        <p className="px-1 text-[11px] text-[var(--color-error)]">{error || localError}</p>
      )}

      {/* 不能切换分支的原因提示 */}
      {dirty && !localError && (
        <div className="px-1 py-1 text-[11px] text-[var(--color-warning)]">
          工作区有未提交的更改，请先提交或暂存后再切换分支
        </div>
      )}

      {/* 新建分支 */}
      {showNewBranch ? (
        <div className="px-1 py-1.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="输入分支名称"
              className="h-7 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-tertiary)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateBranch();
                if (e.key === "Escape") {
                  setShowNewBranch(false);
                  setNewBranchName("");
                }
              }}
            />
            <button
              onClick={() => {
                setShowNewBranch(false);
                setNewBranchName("");
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
              aria-label="取消"
            >
              <X size={12} />
            </button>
            <button
              onClick={handleCreateBranch}
              disabled={!newBranchName.trim() || creating}
              className="flex h-7 items-center rounded-md bg-[var(--color-brand)] px-3 text-xs text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              创建
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewBranch(true)}
          className="flex items-center gap-2 w-full px-1 py-1.5 text-[12px] text-left text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)] transition-colors rounded"
        >
          <Plus size={14} />
          新建分支
        </button>
      )}

      {/* 分支列表 */}
      <div className="max-h-[200px] overflow-y-auto">
        {localBranches.length === 0 ? (
          <div className="p-2 text-[11px] text-[var(--color-text-tertiary)]">暂无分支</div>
        ) : (
          localBranches.map((branch) => {
            const isCurrent = branch.name === currentBranch;
            const isOccupied = !!branch.worktreePath && !isCurrent;
            const disabled = dirty || isOccupied || isCurrent;

            return (
              <button
                key={branch.name}
                onClick={() => handleCheckout(branch.name)}
                onContextMenu={(e) => handleContextMenu(e, branch)}
                disabled={disabled || checkingOut !== null}
                className="flex items-center gap-2 w-full px-1 py-1.5 text-[12px] text-left hover:bg-[var(--color-surface-container-low)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                {isCurrent ? (
                  <Check size={12} className="text-[var(--color-success)] shrink-0" />
                ) : isOccupied ? (
                  <Lock size={12} className="text-[var(--color-text-tertiary)] shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span
                  className={`truncate flex-1 ${isCurrent ? "text-[var(--color-brand)] font-medium" : "text-[var(--color-text-primary)]"}`}
                >
                  {branch.name}
                </span>
                {isOccupied && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">已占用</span>
                )}
                {dirty && !isCurrent && !isOccupied && (
                  <span className="text-[10px] text-amber-500 shrink-0">工作区有改动</span>
                )}
                {branch.lastCommitDate && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0 ml-auto">
                    {formatRelativeTime(branch.lastCommitDate)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleCopyBranchId(contextMenu.branch)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] transition-colors"
          >
            <Copy size={12} className="text-[var(--color-text-tertiary)]" />
            {copied ? t("git.copied") : t("git.copyBranchId")}
          </button>
          {contextMenu.branch.name !== currentBranch && (
            <button
              onClick={() => handleDeleteBranch(contextMenu.branch)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-[var(--color-error)] hover:bg-[var(--color-surface-container-low)] transition-colors"
            >
              <Trash size={12} />
              {t("git.deleteBranch")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
