"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CaretDown,
  CaretRight,
  GitBranch,
  ClockCounterClockwise,
  Package,
  Folder,
  SpinnerGap,
} from "@/components/ui/icon";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useGitBranches } from "@/hooks/useGitBranches";
import { useGitLog } from "@/hooks/useGitLog";
import { useGitWorktrees } from "@/hooks/useGitWorktrees";
import { useGitStash } from "@/hooks/useGitStash";
import { GitStatusSection } from "./GitStatusSection";
import { GitBranchSelector } from "./GitBranchSelector";
import { GitHistorySection } from "./GitHistorySection";
import { GitStashSection } from "./GitStashSection";
import { GitWorktreeSection } from "./GitWorktreeSection";
import { GitCommitDetailDialog } from "./GitCommitDetailDialog";
import { DeriveWorktreeDialog } from "./DeriveWorktreeDialog";
import { ProjectContextChip } from "./ProjectContextChip";

type CollapsibleSection = "branches" | "history" | "stash" | "worktrees";

// 分区配置与 cc-haha 完全一致（labelKey / 图标 / 回退文案）
const SECTION_CONFIG: Array<{
  key: CollapsibleSection;
  labelKey: string;
  fallback: string;
  icon: React.ElementType;
}> = [
  { key: "branches", labelKey: "git.branchSwitch", fallback: "切换分支", icon: GitBranch },
  { key: "history", labelKey: "git.commitHistory", fallback: "提交历史", icon: ClockCounterClockwise },
  { key: "stash", labelKey: "git.stashTitle", fallback: "快照暂存", icon: Package },
  { key: "worktrees", labelKey: "工作树", fallback: "工作树", icon: Folder },
];

