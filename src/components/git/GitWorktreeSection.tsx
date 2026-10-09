"use client";

import { useState, useEffect } from "react";
import { Folder, ArrowRight, Plus, Circle } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { GitWorktree } from "@/types";

interface GitWorktreeSectionProps {
  cwd: string;
  onDeriveWorktree: () => void;
}

export function GitWorktreeSection({ cwd, onDeriveWorktree }: GitWorktreeSectionProps) {
  const router = useRouter();
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cwd) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/worktrees?cwd=${encodeURIComponent(cwd)}`);
        const data = await res.json();
        if (!cancelled) setWorktrees(Array.isArray(data.worktrees) ? data.worktrees : []);
      } catch {
        // silently ignore fetch errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // 切换到指定工作树对应的会话（CodePilot 能力，cc-haha 此处为 TODO 仅刷新）
  const handleSwitchTo = async (worktreePath: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/by-cwd?cwd=${encodeURIComponent(worktreePath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          router.push(`/chat/${data.sessionId}`);
          return;
        }
      }
      // No existing session — create one
      const createRes = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: worktreePath }),
      });
      if (createRes.ok) {
        const data = await createRes.json();
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // fallback: just navigate to chat
    }
  };

  const isCurrent = (wt: GitWorktree): boolean => {
    if (!cwd) return false;
    const normalize = (p: string) => p.replace(/\/+$/, "");
    return normalize(wt.path) === normalize(cwd);
  };

  if (loading) {
    return (
      <div className="py-2 text-center">
        <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
      </div>
    );
  }

  if (worktrees.length === 0) {
    return (
      <div className="py-2 text-center">
        <span className="text-xs text-[var(--color-text-tertiary)]">暂无工作树</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {worktrees.map((wt) => {
        const current = isCurrent(wt);
        return (
          <div
            key={wt.path}
            className="flex items-center gap-2 px-2 py-1.5"
            style={{
              backgroundColor: current ? "var(--color-surface-container-low)" : "transparent",
            }}
          >
            <Folder
              size={14}
              className="shrink-0"
              style={{ color: current ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span
                  className="text-[12px] truncate"
                  style={{
                    color: "var(--color-text-primary)",
                    fontWeight: current ? 500 : 400,
                  }}
                >
                  {wt.branch || wt.head.substring(0, 7)}
                </span>
                {current && (
                  <span
                    className="text-[9px] rounded px-1"
                    style={{
                      color: "var(--color-text-tertiary)",
                      backgroundColor: "var(--color-surface)",
                    }}
                  >
                    当前
                  </span>
                )}
                {wt.dirty && (
                  <Circle
                    size={8}
                    fill="var(--color-warning)"
                    className="shrink-0"
                    style={{ color: "var(--color-warning)" }}
                  />
                )}
              </div>
              <p
                className="text-[10px] truncate"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {wt.path}
              </p>
            </div>
            {!current && !wt.bare && (
              <button
                className="shrink-0 p-0.5 hover:bg-[var(--color-surface)] transition-colors"
                title="切换到此"
                onClick={() => handleSwitchTo(wt.path)}
                style={{ color: "var(--color-text-tertiary)" }}
              >
                <ArrowRight size={12} />
                <span className="sr-only">切换到此</span>
              </button>
            )}
          </div>
        );
      })}

      <div className="px-2 pt-1">
        <button
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs border border-[var(--color-border)] hover:bg-[var(--color-surface-container-low)] transition-colors"
          style={{ color: "var(--color-text-secondary)" }}
          onClick={onDeriveWorktree}
        >
          <Plus size={14} />
          派生工作树
        </button>
      </div>
    </div>
  );
}
