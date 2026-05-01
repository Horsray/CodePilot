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
      <div className="py-2 shrink-0">
        <div className="text-[11px] font-medium text-foreground/80 mb-2">待办</div>
        <div className="text-[11px] text-muted-foreground">
          {t('tasks.loading')}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-2 shrink-0">
        <div className="text-[11px] font-medium text-foreground/80 mb-2">待办</div>
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div className="bg-muted/50 rounded p-1 mb-1.5">
            <ListBullets size={14} className="text-muted-foreground/70" />
          </div>
          <p className="text-[11px] font-medium text-foreground/80 mb-0.5">暂无待办</p>
          <p className="text-[10px] text-muted-foreground/60">复杂任务的进展会显示在这里</p>
        </div>
      </div>
    );
  }

  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const finished = completed + failed;
  const running = tasks.filter((task) => task.status === "in_progress").length;
  const progress = Math.round((finished / Math.max(tasks.length, 1)) * 100);

  // Find the most recently completed task to display in the header
  const lastCompletedTask = tasks
    .filter(t => t.status === "completed" && t.updated_at)
    .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())[0];

  return (
    <div className="py-2 shrink-0">
      <div className="mb-1.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              {running > 0 ? <SpinnerGap size={10} className="animate-spin" /> : <ListBullets size={10} weight="bold" />}
            </div>
            <div className="text-xs font-semibold text-foreground/90 whitespace-nowrap tracking-tight">
              任务进度
            </div>
          </div>
          <div className="font-mono text-[10px] text-primary shrink-0">
            {progress}%
          </div>
        </div>
        <div className="h-0.5 overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="text-[10px] text-muted-foreground/80 whitespace-nowrap">
            {finished}/{tasks.length} 已处理
            {failed > 0 && <span className="text-red-500/70 ml-1">({failed} 失败)</span>}
          </div>
          {lastCompletedTask && (
            <div className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
              {formatCompletedTime(lastCompletedTask.updated_at)}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
      {tasks.map((task) => {
        const isDone = task.status === "completed";
        const isRunning = task.status === "in_progress";
        const isFailed = task.status === "failed";
        return (
          <button
            key={task.id}
            type="button"
            className="flex min-h-6 w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-muted/35"
            onClick={() => handleToggle(task)}
          >
            {isRunning ? (
              <SpinnerGap size={12} className="shrink-0 animate-spin text-primary" />
            ) : isFailed ? (
              <XCircle size={12} weight="fill" className="shrink-0 text-red-500" />
            ) : isDone ? (
              <CheckCircle size={12} weight="fill" className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={12} className="shrink-0 text-muted-foreground/45" />
            )}
            <div className="flex items-center min-w-0 flex-1">
              <span
                className={cn(
                  "truncate text-[12px]",
                  isRunning && "font-medium text-foreground/90",
                  isDone && "text-muted-foreground/75",
                  isFailed && "text-red-500/80 line-through"
                )}
              >
                {task.title}
              </span>
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}