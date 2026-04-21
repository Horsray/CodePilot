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
  TelegramLogo,
  ChatCircle,
  Desktop,
  Wrench,
  CaretUp,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ScheduledTask, ChatSession } from "@/types";

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

// ── 时间工具函数（北京时间 UTC+8）──────────────────────────
// 生成当前时刻 + 指定分钟后的 datetime-local 值（北京时间，YYYY-MM-DDTHH:MM）
function localAfterISO(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60000);
  // 转换为北京时间：d.getTime() + (480 - d.getTimezoneOffset()) * 60000
  // 480 = 8h * 60min（北京时间 UTC+8）
  const tzOffset = d.getTimezoneOffset(); // 当地时区偏移（分钟），北京是 -480
  const bjMs = d.getTime() - tzOffset * 60000 + 480 * 60000;
  const bj = new Date(bjMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())}T${pad(bj.getHours())}:${pad(bj.getMinutes())}`;
}

// ── 任务分组 ──────────────────────────────────────────────────
interface TaskGroup {
  key: string;
  name: string;
  isGrouped: boolean;
  count: number;         // 同组任务数量
  tasks: ScheduledTask[];
  description?: string;  // 组内任务的统一简介
}

// 将任务列表按 group_id 折叠分组（仅折叠同一 group_id、count>1 的）
function groupTasks(tasks: ScheduledTask[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>();

  for (const task of tasks) {
    // Group by group_id or fallback to task name for auto-collapsing similar tasks
    const groupId = task.group_id || `name-${task.name}`;
    const groupName = task.group_name || task.name;
    
    const key = `group-${groupId}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.tasks.push(task);
    } else {
      map.set(key, {
        key,
        name: groupName,
        isGrouped: true,
        count: 1,
        tasks: [task],
        description: task.prompt.slice(0, 100) + (task.prompt.length > 100 ? "…" : ""),
      });
    }
  }

  // If a group only has 1 task and no explicit group_id, mark it as not grouped
  for (const group of map.values()) {
    if (group.count === 1 && !group.tasks[0].group_id) {
      group.isGrouped = false;
      group.key = `single-${group.tasks[0].id}`;
    }
  }

  return Array.from(map.values());
}

// ── Task card ────────────────────────────────────────────────
// 通知渠道配置
const channelConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  toast: { label: "Toast", icon: <BellSimple size={12} />, color: "text-blue-500" },
  system: { label: "系统通知", icon: <Desktop size={12} />, color: "text-purple-500" },
  telegram: { label: "Telegram", icon: <TelegramLogo size={12} />, color: "text-cyan-500" },
  session: { label: "写入对话", icon: <ChatCircle size={12} />, color: "text-green-500" },
};