export function GitPanel() {
  const { workingDirectory, sessionId } = usePanel();
  const { t } = useTranslation();
  const { status, refresh } = useGitStatus(workingDirectory);
  const { branches, fetch: fetchBranches } = useGitBranches(workingDirectory);
  const { entries: gitLog, fetch: fetchLog } = useGitLog(workingDirectory);
  const { worktrees, fetch: fetchWorktrees } = useGitWorktrees(workingDirectory);
  const { stashes, fetch: fetchStashes } = useGitStash(workingDirectory);

  const [expandedSections, setExpandedSections] = useState<Set<CollapsibleSection>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [loading, setLoading] = useState(true);

  // 中文注释：功能名称「提交信息状态提升」，用法是将 commitMessage 从 GitStatusSection 提升到 GitPanel，
  // 避免 GitStatusSection 因 status 变更导致的条件渲染卸载而丢失生成结果。
  const [commitMessage, setCommitMessage] = useState("");

  // Dialogs
  const [commitDetailSha, setCommitDetailSha] = useState<string | null>(null);
  const [showDeriveDialog, setShowDeriveDialog] = useState(false);

  // 拉取分区计数数据（分支/历史/储藏/工作树），与 cc-haha 的 fetchGitData 对齐
  const fetchCounts = useCallback(async () => {
    await Promise.allSettled([fetchBranches(), fetchLog(), fetchWorktrees(), fetchStashes()]);
  }, [fetchBranches, fetchLog, fetchWorktrees, fetchStashes]);

  // 初始化获取数据
  useEffect(() => {
    void fetchCounts().finally(() => setLoading(false));
    // fetchCounts 引用稳定，仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每 10 秒轮询，仅在页面可见时（对齐 cc-haha 行为）
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => void fetchCounts(), 10000);
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchCounts();
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") {
      startPolling();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchCounts]);

  // 监听子组件的 git-refresh 事件，刷新全部分区数据
  useEffect(() => {
    const handler = () => void fetchCounts();
    window.addEventListener("git-refresh", handler);
    return () => window.removeEventListener("git-refresh", handler);
  }, [fetchCounts]);

  const toggleSection = (section: CollapsibleSection) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // 刷新（含 loading 态），对齐 cc-haha handleRefresh
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([refresh(), fetchCounts()]);
    setLoading(false);
  }, [refresh, fetchCounts]);

  const handleCheckout = useCallback(
    async (branch: string) => {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory, branch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Checkout failed" }));
        throw new Error(data.error || "Checkout failed");
      }
      await handleRefresh();
    },
    [workingDirectory, handleRefresh],
  );

  const handleFetch = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const res = await fetch("/api/git/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) throw new Error("Fetch failed");
      await handleRefresh();
    } catch (err) {
      console.error("Fetch failed:", err);
    } finally {
      setFetching(false);
    }
  }, [fetching, workingDirectory, handleRefresh]);

  const handlePull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const res = await fetch("/api/git/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) throw new Error("Pull failed");
      await handleRefresh();
    } catch (err) {
      console.error("Pull failed:", err);
    } finally {
      setPulling(false);
    }
  }, [pulling, workingDirectory, handleRefresh]);

  const repoName = workingDirectory.split("/").pop() || "";

  // 中文注释：功能名称「Git 面板首屏加载保护」，用法是仅在首次还没有任何状态时展示连接中，后续轮询刷新期间保留当前表单和生成结果。
  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground p-4">
        {t("git.connecting")}
      </div>
    );
  }

  if (!status.isRepo) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground p-4">
        {t("git.notARepo")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] overflow-hidden rounded-lg">
      {/* Header: Badge + Branch info + Fetch/Pull */}
      <div className="flex flex-col gap-2 py-3 px-4 border-b border-[var(--color-border)]/50">
        <div className="flex justify-center">
          <ProjectContextChip
            workDir={workingDirectory}
            repoName={repoName}
            branch={status.branch}
            compact
          />
        </div>
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
          <span className="text-sm font-medium truncate text-[var(--color-text-primary)]">
            {status.upstream || status.branch || t("git.noBranch")}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={handleFetch}
              disabled={fetching}
              className="text-[10px] px-1.5 py-0.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50"
              title={t("git.fetch")}
            >
              {fetching ? <SpinnerGap size={12} className="animate-spin" /> : t("git.fetch")}
            </button>
            <button
              onClick={handlePull}
              disabled={pulling}
              className="text-[10px] px-1.5 py-0.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50"
              title={t("git.pull")}
            >
              {pulling ? <SpinnerGap size={12} className="animate-spin" /> : t("git.pull")}
            </button>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          // 中文注释：初始/刷新加载中显示明确的中间态，避免空 section 标题让人误以为卡住。
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <SpinnerGap size={18} className="animate-spin text-[var(--color-text-tertiary)]" />
            <span className="text-xs text-[var(--color-text-tertiary)]">{t("git.refreshingData")}</span>
          </div>
        ) : (
          <>
            {/* Status content (always visible, not collapsible) */}
            {status && (
              <div className="px-4 pb-3 pt-3 border-b border-[var(--color-border)]/50">
                <GitStatusSection
                  status={status}
                  commitMessage={commitMessage}
                  onCommitMessageChange={setCommitMessage}
                />
              </div>
            )}

            {SECTION_CONFIG.map(({ key, labelKey, fallback, icon: IconComponent }) => {
              const isExpanded = expandedSections.has(key);

              return (
                <div key={key} className="border-b border-[var(--color-border)]/50 last:border-b-0">
                  {/* 区域标题 */}
                  <button
                    onClick={() => toggleSection(key)}
                    className="flex items-center w-full gap-2 px-4 py-3 hover:bg-[var(--color-surface-container-low)]/70 transition-all duration-200"
                  >
                    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]">
                      {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    </span>
                    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-brand)]/10">
                      <IconComponent size={14} className="text-[var(--color-brand)]" />
                    </span>
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {(t as (k: string) => string)(labelKey) || fallback}
                    </span>
                    {key === "branches" && branches.length > 0 && (
                      <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-brand)]/20 text-[10px] font-medium text-[var(--color-brand)]">
                        {branches.filter((b) => !b.isRemote).length}
                      </span>
                    )}
                    {key === "history" && gitLog.length > 0 && (
                      <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-surface-container-low)] text-[10px] font-medium text-[var(--color-text-tertiary)]">
                        {gitLog.length}
                      </span>
                    )}
                    {key === "stash" && stashes.length > 0 && (
                      <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-warning)]/20 text-[10px] font-medium text-[var(--color-warning)]">
                        {stashes.length}
                      </span>
                    )}
                    {key === "worktrees" && worktrees.length > 0 && (
                      <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-surface-container-low)] text-[10px] font-medium text-[var(--color-text-tertiary)]">
                        {worktrees.length}
                      </span>
                    )}
                  </button>

                  {/* 区域内容 */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {loading && (
                        <div className="py-6 text-center">
                          <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
                        </div>
                      )}
                      {!loading && key === "branches" && (
                        <GitBranchSelector
                          cwd={workingDirectory}
                          currentBranch={status.branch}
                          dirty={status.dirty}
                          onCheckout={handleCheckout}
                        />
                      )}
                      {!loading && key === "history" && (
                        <GitHistorySection cwd={workingDirectory} onSelectCommit={setCommitDetailSha} />
                      )}
                      {!loading && key === "stash" && (
                        <GitStashSection cwd={workingDirectory} />
                      )}
                      {!loading && key === "worktrees" && (
                        <GitWorktreeSection cwd={workingDirectory} onDeriveWorktree={() => setShowDeriveDialog(true)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* 提交详情弹窗 */}
      {commitDetailSha && (
        <GitCommitDetailDialog
          cwd={workingDirectory}
          sha={commitDetailSha}
          onClose={() => setCommitDetailSha(null)}
        />
      )}

      {/* 派生工作树弹窗 */}
      {showDeriveDialog && (
        <DeriveWorktreeDialog
          cwd={workingDirectory}
          repoName={repoName}
          sessionId={sessionId}
          onClose={() => setShowDeriveDialog(false)}
        />
      )}
    </div>
  );
}
