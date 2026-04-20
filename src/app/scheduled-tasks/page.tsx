"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Timer,
  ArrowClockwise,
  Plus,
  Play,
  Pause,
  Trash,
  Lightning,
  CheckCircle,
  XCircle,
  Circle,
  Clock,
  WarningCircle,
  CaretDown,
  CaretRight,
  SpinnerGap,
  Info,
  Calendar,
  BellSimple,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ScheduledTask } from "@/types";

type FilterStatus = "all" | "active" | "paused" | "completed" | "disabled";

interface TaskRunLog {
  id: string;
  task_id: string;
  status: string;
  result?: string;
  error?: string;
  duration_ms?: number;
  created_at: string;
}

// ── Task card ────────────────────────────────────────────────
function TaskCard({
  task,
  onPause,
  onResume,
  onDelete,
  onRun,
  onShowLogs,
  expanded,
}: {
  task: ScheduledTask;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onRun: () => void;
  onShowLogs: () => void;
  expanded: boolean;
}) {
  const { t } = useTranslation();

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    active: { label: t('scheduledTasks.active'), color: "text-green-500 bg-green-500/10", icon: <Circle size={10} weight="fill" /> },
    paused: { label: t('scheduledTasks.paused'), color: "text-yellow-500 bg-yellow-500/10", icon: <Pause size={10} /> },
    completed: { label: t('scheduledTasks.completed'), color: "text-blue-500 bg-blue-500/10", icon: <CheckCircle size={10} /> },
    disabled: { label: t('scheduledTasks.disabled'), color: "text-muted-foreground bg-muted/30", icon: <XCircle size={10} /> },
    running: { label: t('scheduledTasks.running'), color: "text-purple-500 bg-purple-500/10", icon: <SpinnerGap size={10} className="animate-spin" /> },
  };

  const cfg = statusConfig[task.last_status || task.status] || statusConfig[task.status];

  const formatTime = (iso: string | undefined) => {
    if (!iso) return t('scheduledTasks.never');
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = d.getTime() - now.getTime();
      if (diff < 0) return `已过期 ${Math.abs(Math.floor(diff / 60000))} 分钟`;
      if (diff < 60000) return "即将执行";
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟后`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时后`;
      return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  const formatDuration = (ms: number | undefined) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const scheduleLabel: Record<string, string> = {
    once: t('scheduledTasks.scheduleOnce'),
    interval: t('scheduledTasks.scheduleInterval'),
    cron: t('scheduledTasks.scheduleCron'),
  };

  return (
    <div className="rounded-xl border border-border/50 bg-background hover:border-border transition-all overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onShowLogs}>
        <button className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        </button>
        <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", cfg.color)}>
          {cfg.icon}
          {cfg.label}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold truncate">{task.name}</h4>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock size={10} />
              {scheduleLabel[task.schedule_type]} · {task.schedule_value}
            </span>
            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
              <Calendar size={10} />
              {t('scheduledTasks.nextRun')}: {formatTime(task.next_run)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.status === "active" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-yellow-500" onClick={(e) => { e.stopPropagation(); onPause(); }} title={t('scheduledTasks.pause')}>
                <Pause size={14} />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={(e) => { e.stopPropagation(); onRun(); }} title={t('scheduledTasks.runNow')}>
                <Play size={14} />
              </Button>
            </>
          )}
          {task.status === "paused" && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-green-500 gap-1 text-[11px]" onClick={(e) => { e.stopPropagation(); onResume(); }}>
              <Play size={12} /> {t('scheduledTasks.resume')}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500" onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('scheduledTasks.delete')}>
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {/* Error / result summary */}
      {task.last_status === "error" && task.last_error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <p className="text-[11px] text-red-400 font-medium flex items-center gap-1.5">
            <WarningCircle size={12} />
            {t('scheduledTasks.lastError')}: {task.last_error.slice(0, 120)}{task.last_error.length > 120 ? "…" : ""}
          </p>
          {task.consecutive_errors > 0 && (
            <p className="text-[10px] text-red-400/60 mt-0.5">
              {t('scheduledTasks.consecutiveErrors')}: {task.consecutive_errors}
            </p>
          )}
        </div>
      )}

      {task.last_status === "success" && task.last_result && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
          <p className="text-[11px] text-green-400/80 line-clamp-2">
            {task.last_result.slice(0, 200)}{task.last_result.length > 200 ? "…" : ""}
          </p>
        </div>
      )}

      {/* Last run info */}
      <div className="mx-4 mb-3 flex items-center gap-4 text-[10px] text-muted-foreground/60">
        {task.last_run && (
          <span>{t('scheduledTasks.lastRun')}: {new Date(task.last_run).toLocaleString("zh-CN")}</span>
        )}
        {task.last_status && (
          <span className={cn(
            "flex items-center gap-1",
            task.last_status === "success" && "text-green-500",
            task.last_status === "error" && "text-red-500"
          )}>
            {task.last_status === "success" ? <CheckCircle size={10} /> : task.last_status === "error" ? <XCircle size={10} /> : <Circle size={10} />}
            {task.last_status}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────
function CreateTaskDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState<"once" | "interval" | "cron">("interval");
  const [intervalValue, setIntervalValue] = useState("30m");
  const [cronValue, setCronValue] = useState("0 9 * * *");
  const [onceValue, setOnceValue] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      // Calculate schedule_value
      let scheduleValue = "";
      if (scheduleType === "interval") {
        scheduleValue = intervalValue;
      } else if (scheduleType === "cron") {
        scheduleValue = cronValue;
      } else {
        if (!onceValue) {
          setError("请选择执行时间");
          setSubmitting(false);
          return;
        }
        scheduleValue = onceValue;
      }

      const res = await fetch("/api/tasks/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          priority,
          notify_on_complete: notifyOnComplete ? 1 : 0,
          working_directory: workingDirectory || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "创建失败");
        return;
      }

      onCreated();
      onClose();
      // Reset form
      setName("");
      setPrompt("");
      setIntervalValue("30m");
      setCronValue("0 9 * * *");
      setOnceValue("");
      setPriority("normal");
      setNotifyOnComplete(true);
      setWorkingDirectory("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border/50 rounded-2xl shadow-2xl w-[520px] max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Timer size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">{t('scheduledTasks.createTask')}</h2>
              <p className="text-xs text-muted-foreground">{t('scheduledTasks.description')}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-8 h-8 p-0" onClick={onClose}>
            <Trash size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {/* Task name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.taskName')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('scheduledTasks.taskNamePlaceholder')}
              className="h-9"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.prompt')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('scheduledTasks.promptPlaceholder')}
              className="w-full h-24 px-3 py-2 text-sm bg-muted/20 border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50"
            />
          </div>

          {/* Schedule type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.scheduleType')}</label>
            <div className="flex bg-muted/20 rounded-lg p-1 border border-border/50 gap-1">
              {(["once", "interval", "cron"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setScheduleType(type)}
                  className={cn(
                    "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all",
                    scheduleType === type
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {type === "once" && t('scheduledTasks.scheduleOnce')}
                  {type === "interval" && t('scheduledTasks.scheduleInterval')}
                  {type === "cron" && t('scheduledTasks.scheduleCron')}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule value */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.scheduleValue')}</label>
            {scheduleType === "interval" && (
              <Input
                value={intervalValue}
                onChange={(e) => setIntervalValue(e.target.value)}
                placeholder={t('scheduledTasks.intervalPlaceholder')}
                className="h-9"
              />
            )}
            {scheduleType === "cron" && (
              <Input
                value={cronValue}
                onChange={(e) => setCronValue(e.target.value)}
                placeholder={t('scheduledTasks.cronPlaceholder')}
                className="h-9 font-mono"
              />
            )}
            {scheduleType === "once" && (
              <Input
                type="datetime-local"
                value={onceValue}
                onChange={(e) => setOnceValue(e.target.value)}
                className="h-9"
              />
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.priority')}</label>
            <div className="flex bg-muted/20 rounded-lg p-1 border border-border/50 gap-1">
              {(["low", "normal", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all",
                    priority === p
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p === "low" && t('scheduledTasks.priorityLow')}
                  {p === "normal" && t('scheduledTasks.priorityNormal')}
                  {p === "urgent" && t('scheduledTasks.priorityUrgent')}
                </button>
              ))}
            </div>
          </div>

          {/* Working directory */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('scheduledTasks.workingDirectory')}</label>
            <Input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="/Users/xxx/Projects/myproject"
              className="h-9"
            />
          </div>

          {/* Notify on complete */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnComplete}
              onChange={(e) => setNotifyOnComplete(e.target.checked)}
              className="w-4 h-4 rounded border-border/50 accent-primary"
            />
            <span className="text-xs">{t('scheduledTasks.notifyOnComplete')}</span>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/50">
          <Button variant="outline" size="sm" onClick={onClose} className="h-9">
            {t('scheduledTasks.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !prompt.trim()}
            className="h-9 gap-2 bg-primary hover:bg-primary/90"
          >
            {submitting ? <SpinnerGap size={14} className="animate-spin" /> : <Lightning size={14} />}
            {t('scheduledTasks.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Log panel ────────────────────────────────────────────────
function LogPanel({ taskId, taskName }: { taskId: string; taskName: string }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<TaskRunLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    fetch(`/api/tasks/${taskId}/logs?limit=30`)
      .then((r) => r.json())
      .then((data) => setLogs(data.logs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  const formatDuration = (ms: number | undefined) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/10 shrink-0">
        <Clock size={14} className="text-primary" />
        <span className="text-xs font-semibold">{t('scheduledTasks.executionLogs')}</span>
        <span className="text-[10px] text-muted-foreground/60">— {taskName}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{logs.length} 条记录</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center opacity-40">
            <Info size={24} className="mb-2" />
            <p className="text-xs">{t('scheduledTasks.noLogs')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {log.status === "success" ? (
                      <span className="text-[10px] text-green-500 font-bold flex items-center gap-1">
                        <CheckCircle size={11} /> {t('scheduledTasks.logSuccess')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-500 font-bold flex items-center gap-1">
                        <XCircle size={11} /> {t('scheduledTasks.logFailed')}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60">
                    {formatDuration(log.duration_ms)}
                  </span>
                </div>
                {log.error && (
                  <div className="mt-1 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20">
                    <p className="text-[10px] text-red-400 whitespace-pre-wrap break-all">{log.error}</p>
                  </div>
                )}
                {log.result && (
                  <p className="mt-1 text-[10px] text-muted-foreground/80 whitespace-pre-wrap break-all line-clamp-3">
                    {log.result}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────
export default function ScheduledTasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/list");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    // Poll every 15s to refresh task status
    const interval = setInterval(fetchTasks, 15000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handlePause = async (id: string) => {
    await fetch(`/api/tasks/${id}/pause`, { method: "POST" });
    fetchTasks();
  };

  const handleResume = async (id: string) => {
    await fetch(`/api/tasks/${id}/pause`, { method: "POST" });
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('scheduledTasks.confirmDelete'))) return;
    setDeletingId(id);
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setDeletingId(null);
    setExpandedId(null);
    fetchTasks();
  };

  const handleRun = async (id: string) => {
    await fetch(`/api/tasks/${id}/run`, { method: "POST" });
    // Short delay then refresh
    setTimeout(fetchTasks, 1000);
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter === "all") return true;
    return task.status === filter;
  });

  const stats = {
    active: tasks.filter((t) => t.status === "active").length,
    paused: tasks.filter((t) => t.status === "paused").length,
    errors: tasks.filter((t) => t.last_status === "error").length,
    total: tasks.length,
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border/50 bg-muted/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Timer size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t('scheduledTasks.title')}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{t('scheduledTasks.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={fetchTasks} disabled={loading} className="h-9 w-9 p-0">
              <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="h-9 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
            >
              <Plus size={14} />
              {t('scheduledTasks.addTask')}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Circle size={8} weight="fill" className="text-green-500" />
            <span>{stats.active} {t('scheduledTasks.active')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Pause size={8} />
            <span>{stats.paused} {t('scheduledTasks.paused')}</span>
          </div>
          {stats.errors > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-red-500">
              <WarningCircle size={8} />
              <span>{stats.errors} {t('scheduledTasks.error')}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground/60 ml-auto">
            共 {stats.total} 个任务
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mt-4 flex items-center gap-1 bg-muted/20 rounded-lg p-1 border border-border/50 w-fit">
          {(["all", "active", "paused", "completed", "disabled"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "text-[11px] font-medium px-3 py-1 rounded-md transition-all whitespace-nowrap",
                filter === f
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" && t('scheduledTasks.filterAll')}
              {f === "active" && t('scheduledTasks.filterActive')}
              {f === "paused" && t('scheduledTasks.filterPaused')}
              {f === "completed" && t('scheduledTasks.filterCompleted')}
              {f === "disabled" && t('scheduledTasks.filterDisabled')}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden flex">
        {/* Task list */}
        <div className={cn("flex-1 overflow-auto p-6", expandedId && "pr-0")}>
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-center">
              <div className="p-4 rounded-full bg-muted/10 mb-4">
                <Timer size={40} className="text-muted-foreground/20" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{t('scheduledTasks.noTasks')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-[250px]">
                {t('scheduledTasks.noTasksHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl">
              {filteredTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  expanded={expandedId === task.id}
                  onShowLogs={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  onPause={() => handlePause(task.id)}
                  onResume={() => handleResume(task.id)}
                  onDelete={() => handleDelete(task.id)}
                  onRun={() => handleRun(task.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Log panel */}
        {expandedId && (
          <div className="w-[380px] shrink-0 border-l border-border/50 overflow-hidden flex flex-col">
            {(() => {
              const task = tasks.find((t) => t.id === expandedId);
              if (!task) return null;
              return <LogPanel taskId={expandedId} taskName={task.name} />;
            })()}
          </div>
        )}
      </main>

      {/* Create dialog */}
      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchTasks}
      />
    </div>
  );
}
