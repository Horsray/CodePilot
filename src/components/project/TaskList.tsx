"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, Circle, ListBullets, SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TaskItem, TaskStatus } from "@/types";

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
      <div className="rounded-lg border border-border/35 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        {t('tasks.loading')}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/35 bg-background/45 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
          <ListBullets size={13} />
          <span>任务进度</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/55">
          {t('tasks.noTasks')}
        </p>
      </div>
    );
  }

  const completed = tasks.filter((task) => task.status === "completed").length;
  const running = tasks.filter((task) => task.status === "in_progress").length;
  const progress = Math.round((completed / Math.max(tasks.length, 1)) * 100);

  return (
    <div className="overflow-hidden rounded-lg border border-border/35 bg-background/80 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.45)]">
      <div className="px-3 py-2">
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
                {completed}/{tasks.length} 已完成
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

      <div className="border-t border-border/25 px-1.5 py-1">
      {tasks.map((task) => {
        const isDone = task.status === "completed";
        const isRunning = task.status === "in_progress";
        return (
          <button
            key={task.id}
            type="button"
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-muted/35"
            onClick={() => handleToggle(task)}
          >
            {isRunning ? (
              <SpinnerGap size={14} className="shrink-0 animate-spin text-primary" />
            ) : isDone ? (
              <CheckCircle size={14} weight="fill" className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={14} className="shrink-0 text-muted-foreground/45" />
            )}
            <span
              className={cn(
                "flex-1 truncate text-xs",
                isRunning && "font-medium text-foreground/90",
                isDone && "text-muted-foreground/55 line-through"
              )}
            >
              {task.title}
            </span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
