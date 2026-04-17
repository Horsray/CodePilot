'use client';

import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  CaretDown,
  CheckCircle,
  ClockCounterClockwise,
  Code,
  Eye,
  Gear,
  GitDiff,
  Link,
  MagicWand,
  MagnifyingGlass,
  PencilSimple,
  SpinnerGap,
  TerminalWindow,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { TimelineFileChange, TimelineStep } from '@/types';

interface AgentTimelineProps {
  steps: TimelineStep[];
  compact?: boolean;
  liveStatusText?: string;
  showSummaryCard?: boolean;
  sessionId?: string;
  onForceStop?: () => void;
}

type TimelineOverallStatus = 'running' | 'completed' | 'failed' | 'stopped';

function getStepIcon(status: TimelineStep['status']) {
  if (status === 'running' || status === 'retrying') return <SpinnerGap size={13} className="animate-spin text-blue-500/70" />;
  if (status === 'completed') return <CheckCircle size={13} weight="fill" className="text-emerald-500/70" />;
  if (status === 'failed') return <XCircle size={13} weight="fill" className="text-red-500/70" />;
  if (status === 'stopped') return <WarningCircle size={13} weight="fill" className="text-amber-500/70" />;
  return <ClockCounterClockwise size={13} className="text-muted-foreground/60" />;
}

function getStepStatusLabel(status: TimelineStep['status']): string {
  switch (status) {
    case 'running': return '执行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'retrying': return '重试中';
    case 'stopped': return '已停止';
    default: return '等待中';
  }
}

function getOverallStatus(steps: TimelineStep[]): TimelineOverallStatus {
  if (steps.some((step) => step.status === 'failed' || step.error)) return 'failed';
  if (steps.some((step) => step.status === 'retrying' || step.status === 'stopped')) return 'stopped';
  if (steps.some((step) => step.status === 'running')) return 'running';
  return 'completed';
}

function getOverallTitle(steps: TimelineStep[], liveStatusText?: string): string {
  const lastMeaningful = [...steps].reverse().find((step) => step.title?.trim() || step.output.trim() || step.toolCalls.length > 0);
  if (lastMeaningful?.title?.trim()) return lastMeaningful.title;
  if (liveStatusText?.trim()) return extractStatusMessage(liveStatusText);
  return '执行过程';
}

function getOverallMeta(steps: TimelineStep[]): string {
  const toolCount = steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
  const fileCount = steps.reduce((sum, step) => sum + step.fileChanges.length, 0);
  const stepCount = steps.length;
  const parts = [`${stepCount} 个步骤`];
  if (toolCount > 0) parts.push(`${toolCount} 次工具调用`);
  if (fileCount > 0) parts.push(`${fileCount} 个文件变更`);
  return parts.join(' · ');
}

function getOverallStatusClass(status: TimelineOverallStatus): string {
  if (status === 'failed') return 'bg-red-500/10 text-red-600 dark:text-red-400';
  if (status === 'stopped') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (status === 'running') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
  return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
}

function formatObject(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function previewText(value: string, max = 280): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function cleanReasoningText(value: string): string {
  return value
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractStatusMessage(value?: string): string {
  if (!value) return '连接模型 / 加载工具中';
  try {
    const parsed = JSON.parse(value) as { message?: string; title?: string };
    return parsed.message || parsed.title || value;
  } catch {
    return value;
  }
}

function summarizeToolInput(toolName: string, input: unknown, compact?: boolean): string {
  if (!input || typeof input !== 'object') return previewText(formatObject(input), compact ? 60 : 120);
  const data = input as Record<string, unknown>;
  const command = typeof data.command === 'string' ? data.command : '';
  const path = typeof data.path === 'string' ? data.path : typeof data.file_path === 'string' ? data.file_path : '';
  const pattern = typeof data.pattern === 'string' ? data.pattern : '';
  const query = typeof data.query === 'string' ? data.query : '';
  const inline = command || path || pattern || query || formatObject(input);
  return previewText(inline, compact ? 72 : 140);
}

function formatResultText(raw: string, compact?: boolean): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const lines = Object.entries(obj).slice(0, compact ? 4 : 8).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      return lines.join('\n');
    }
  } catch {
    // 非 JSON 文本按原样走预览
  }
  return previewText(text, compact ? 180 : 360);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function summarizeReasoningLine(reasoningText: string, maxLength = 48): string {
  const firstLine = reasoningText
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
  const cleaned = firstLine
    .replace(/^thinking[:：]?\s*/i, '')
    .replace(/^思考过程[:：]?\s*/i, '')
    .replace(/^让我理清思路[:：]?\s*/i, '')
    .trim();
  return previewText(cleaned || firstLine, maxLength);
}

function isCommandToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'bash' || normalized === 'command' || normalized === 'shell' || normalized === 'runcommand';
}

function isContextToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'read' || normalized === 'readfile' || normalized === 'ls' || normalized === 'glob' || normalized === 'grep' || normalized === 'searchcodebase';
}

function getPrimaryTool(step: TimelineStep) {
  return step.toolCalls.find((tool) => tool.status === 'running') || step.toolCalls[0] || null;
}

function isReasoningDuplicateOfHeader(reasoningText: string, activityLabel: string, stepTitle: string): boolean {
  const firstLine = reasoningText.split('\n')[0]?.trim() || '';
  if (!firstLine) return false;
  const normalizedFirst = normalizeText(firstLine);
  return normalizedFirst === normalizeText(activityLabel) || normalizedFirst === normalizeText(stepTitle);
}

function buildDependencyLabel(step: TimelineStep): string {
  return step.dependencies.length > 0 ? '等待前置步骤完成后继续执行' : '依赖上一个操作结果继续推进';
}

function openFile(path: string): void {
  fetch('/api/open-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}

function DiffPreview({ change }: { change: TimelineFileChange }) {
  const [open, setOpen] = useState(false);
  const beforeLines = useMemo(() => change.beforeText.replace(/\r\n/g, '\n').split('\n'), [change.beforeText]);
  const afterLines = useMemo(() => change.afterText.replace(/\r\n/g, '\n').split('\n'), [change.afterText]);
  const beforePreview = open ? beforeLines : beforeLines.slice(0, 4);
  const afterPreview = open ? afterLines : afterLines.slice(0, 4);

  return (
    <div className="rounded-lg border border-border/25 bg-background/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/5 text-[11px]">
        <PencilSimple size={12} weight="bold" className="shrink-0 text-amber-500/60" />
        <span className="flex-1 truncate font-mono text-foreground/70">{change.fileName}</span>
        <div className="flex items-center gap-1.5 px-2 font-mono">
          <span className="text-emerald-500/70">+{change.addedLines}</span>
          {change.operation !== 'create' && <span className="text-red-500/60">-{change.removedLines}</span>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md bg-muted/40 px-2 py-0.5 text-[10px] font-bold text-foreground/60 transition hover:bg-muted hover:text-foreground"
        >
          {open ? '收起' : '查看变更'}
        </button>
      </div>

      {open && (
        <div className="grid divide-y divide-border/10 text-[10px] md:grid-cols-2 md:divide-x md:divide-y-0 border-t border-border/10">
          {change.operation !== 'create' && (
            <div className="max-h-[160px] overflow-auto bg-red-500/[0.03] p-2">
              <pre className="whitespace-pre font-mono leading-relaxed text-red-500/60 opacity-80">
                {beforePreview.join('\n')}
                {beforeLines.length > beforePreview.length ? '\n...' : ''}
              </pre>
            </div>
          )}
          <div className={cn('max-h-[160px] overflow-auto bg-emerald-500/[0.03] p-2', change.operation === 'create' && 'md:col-span-2')}>
            <pre className="whitespace-pre font-mono leading-relaxed text-emerald-600/70 dark:text-emerald-400/70">
              {afterPreview.join('\n')}
              {afterLines.length > afterPreview.length ? '\n...' : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function getActivityInfo(step: TimelineStep) {
  const reasoningText = cleanReasoningText(step.reasoning);
  const toolCount = step.toolCalls.length;
  const fileCount = step.fileChanges.length;
  const isDone = step.status === 'completed';

  // 1. Editing Priority
  if (fileCount > 0) {
    const file = step.fileChanges[0];
    return {
      type: 'editing',
      icon: <PencilSimple size={14} weight="bold" className="text-amber-500" />,
      label: isDone ? `修改 ${file.fileName}` : `正在修改 ${file.fileName}`,
      subtitle: isDone ? `修改了 ${fileCount} 个文件` : `正在修改 ${fileCount} 个文件`,
      colorClass: 'text-amber-500/80',
      bgClass: 'bg-amber-500/10'
    };
  }

  // 2. Tool Calls (Viewing vs Executing vs Generic)
  if (toolCount > 0) {
    const tool = step.toolCalls[0];
    const name = tool.name.toLowerCase();
    
    // Viewing files
    if (name === 'read' || name === 'readfile' || name === 'ls' || name === 'glob' || name === 'grep') {
      const input = tool.input as any;
      const path = input?.path || input?.file_path || input?.filePath || '';
      const fileName = path.split('/').pop() || path;
      return {
        type: 'viewing',
        icon: <MagnifyingGlass size={14} weight="bold" className="text-blue-500" />,
        label: isDone 
          ? (fileName ? `查看 ${fileName}` : '文件检索')
          : (fileName ? `正在查看 ${fileName}` : '正在检索文件'),
        subtitle: `使用了 ${tool.name} 工具`,
        colorClass: 'text-blue-500/80',
        bgClass: 'bg-blue-500/10'
      };
    }

    // Executing commands
    if (name === 'bash' || name === 'command' || name === 'shell') {
      return {
        type: 'executing',
        icon: <TerminalWindow size={14} weight="bold" className="text-primary" />,
        label: isDone ? '终端命令' : '正在执行终端命令',
        subtitle: isDone ? '终端任务已结束' : '运行 Bash 脚本',
        colorClass: 'text-primary/80',
        bgClass: 'bg-primary/10'
      };
    }

    // Generic Tool Call
    return {
      type: 'calling',
      icon: <Gear size={14} weight="bold" className="text-violet-500" />,
      label: isDone ? `调用 ${tool.name}` : `正在调用 ${tool.name}`,
      subtitle: isDone ? '工具执行完毕' : '执行工具函数',
      colorClass: 'text-violet-500/80',
      bgClass: 'bg-violet-500/10'
    };
  }

  // 3. Thinking
  if (reasoningText) {
    const summaryLine = summarizeReasoningLine(reasoningText, 64);
    return {
      type: 'thinking',
      icon: <Brain size={14} weight="bold" className="text-violet-500" />,
      label: '规划与分析',
      subtitle: summaryLine || '思考过程',
      colorClass: 'text-violet-500/80',
      bgClass: 'bg-violet-500/10'
    };
  }

  return {
    type: 'step',
    icon: <Gear size={14} weight="bold" className="text-muted-foreground" />,
    label: step.title || '执行步骤',
    subtitle: '自动化任务',
    colorClass: 'text-muted-foreground/80',
    bgClass: 'bg-muted/10'
  };
}

function TimelineStepCard({
  step,
  compact,
  liveStatusText,
  sessionId,
  onForceStop,
}: {
  step: TimelineStep;
  compact?: boolean;
  liveStatusText?: string;
  sessionId?: string;
  onForceStop?: () => void;
}) {
  const primaryTool = getPrimaryTool(step);
  const isCommandStep = Boolean(primaryTool && isCommandToolName(primaryTool.name));
  const isContextStep = step.toolCalls.length > 0 && step.toolCalls.every((tool) => isContextToolName(tool.name));
  const [open, setOpen] = useState(step.status === 'running' || step.status === 'retrying');
  const [backgrounding, setBackgrounding] = useState(false);
  const activity = getActivityInfo(step);
  const reasoningText = cleanReasoningText(step.reasoning);
  const showReasoningDetail = Boolean(
    reasoningText
    && (
      activity.type === 'thinking'
      || step.status === 'running'
      || step.status === 'retrying'
      || step.status === 'failed'
      || step.status === 'completed'
    )
    && !isReasoningDuplicateOfHeader(reasoningText, activity.label, step.title)
  );
  const showToolDetail = step.toolCalls.length > 0 && (
    step.status === 'running'
    || step.status === 'retrying'
    || step.status === 'failed'
    || step.status === 'completed'
    || step.error !== null
  );
  const showFileDetail = step.fileChanges.length > 0;
  const showErrorDetail = Boolean(step.error);
  const isFirstThinkingStage = step.index === 1
    && step.status === 'running'
    && step.toolCalls.length === 0
    && !step.output.trim()
    && !reasoningText;
  const hasDetails = Boolean(
    step.dependencies.length > 0
    || showReasoningDetail
    || showToolDetail
    || showFileDetail
    || showErrorDetail
    || step.status === 'retrying'
    || step.status === 'failed'
    || step.status === 'stopped'
    || (step.status === 'completed' && step.toolCalls.length > 0),
  );
  const collapsedLead = (() => {
    if (activity.type === 'editing') {
      return step.status === 'completed'
        ? `修改了 ${step.fileChanges.length} 个文件`
        : activity.subtitle;
    }
    if (activity.type === 'viewing') {
      return step.status === 'completed' ? '点击展开查看检索细节' : activity.subtitle;
    }
    if (activity.type === 'calling') {
      return step.status === 'completed' ? '工具执行完毕' : activity.subtitle;
    }
    if (activity.type === 'executing') {
      return step.status === 'completed' ? '终端任务已结束' : activity.subtitle;
    }
    if (activity.type === 'thinking') {
      return showReasoningDetail
        ? '点击展开查看思考内容'
        : activity.subtitle;
    }
    return activity.subtitle || step.summary || previewText(step.output.trim(), compact ? 80 : 140);
  })();
  const runningStatusText = isCommandStep
    ? extractStatusMessage(liveStatusText || '') || '正在执行命令'
    : activity.subtitle;
  const rowTone = isContextStep && step.status === 'completed'
    ? 'bg-muted/10 text-muted-foreground/70 border-border/0'
    : isCommandStep && step.status === 'running'
      ? 'border-border/40 bg-background/90 shadow-sm'
      : 'border-border/20 bg-background/40';

  const handleBackground = async () => {
    if (!sessionId || !primaryTool?.id) return;
    setBackgrounding(true);
    try {
      await fetch('/api/chat/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, toolCallId: primaryTool.id }),
      });
    } finally {
      setBackgrounding(false);
    }
  };

  return (
    <div className="relative group">
      <div className="absolute left-[7px] top-7 bottom-[-10px] w-px border-l border-dashed border-border/25 group-last:hidden" />

      <div className="relative flex gap-3">
        <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border/35 z-10 overflow-hidden">
          {step.status === 'running' ? (
            <SpinnerGap size={10} className="animate-spin text-primary" />
          ) : (
            <div className="scale-75 opacity-70">{getStepIcon(step.status)}</div>
          )}
        </div>

        <div className="flex-1 pb-3">
          <div className={cn('overflow-hidden rounded-xl border transition-all duration-200', rowTone)}>
            <button
              type="button"
              onClick={() => hasDetails && setOpen((value) => !value)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2 text-left',
                hasDetails && 'hover:bg-muted/10',
              )}
            >
              <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', activity.bgClass)}>
                {activity.icon}
              </div>

              <div className="min-w-0 flex-1">
                {isFirstThinkingStage ? (
                  <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/80">
                    <SpinnerGap size={14} className="animate-spin text-primary" />
                    <span>正在连接模型...</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cn(
                          'truncate text-[13px] leading-tight',
                          isContextStep && step.status === 'completed' ? 'font-medium text-muted-foreground/75' : 'font-semibold text-foreground/90',
                        )}>
                          {activity.label}
                        </div>
                        <div className={cn(
                          'mt-0.5 truncate text-[11px]',
                          isCommandStep && step.status === 'running' ? 'text-foreground/75' : 'text-muted-foreground/60',
                        )}>
                          {isCommandStep && step.status === 'running' ? runningStatusText : collapsedLead}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {step.status !== 'completed' && step.status !== 'pending' && (
                          <span className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            step.status === 'running' && 'bg-primary/10 text-primary',
                            step.status === 'failed' && 'bg-red-500/10 text-red-600',
                            step.status === 'stopped' && 'bg-amber-500/10 text-amber-600',
                          )}>
                            {getStepStatusLabel(step.status)}
                          </span>
                        )}
                        {hasDetails && (
                          <CaretDown size={12} className={cn('text-muted-foreground/40 transition-transform duration-200', open && 'rotate-180')} />
                        )}
                      </div>
                    </div>

                    {isCommandStep && step.status === 'running' && primaryTool && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground/80">
                          {summarizeToolInput(primaryTool.name, primaryTool.input, true)}
                        </span>
                        {sessionId && primaryTool.id && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleBackground();
                            }}
                            disabled={backgrounding}
                            className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            {backgrounding ? '转入中...' : '后台运行'}
                          </button>
                        )}
                        {onForceStop && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onForceStop();
                            }}
                            className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </button>

            {open && hasDetails && (
              <div className="space-y-3 border-t border-border/10 bg-muted/[0.03] px-3 py-2.5">
                {showReasoningDetail && (
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-violet-500/80">
                      <Brain size={12} weight="bold" />
                      <span>思考内容</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80">
                      {previewText(reasoningText, compact ? 300 : 800)}
                    </div>
                  </div>
                )}

                {showToolDetail && (
                  <div className="space-y-2">
                    {step.toolCalls.map((tool) => (
                      <div key={tool.id} className="rounded-lg border border-border/20 bg-background/40 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/10">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <Gear size={12} weight="bold" className="text-primary/60 shrink-0" />
                            <span className="truncate font-mono text-[11px] text-foreground/70">
                              {tool.name}({summarizeToolInput(tool.name, tool.input, true)})
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground/50">
                            {tool.status === 'running' ? '运行中...' : tool.status === 'failed' ? '执行失败' : '执行完毕'}
                          </span>
                        </div>
                        {tool.result && (
                          <div className="p-2 overflow-x-auto">
                            <pre className={cn(
                              'whitespace-pre-wrap text-[11px] leading-5 font-mono',
                              tool.isError ? 'text-red-500/80' : 'text-foreground/60',
                            )}>
                              {formatResultText(tool.result, compact)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {showFileDetail && (
                  <div className="space-y-2">
                    {step.fileChanges.map((change) => (
                      <DiffPreview key={`${change.path}-${change.operation}`} change={change} />
                    ))}
                  </div>
                )}

                {showErrorDetail && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-red-500/80 font-medium">{step.error}</span>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('chat-retry', { detail: { stepId: step.id } }))}
                        className="flex shrink-0 items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-500/20"
                      >
                        <ClockCounterClockwise size={12} weight="bold" />
                        重试
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 中文注释：功能名称「智能体执行时间线」，用法是在流式消息和历史消息中复用同一组件，
 * 把统一的 TimelineStep[] 渲染成步骤卡片和执行链路。
 */
export function AgentTimeline({
  steps,
  compact = false,
  liveStatusText,
  showSummaryCard = false,
  sessionId,
  onForceStop,
}: AgentTimelineProps) {
  const visibleSteps = steps.filter((step) => {
    return step.reasoning.trim()
      || step.output.trim()
      || step.toolCalls.length > 0
      || step.fileChanges.length > 0
      || step.error
      || step.status !== 'pending';
  });
  
  const [isExpanded, setIsExpanded] = useState(true);

  if (visibleSteps.length === 0) return null;

  const isRunning = visibleSteps.some(s => s.status === 'running' || s.status === 'retrying');

  return (
    <div className="mt-3 group/timeline">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-2 py-1 mb-2 rounded-md hover:bg-muted/30 transition-colors text-muted-foreground/70 hover:text-foreground"
      >
        <CaretDown size={14} className={cn("transition-transform duration-300", !isExpanded && "-rotate-90")} />
        <span className="text-[12px] font-bold uppercase tracking-wider">思考过程</span>
        {isRunning && (
          <div className="flex items-center gap-1.5 ml-2">
            <div className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-medium text-primary animate-pulse tracking-tight">执行中...</span>
          </div>
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 ml-1 pl-1">
              {visibleSteps.map((step) => (
                <TimelineStepCard
                  key={step.id}
                  step={step}
                  compact={compact}
                  liveStatusText={liveStatusText}
                  sessionId={sessionId}
                  onForceStop={onForceStop}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
