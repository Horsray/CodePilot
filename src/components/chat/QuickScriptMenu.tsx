"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Plus, Trash } from "@/components/ui/icon";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { useQuickScriptStore, type QuickScript } from "@/store/useQuickScriptStore";
import { cn } from "@/lib/utils";

/**
 * 中文注释：快捷脚本按钮 + 弹窗（移植自 cc-haha ChatInput 的 Play 菜单）——
 * 点击脚本项：关闭其他右侧面板 → 打开终端面板 → 在终端执行 `cd <dir> && bash <path>`；
 * 弹窗内支持新增 / 删除脚本（cc-haha 是在设置页管理，这里收敛到弹窗内，交互更直接）。
 */
export function QuickScriptMenu() {
  const { scripts, hydrated, hydrate, addScript, removeScript } = useQuickScriptStore();
  const { setBottomPanelOpen, setBottomPanelTab, setFileTreeOpen, setGitPanelOpen, setDashboardPanelOpen, setAssistantPanelOpen, setPreviewOpen } = usePanel();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { hydrate(); }, [hydrate]);

  // 点击弹窗外部关闭
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const runScript = (script: QuickScript) => {
    // 先打开终端，关闭其他右侧面板，避免叠加
    setFileTreeOpen(false);
    setGitPanelOpen(false);
    setDashboardPanelOpen(false);
    setAssistantPanelOpen(false);
    setPreviewOpen(false);
    setBottomPanelTab("terminal");
    setBottomPanelOpen(true);
    // 中文注释：每次执行都新建一个独立终端会话（cwd=脚本目录），脚本在干净 shell 里跑，
    // 不再复用当前会话，避免多脚本输出/历史日志挤在一起、交互式命令被干扰（对齐 cc-haha）。
    window.dispatchEvent(new CustomEvent("terminal:run-script", {
      detail: { path: script.path },
    }));
    setOpen(false);
  };

  const handleAdd = () => {
    const name = newName.trim();
    const path = newPath.trim();
    if (!name || !path) {
      showToast({ type: "error", message: "请填写脚本名称和完整路径" });
      return;
    }
    addScript(name, path);
    setNewName("");
    setNewPath("");
    setAdding(false);
  };

  // 中文注释：SSR/首帧未 hydrated 时不渲染（避免与 localStorage 数据不一致）
  if (!hydrated) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="快捷脚本"
        className={cn(
          "flex items-center justify-center rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors",
          "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
          open && "bg-[var(--surface-hover)] text-[var(--text-primary)]"
        )}
      >
        <Play size={14} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 min-w-[220px] rounded-lg border border-border bg-[var(--surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
          {scripts.length === 0 && !adding && (
            <div className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">暂无快捷脚本</div>
          )}
          {scripts.map((script) => (
            <div key={script.id} className="group/item flex items-center">
              <button
                type="button"
                onClick={() => runScript(script)}
                title={script.path}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                <Play size={12} className="shrink-0 text-[var(--text-tertiary)]" />
                <span className="truncate">{script.name}</span>
              </button>
              <button
                type="button"
                title="删除脚本"
                onClick={() => removeScript(script.id)}
                className="mr-2 hidden h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-red-500 group-hover/item:flex"
              >
                <Trash size={12} />
              </button>
            </div>
          ))}

          <div className="mt-1 border-t border-border/60 pt-1">
            {adding ? (
              <div className="flex flex-col gap-1.5 px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="脚本名称"
                  className="h-6 rounded border border-border bg-transparent px-1.5 text-[12px] outline-none focus:border-primary/60"
                />
                <input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="脚本绝对路径（.sh）"
                  className="h-6 rounded border border-border bg-transparent px-1.5 font-mono text-[11px] outline-none focus:border-primary/60"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground hover:brightness-105"
                  >
                    添加
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <Plus size={12} />
                <span>添加脚本</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
