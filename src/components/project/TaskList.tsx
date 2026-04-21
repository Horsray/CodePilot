"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, Circle, ListBullets, SpinnerGap, XCircle } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TaskItem, TaskStatus } from "@/types";
import { parseDBDate } from "@/lib/utils";

// 格式化任务完成时间（相对时间）
function formatCompletedTime(dateStr: string | undefined): string {
  if (!dateStr) return "未知时间";
  const date = parseDBDate(dateStr);
  if (isNaN(date.getTime())) return "未知时间";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHr < 24) return `${diffHr} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

interface TaskListProps {
  sessionId: string;
}

export function TaskList({ sessionId }: TaskListProps) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh when SDK TodoWrite syncs tasks
  useEffect(() => {
    const handler = () => { fetchTasks(); };
    window.addEventListener('tasks-updated', handler);
    return () => window.removeEventListener('tasks-updated', handler);
  }, [fetchTasks]);

  const handleToggle = async (task: TaskItem) => {
    const nextStatus: TaskStatus = task.status === "completed" ? "pending" : "completed";
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
      }
    } catch {
      // silently fail
    }
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="py-4 shrink-0">
        <div className="text-[13px] font-medium text-foreground/80 mb-3">待办</div>
        <div className="text-xs text-muted-foreground">
          {t('tasks.loading')}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-4 shrink-0">
        <div className="text-[13px] font-medium text-foreground/80 mb-6">待办</div>
        <div className="flex flex-col items-center justify-center pb-6 text-center">
          <div className="bg-muted/50 rounded-lg p-2 mb-3">
            <ListBullets size={20} className="text-muted-foreground/70" />
          </div>
          <p className="text-[13px] font-medium text-foreground/80 mb-1">暂无待办</p>
          <p className="text-[12px] text-muted-foreground/60">复杂任务的进展会显示在这里</p>
        </div>
      </div>
    );
  }

  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const finished = completed + failed;
  const running = tasks.filter((task) => task.status === "in_progress").length;
  const progress = Math.round((finished / Math.max(tasks.length, 1)) * 100);

  return (
    <div className="py-4 shrink-0">
      <div className="text-[13px] font-medium text-foreground/80 mb-3">待办</div>
      <div className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              {running > 0 ? <SpinnerGap size={13} className="animate-spin" /> : <ListBullets size={13} weight="bold" />}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
                任务进度
              </div>
              <div className="truncate text-[12px] text-foreground/80">
                {finished}/{tasks.length} 已处理 {failed > 0 && <span className="text-red-500/70 ml-1">({failed} 失败)</span>}
              </div>
            </div>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground/65">
            {progress}%
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
      {tasks.map((task) => {
        const isDone = task.status === "completed";
        const isRunning = task.status === "in_progress";
        const isFailed = task.status === "failed";
        return (
          <button
            key={task.id}
            type="button"
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted/35"
            onClick={() => handleToggle(task)}
          >
            {isRunning ? (
              <SpinnerGap size={14} className="shrink-0 animate-spin text-primary" />
            ) : isFailed ? (
              <XCircle size={14} weight="fill" className="shrink-0 text-red-500" />
            ) : isDone ? (
              <CheckCircle size={14} weight="fill" className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={14} className="shrink-0 text-muted-foreground/45" />
            )}
            <div className="flex flex-col min-w-0 flex-1">
              <span
                className={cn(
                  "truncate text-[13px]",
                  isRunning && "font-medium text-foreground/90",
                  isDone && "text-muted-foreground/75",
                  isFailed && "text-red-500/80 line-through"
                )}
              >
                {task.title}
              </span>
              {isDone && (
                <span className="text-[10px] text-muted-foreground/60">
                  已完成 {formatCompletedTime(task.updated_at)}
                </span>
              )}
              {isFailed && (
                <span className="text-[10px] text-red-500/60">
                  已失败 {formatCompletedTime(task.updated_at)}
                </span>
              )}
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}
