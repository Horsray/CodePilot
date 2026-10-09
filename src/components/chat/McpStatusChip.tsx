"use client";

import { useCallback, useEffect, useState } from "react";
import { PlugsConnected, CaretDown } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// 中文注释：MCP 状态徽标 —— 显示在「参考了 N 个上下文」右侧（用户指定的位置）。
// 数据来自 /api/plugins/mcp/status（SDK 的 mcpServerStatus() 缓存/实时查询），
// 显示 就绪/总数，异常服务器可展开查看名称、状态与错误原因。
// 这样"工具失效"从此可见：是没加载、加载失败、还是需要鉴权一目了然。

interface McpServerStatusItem {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  error?: string;
}

interface McpStatusChipProps {
  sessionId?: string;
  /** 流式结束后自动刷新一次状态（本轮 init 后状态才最新） */
  isStreaming?: boolean;
  className?: string;
}

const STATUS_LABEL: Record<McpServerStatusItem["status"], string> = {
  connected: "已连接",
  failed: "连接失败",
  "needs-auth": "需要鉴权",
  pending: "启动中",
  disabled: "已禁用",
};

export function McpStatusChip({ sessionId, isStreaming, className }: McpStatusChipProps) {
  const [servers, setServers] = useState<McpServerStatusItem[] | null>(null);
  const [open, setOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const res = await fetch(`/api/plugins/mcp/status${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      const list: McpServerStatusItem[] = Array.isArray(data?.servers) ? data.servers : [];
      setServers(list.filter((s) => s.status !== "disabled"));
    } catch {
      /* best effort */
    }
  }, [sessionId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // 中文注释：流式结束后刷新 —— init 完成后 mcpServerStatus 才是本轮最新状态
  const [wasStreaming, setWasStreaming] = useState(!!isStreaming);
  useEffect(() => {
    if (isStreaming) { setWasStreaming(true); return; }
    if (wasStreaming) { setWasStreaming(false); fetchStatus(); }
  }, [isStreaming, wasStreaming, fetchStatus]);

  // 中文注释：还有服务处于「启动中」时做有限轮询（最多 8 次 / 每次 3s）。
  // SDK 的 mcpServerStatus() 是即时快照，慢启动的 npx 服务不会自己变成 connected，
  // 不轮询的话徽标会一直停在「启动中」，用户看起来还是「有问题」。
  const hasPending = !!servers?.some((s) => s.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 8) { clearInterval(timer); return; }
      fetchStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasPending, fetchStatus]);

  if (!servers || servers.length === 0) return null;

  const ready = servers.filter((s) => s.status === "connected").length;
  // 中文注释：pending 是「启动中」，不是故障。由 npx 拉起的 MCP（filesystem / github /
  // memory 等）冷启动普遍要 5~8 秒，init 采样时它们几乎必然还是 pending——旧实现把
  // pending 一起算进「异常」，于是常态显示成「MCP 14/27 · 13 异常」，让人误以为一堆服务挂了。
  // 这里把两者拆开统计：只有真正失败 / 待鉴权才算异常。
  const pending = servers.filter((s) => s.status === "pending");
  const abnormal = servers.filter((s) => s.status !== "connected" && s.status !== "pending");
  const allReady = abnormal.length === 0 && pending.length === 0;
  const expandable = abnormal.length > 0 || pending.length > 0;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        title={
          allReady
            ? `MCP 全部就绪（${ready}/${servers.length}）`
            : abnormal.length > 0
              ? "点击查看异常的 MCP 服务器"
              : "部分服务仍在启动中，点击查看"
        }
        className={cn(
          "flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] transition-colors",
          "bg-muted/30 text-muted-foreground",
          expandable ? "hover:bg-amber-500/10 cursor-pointer" : "cursor-default"
        )}
      >
        <PlugsConnected
          size={10}
          className={
            allReady
              ? "text-emerald-500"
              : abnormal.length > 0
                ? "text-amber-500"
                : "text-muted-foreground"
          }
        />
        <span>MCP {ready}/{servers.length}</span>
        {abnormal.length > 0 && (
          <span className="text-amber-500">· {abnormal.length} 异常</span>
        )}
        {pending.length > 0 && (
          <span className="text-muted-foreground/70">· {pending.length} 启动中</span>
        )}
        {expandable && (
          <CaretDown size={9} className={cn("transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && expandable && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[240px] rounded-lg border border-border bg-popover p-2 shadow-[var(--shadow-dropdown)]">
            {[...abnormal, ...pending].map((s) => (
              <div key={s.name} className="flex flex-col gap-0.5 px-1.5 py-1 rounded hover:bg-muted/40">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-foreground truncate">{s.name}</span>
                  <span className={cn(
                    "shrink-0 text-[10px]",
                    s.status === "pending" ? "text-muted-foreground" : "text-amber-500"
                  )}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                {s.error && (
                  <span className="text-[10px] text-muted-foreground/70 line-clamp-2 break-all">{s.error}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
