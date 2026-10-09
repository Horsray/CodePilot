"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash, Check, Copy, SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitStashEntry } from "@/types";

// 与 cc-haha GitStashSection 对齐：应用按钮执行 stash pop（应用并删除），
// 操作后仅刷新本列表（面板通过 10s 轮询感知外部变化），无 toast 提示。
interface GitStashSectionProps {
  cwd: string;
}

export function GitStashSection({ cwd }: GitStashSectionProps) {
  const { t } = useTranslation();
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; stash: GitStashEntry } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stash: GitStashEntry } | null>(null);
  const [copied, setCopied] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const loadStashes = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/stash?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch stashes");
      }
      const data = await res.json();
      setStashes(Array.isArray(data.stashes) ? data.stashes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取暂存列表失败");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadStashes();
  }, [loadStashes]);

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

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "save", message: message.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Stash failed");
      }
      setMessage("");
      setShowInput(false);
      await loadStashes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂存失败");
    } finally {
      setSaving(false);
    }
  }, [cwd, message, saving, loadStashes]);

  // cc-haha 语义：应用即 pop（应用并删除该 stash）
  const handlePop = useCallback(
    async (index?: number) => {
      setError(null);
      try {
        const res = await fetch("/api/git/stash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "pop", index }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Pop failed");
        }
        await loadStashes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "应用暂存失败");
      }
    },
    [cwd, loadStashes],
  );

  const handleDrop = useCallback(
    async (index: number) => {
      setError(null);
      try {
        const res = await fetch("/api/git/stash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "drop", index }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Drop failed");
        }
        await loadStashes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除暂存失败");
      }
    },
    [cwd, loadStashes],
  );

  /** 右键菜单：复制暂存信息 */
  const handleContextMenu = useCallback((e: React.MouseEvent, stash: GitStashEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, stash });
  }, []);

  const handleCopyStashInfo = useCallback(async () => {
    if (!contextMenu) return;
    const { stash } = contextMenu;
    setContextMenu(null);
    const info = `stash@{${stash.index}}: ${stash.message}\n分支: ${stash.branch}\n时间: ${stash.timestamp || "未知"}`;
    try {
      await navigator.clipboard.writeText(info);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [contextMenu]);

  /** 格式化暂存时间 */
  const formatTime = (dateStr: string): string => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const handleMouseEnter = (e: React.MouseEvent, stash: GitStashEntry) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ x: rect.left, y: rect.top - 8, stash });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <div>
      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        {showInput ? (
          <>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="输入暂存信息"
              className="flex-1 h-7 px-2 text-xs rounded border outline-none"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setShowInput(false);
                  setMessage("");
                }
              }}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 h-7 px-3 text-xs rounded font-medium shrink-0 transition-opacity hover:opacity-85 disabled:opacity-60"
              style={{ background: "var(--color-success)", color: "#fff" }}
            >
              {saving ? <SpinnerGap size={12} className="animate-spin" /> : <Plus size={12} />}
              保存
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setMessage("");
              }}
              className="h-7 px-3 text-xs rounded shrink-0 transition-colors hover:opacity-80"
              style={{
                background: "var(--color-surface-container-low)",
                color: "var(--color-text-secondary)",
              }}
            >
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-1 h-7 px-3 text-xs rounded font-medium shrink-0 transition-colors hover:opacity-80"
            style={{
              background: "var(--color-surface-container-low)",
              color: "var(--color-text-primary)",
            }}
          >
            <Plus size={12} />
            {t("git.stashAdd")}
          </button>
        )}
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="mt-2 text-xs" style={{ color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      {/* 暂存列表 */}
      {loading ? (
        <div className="mt-2 py-4 text-center">
          <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>加载中...</span>
        </div>
      ) : stashes.length === 0 ? (
        <div className="mt-2 py-4 text-center">
          <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>暂无暂存</span>
        </div>
      ) : (
        <div className="mt-1 max-h-[200px] overflow-y-auto">
          {stashes.map((stash) => (
            <div
              key={stash.index}
              className="flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors group"
              style={{ cursor: "default" }}
              onMouseEnter={(e) => handleMouseEnter(e, stash)}
              onMouseLeave={handleMouseLeave}
              onContextMenu={(e) => handleContextMenu(e, stash)}
            >
              {/* 序号 */}
              <span
                style={{ color: "var(--color-text-tertiary)" }}
                className="font-mono shrink-0"
              >
                #{stash.index}
              </span>
              {/* 暂存信息 */}
              <span
                className="truncate flex-1"
                style={{ color: "var(--color-text-primary)" }}
              >
                {stash.message || "WIP"}
              </span>
              {/* 所属分支 */}
              {stash.branch && (
                <span
                  className="text-[10px] shrink-0 px-1.5 py-0.5 rounded"
                  style={{
                    color: "var(--color-text-tertiary)",
                    background: "var(--color-surface-container-low)",
                  }}
                >
                  {stash.branch}
                </span>
              )}
              {/* 操作按钮 */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handlePop(stash.index)}
                  className="p-0.5 rounded transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-success)" }}
                  title={t("git.stashApply")}
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => handleDrop(stash.index)}
                  className="p-0.5 rounded transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-error)" }}
                  title={t("git.stashDelete")}
                >
                  <Trash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 悬浮提示 */}
      {tooltip && (
        <div
          className="fixed z-50 max-w-[280px] px-3 py-2 rounded-md border text-xs shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateY(-100%)",
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          {tooltip.stash.message && (
            <div className="mb-1">
              <span style={{ color: "var(--color-text-tertiary)" }}>{t("git.stashMessage")}：</span>
              {tooltip.stash.message}
            </div>
          )}
          {tooltip.stash.branch && (
            <div className="mb-1">
              <span style={{ color: "var(--color-text-tertiary)" }}>{t("git.stashBranch")}：</span>
              {tooltip.stash.branch}
            </div>
          )}
          {tooltip.stash.timestamp && (
            <div>
              <span style={{ color: "var(--color-text-tertiary)" }}>{t("git.stashTime")}：</span>
              {formatTime(tooltip.stash.timestamp)}
            </div>
          )}
        </div>
      )}

      {/* 右键菜单：复制暂存信息 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleCopyStashInfo}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] transition-colors"
          >
            <Copy size={12} className="text-[var(--color-text-tertiary)]" />
            {copied ? t("git.copied") : "复制暂存信息"}
          </button>
        </div>
      )}
    </div>
  );
}