function TaskCard({
  task,
  onPause,
  onResume,
  onDelete,
  onRun,
  onShowLogs,
  expanded,
  description,
}: {
  task: ScheduledTask;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onRun: () => void;
  onShowLogs: () => void;
  expanded: boolean;
  description?: string;
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

      {/* Task Content (Only show if not expanded to save space) */}
          {!expanded && (
            <>
              {/* 任务简介 */}
              {description && (
                <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed line-clamp-2">{description}</p>
                </div>
              )}
            </>
          )}

          {/* Last run info (Always visible) */}
          <div className={cn("mx-4 mb-3 flex items-center gap-4 text-[10px] text-muted-foreground/60 flex-wrap", expanded && "mt-2")}>
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
        {/* 通知渠道与工具授权展示 */}
        <div className="flex items-center gap-2 ml-auto">
          {task.tool_authorization && task.tool_authorization.type !== ("none" as any) && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/30 border border-border/40 text-muted-foreground" title={`工具授权: ${task.tool_authorization.type}`}>
              <Lightning size={10} className="text-amber-500" />
              {task.tool_authorization.type === "full_access" ? "所有工具" : `${task.tool_authorization.tool_ids?.length || 0}个工具`}
            </span>
          )}
          {task.notification_channels && task.notification_channels.length > 0 && (
            <div className="flex items-center gap-1">
              {task.notification_channels.map(ch => {
                const cfg = channelConfig[ch as keyof typeof channelConfig];
                return cfg ? (
                  <span key={ch} className={cn("p-0.5 rounded bg-muted/20 border border-border/30", cfg.color)} title={`接收通知: ${cfg.label}`}>
                    {cfg.icon}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 折叠任务组卡片 ───────────────────────────────────────────
function TaskGroupCard({
  group,
  expanded,
  onToggle,
  onPauseAll,
  onResumeAll,
  onDeleteAll,
  onRunAll,
}: {
  group: TaskGroup;
  expanded: boolean;
  onToggle: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onDeleteAll: () => void;
  onRunAll: () => void;
}) {
  const { t } = useTranslation();
  // 统计组内各状态数量
  const statusCounts = group.tasks.reduce((acc, task) => {
    const s = task.last_status || task.status;
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="rounded-xl border border-border/50 bg-background hover:border-border transition-all overflow-hidden">
      {/* 组头部 */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggle}>
        <button className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        </button>
        {/* 分组标识 */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-500/10 text-indigo-500">
          <Lightning size={10} />
          {t('scheduledTasks.group')}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold truncate">{group.name}</h4>
          <div className="flex items-center gap-3 mt-0.5">
            {/* 任务数量 */}
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <BellSimple size={10} />
              {group.count} {t('scheduledTasks.tasks')}
            </span>
            {/* 状态分布 */}
            {statusCounts["active"] > 0 && (
              <span className="text-[10px] text-green-500 flex items-center gap-1">
                <Circle size={8} weight="fill" /> {statusCounts["active"]}
              </span>
            )}
            {statusCounts["paused"] > 0 && (
              <span className="text-[10px] text-yellow-500 flex items-center gap-1">
                <Pause size={8} /> {statusCounts["paused"]}
              </span>
            )}
          </div>
        </div>
        {/* 批量操作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {statusCounts["active"] > 0 && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-yellow-500" onClick={(e) => { e.stopPropagation(); onPauseAll(); }} title={t('scheduledTasks.pauseAll')}>
                <Pause size={14} />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={(e) => { e.stopPropagation(); onRunAll(); }} title={t('scheduledTasks.runAll')}>
                <Play size={14} />
              </Button>
            </>
          )}
          {statusCounts["paused"] > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-green-500 gap-1 text-[11px]" onClick={(e) => { e.stopPropagation(); onResumeAll(); }}>
              <Play size={12} /> {t('scheduledTasks.resume')}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500" onClick={(e) => { e.stopPropagation(); onDeleteAll(); }} title={t('scheduledTasks.deleteAll')}>
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {/* 简介 (折叠时显示) */}
      {!expanded && group.description && (
        <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed line-clamp-2">{group.description}</p>
        </div>
      )}

      {/* 展开后显示所有子任务 */}
      {expanded && (
        <div className="border-t border-border/30 divide-y divide-border/30">
          {group.tasks.map((task) => (
            <div key={task.id} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10">
              <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0",
                task.last_status === "error" ? "bg-red-500/10 text-red-400" :
                task.last_status === "success" ? "bg-green-500/10 text-green-400" :
                task.status === "active" ? "bg-green-500/10 text-green-500" :
                task.status === "paused" ? "bg-yellow-500/10 text-yellow-500" :
                "bg-muted/30 text-muted-foreground"
              )}>
                {task.last_status === "error" ? <XCircle size={9} /> :
                 task.last_status === "success" ? <CheckCircle size={9} /> :
                 task.status === "active" ? <Circle size={9} weight="fill" /> :
                 task.status === "paused" ? <Pause size={9} /> :
                 <Circle size={9} />}
                {task.last_status || task.status}
              </div>
              <span className="text-xs text-muted-foreground flex-1 truncate" title={task.name}>{task.name}</span>
              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                {task.schedule_type === "once" ? t('scheduledTasks.scheduleOnce') :
                 task.schedule_type === "interval" ? task.schedule_value :
                 task.schedule_value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────
// 通知渠道类型
type NotificationChannelType = 'toast' | 'system' | 'telegram' | 'session';

// 工具授权类型
type ToolAuthType = 'none' | 'full_access' | 'partial';

// MCP Server item for UI
interface McpServerItem {
  name: string;
  type: string;
  enabled: boolean;
}

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
  // 默认时间：北京时间 +1 小时，避免过去时间
  const [onceValue, setOnceValue] = useState(localAfterISO(60));
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 高级选项
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelType[]>(["toast", "system", "telegram", "session"]);
  const [sessionBindingMode, setSessionBindingMode] = useState<"none" | "specify">("none");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [toolAuthType, setToolAuthType] = useState<ToolAuthType>("full_access");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [activeHoursStart, setActiveHoursStart] = useState("");
  const [activeHoursEnd, setActiveHoursEnd] = useState("");

  // 可用的会话列表
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // 可用的 MCP 服务器列表
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // 加载会话和 MCP 服务器列表
  useEffect(() => {
    if (!open) return;
    setLoadingData(true);
    Promise.all([
      fetch("/api/chat/sessions").then(r => r.json()).catch(() => ({ sessions: [] })),
      fetch("/api/plugins/mcp/servers").then(r => r.json()).catch(() => ({ servers: [] })),
    ]).then(([sessionData, mcpData]) => {
      if (sessionData.sessions) {
        setSessions(sessionData.sessions);
        // 默认选择第一个会话
        if (sessionData.sessions.length > 0 && !selectedSessionId) {
          setSelectedSessionId(sessionData.sessions[0].id);
        }
      }
      if (mcpData.servers) {
        setMcpServers(mcpData.servers);
      }
    }).finally(() => setLoadingData(false));
  }, [open]);

  // 切换通知渠道
  const toggleChannel = (channel: NotificationChannelType) => {
    setNotificationChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  // 切换工具选择
  const toggleTool = (toolName: string) => {
    setSelectedTools(prev =>
      prev.includes(toolName)
        ? prev.filter(t => t !== toolName)
        : [...prev, toolName]
    );
  };

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

      // 构建 session_binding
      const sessionBinding = sessionBindingMode === "specify" && selectedSessionId
        ? { session_id: selectedSessionId }
        : null;

      // 构建 tool_authorization
      let toolAuthorization = null;
      if (toolAuthType === "full_access") {
        toolAuthorization = { type: "full_access" as const };
      } else if (toolAuthType === "partial" && selectedTools.length > 0) {
        toolAuthorization = { type: "mcp" as const, tool_ids: selectedTools };
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
          // 新增字段
          notification_channels: notificationChannels,
          session_binding: sessionBinding,
          tool_authorization: toolAuthorization,
          active_hours_start: activeHoursStart || null,
          active_hours_end: activeHoursEnd || null,
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
      setOnceValue(localAfterISO(60));
      setPriority("normal");
      setNotifyOnComplete(true);
      setWorkingDirectory("");
      setShowAdvanced(false);
      setNotificationChannels(["toast", "system", "telegram", "session"]);
      setSessionBindingMode("none");
      setSelectedSessionId("");
      setToolAuthType("full_access");
      setSelectedTools([]);
      setActiveHoursStart("");
      setActiveHoursEnd("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 通知渠道配置
  const channelConfig: Record<NotificationChannelType, { label: string; icon: React.ReactNode; color: string }> = {
    toast: { label: "Toast", icon: <BellSimple size={12} />, color: "text-blue-500" },
    system: { label: "系统通知", icon: <Desktop size={12} />, color: "text-purple-500" },
    telegram: { label: "Telegram", icon: <TelegramLogo size={12} />, color: "text-cyan-500" },
    session: { label: "写入对话", icon: <ChatCircle size={12} />, color: "text-green-500" },
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border/50 rounded-2xl shadow-2xl w-[580px] max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
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

          {/* 高级选项折叠按钮 */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <CaretUp size={12} /> : <CaretDown size={12} />}
            高级选项
          </button>

          {/* 高级选项内容 */}
          {showAdvanced && (
            <div className="space-y-4 p-4 bg-muted/10 rounded-xl border border-border/30">
              {/* 通知渠道 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">通知渠道（可多选）</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(channelConfig) as [NotificationChannelType, typeof channelConfig[NotificationChannelType]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => toggleChannel(key)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border",
                        notificationChannels.includes(key)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-muted/20 border-border/50 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className={cfg.color}>{cfg.icon}</span>
                      {cfg.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  提示：Telegram 需要在设置中配置 Bot Token 才能接收通知
                </p>
              </div>

              {/* 会话绑定 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">任务结果写入</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sessionBinding"
                      checked={sessionBindingMode === "none"}
                      onChange={() => setSessionBindingMode("none")}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">不写入任何对话</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sessionBinding"
                      checked={sessionBindingMode === "specify"}
                      onChange={() => setSessionBindingMode("specify")}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">指定对话：</span>
                  </label>
                  {sessionBindingMode === "specify" && (
                    <select
                      value={selectedSessionId}
                      onChange={(e) => setSelectedSessionId(e.target.value)}
                      className="w-full h-8 px-2 text-xs bg-muted/20 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
                    >
                      <option value="">选择对话...</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title || '未命名对话'} ({new Date(s.updated_at).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* 工具授权 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">工具授权</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="toolAuth"
                      checked={toolAuthType === "none"}
                      onChange={() => setToolAuthType("none")}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">不使用工具（纯文本生成）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="toolAuth"
                      checked={toolAuthType === "full_access"}
                      onChange={() => setToolAuthType("full_access")}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">全量授权（自动使用所有可用工具）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="toolAuth"
                      checked={toolAuthType === "partial"}
                      onChange={() => setToolAuthType("partial")}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs">部分授权（勾选需要的工具）：</span>
                  </label>
                  {toolAuthType === "partial" && (
                    <div className="ml-6 flex flex-wrap gap-1.5 mt-2">
                      {mcpServers.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/60">暂无可用的 MCP 工具</span>
                      ) : (
                        mcpServers.map((server) => (
                          <button
                            key={server.name}
                            onClick={() => toggleTool(server.name)}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border",
                              selectedTools.includes(server.name)
                                ? "bg-green-500/10 border-green-500/30 text-green-500"
                                : "bg-muted/20 border-border/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Wrench size={10} />
                            {server.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 活跃时段 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">活跃时段（可选）</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={activeHoursStart}
                    onChange={(e) => setActiveHoursStart(e.target.value)}
                    placeholder="09:00"
                    className="h-8 w-28 text-xs"
                  />
                  <span className="text-muted-foreground">至</span>
                  <Input
                    type="time"
                    value={activeHoursEnd}
                    onChange={(e) => setActiveHoursEnd(e.target.value)}
                    placeholder="18:00"
                    className="h-8 w-28 text-xs"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  设置后，任务只在该时间段内执行
                </p>
              </div>
            </div>
          )}

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
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/10 shrink-0">
        <Clock size={14} className="text-primary" />
        <span className="text-xs font-semibold">{t('scheduledTasks.executionLogs')}</span>
        <span className="text-[10px] text-muted-foreground/60">— {taskName}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{logs.length} 条记录</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
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
          <div className="space-y-4">
            {logs.map((log) => (
              <div key={log.id} className="p-3 rounded-xl border border-border/50 bg-background shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {log.status === "success" ? (
                      <span className="text-[11px] text-green-500 font-bold flex items-center gap-1">
                        <CheckCircle size={12} /> {t('scheduledTasks.logSuccess')}
                      </span>
                    ) : (
                      <span className="text-[11px] text-red-500 font-bold flex items-center gap-1">
                        <XCircle size={12} /> {t('scheduledTasks.logFailed')}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    {formatDuration(log.duration_ms)}
                  </span>
                </div>
                {log.error && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
                    <p className="text-[11px] text-red-400 font-mono whitespace-pre-wrap break-words">{log.error}</p>
                  </div>
                )}
                {log.result && (
                  <div className="mt-2">
                    <p className="text-[11px] text-muted-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                      {log.result}
                    </p>
                  </div>
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

  // 计算过滤和分组
  const filteredTasks = tasks.filter((task) => {
    if (filter === "all") return true;
    return task.status === filter;
  });
  const taskGroups = groupTasks(filteredTasks);

  // 统计（按原始任务数统计，分组后显示分组数）
  const stats = {
    active: tasks.filter((t) => t.status === "active").length,
    paused: tasks.filter((t) => t.status === "paused").length,
    errors: tasks.filter((t) => t.last_status === "error").length,
    total: taskGroups.length,
  };

  // 批量操作：组内所有任务暂停/恢复/删除/运行
  const handleGroupPauseAll = async (group: TaskGroup) => {
    await Promise.all(group.tasks.map((t) => fetch(`/api/tasks/${t.id}/pause`, { method: "POST" })));
    fetchTasks();
  };
  const handleGroupResumeAll = async (group: TaskGroup) => {
    await Promise.all(group.tasks.map((t) => fetch(`/api/tasks/${t.id}/pause`, { method: "POST" })));
    fetchTasks();
  };
  const handleGroupDeleteAll = async (group: TaskGroup) => {
    if (!confirm(t('scheduledTasks.confirmDeleteGroup'))) return;
    setDeletingId("group");
    await Promise.all(group.tasks.map((t) => fetch(`/api/tasks/${t.id}`, { method: "DELETE" })));
    setDeletingId(null);
    setExpandedId(null);
    fetchTasks();
  };
  const handleGroupRunAll = async (group: TaskGroup) => {
    await Promise.all(group.tasks.map((t) => fetch(`/api/tasks/${t.id}/run`, { method: "POST" })));
    setTimeout(fetchTasks, 1000);
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
            className="h-9 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md relative"
          >
            <Plus size={14} />
            {t('scheduledTasks.addTask')}
            {stats.active > 0 && (
              <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow border-2 border-background">
                {stats.active > 99 ? '99+' : stats.active}
              </span>
            )}
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
            <div className="space-y-3 w-full">
              {taskGroups.map((group) =>
                group.isGrouped ? (
                  <TaskGroupCard
                    key={group.key}
                    group={group}
                    expanded={expandedId === group.key}
                    onToggle={() => setExpandedId(expandedId === group.key ? null : group.key)}
                    onPauseAll={() => handleGroupPauseAll(group)}
                    onResumeAll={() => handleGroupResumeAll(group)}
                    onDeleteAll={() => handleGroupDeleteAll(group)}
                    onRunAll={() => handleGroupRunAll(group)}
                  />
                ) : (
                  <TaskCard
                    key={group.key}
                    task={group.tasks[0]}
                    expanded={expandedId === group.key}
                    onShowLogs={() => setExpandedId(expandedId === group.key ? null : group.key)}
                    onPause={() => handlePause(group.tasks[0].id)}
                    onResume={() => handleResume(group.tasks[0].id)}
                    onDelete={() => handleDelete(group.tasks[0].id)}
                    onRun={() => handleRun(group.tasks[0].id)}
                  />
                )
              )}
            </div>
          )}
        </div>

        {/* Log panel（仅对单条任务展开时显示，分组不显示日志面板） */}
        {expandedId && !expandedId.startsWith("group-") && (
          <div className="w-[450px] shrink-0 border-l border-border/50 bg-muted/5 overflow-hidden flex flex-col">
            {(() => {
              const actualId = expandedId.startsWith("single-") ? expandedId.replace("single-", "") : expandedId;
              const task = tasks.find((t) => t.id === actualId);
              if (!task) return null;
              return <LogPanel taskId={actualId} taskName={task.name} />;
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
