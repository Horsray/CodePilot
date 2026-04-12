import { useState, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  CaretDown,
  CheckCircle,
  ClockCounterClockwise,
  Gear,
  MagnifyingGlass,
  PencilSimple,
  SpinnerGap,
  TerminalWindow,
  XCircle,
  PushPin,
  ArrowsCounterClockwise,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TimelineFileChange, TimelineStep } from '@/types';

interface AgentTimelineProps {
  steps: TimelineStep[];
  sessionId?: string;
  compact?: boolean;
}

function getStepIcon(status: TimelineStep['status']) {
  if (status === 'running' || status === 'retrying') return <SpinnerGap size={13} className="animate-spin text-blue-500/70" />;
  if (status === 'completed') return <CheckCircle size={13} weight="fill" className="text-emerald-500/70" />;
  if (status === 'failed') return <XCircle size={13} weight="fill" className="text-red-500/70" />;
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

function shortValue(value?: string): string {
  if (!value) return '';
  return value.split('/').pop() || value;
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

function summarizeToolInput(toolName: string, input: unknown, compact?: boolean): string {
  if (!input || typeof input !== 'object') return previewText(formatObject(input), compact ? 60 : 120);
  const data = input as Record<string, unknown>;
  if (toolName === 'Agent') {
    const agent = typeof data.agent === 'string' ? data.agent : 'general';
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const inline = `${agent}: ${prompt}`.trim();
    return previewText(inline, compact ? 120 : 240);
  }
  const command = typeof data.command === 'string' ? data.command : '';
  const path = typeof data.path === 'string' ? data.path : typeof data.file_path === 'string' ? data.file_path : '';
  const pattern = typeof data.pattern === 'string' ? data.pattern : '';
  const query = typeof data.query === 'string' ? data.query : '';
  const inline = command || path || pattern || query || formatObject(input);
  return previewText(inline, compact ? 72 : 140);
}

function renderAgentToolInput(input: unknown): { agent: string; prompt: string } | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Record<string, unknown>;
  const agent = typeof data.agent === 'string' ? data.agent : 'general';
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  return { agent, prompt };
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

function DiffPreview({ change }: { change: TimelineFileChange }) {
  const [open, setOpen] = useState(false);
  const beforeLines = change.beforeText.replace(/\r\n/g, '\n').split('\n');
  const afterLines = change.afterText.replace(/\r\n/g, '\n').split('\n');
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
      label: isDone ? `已完成编辑 ${file.fileName}` : `正在编辑 ${file.fileName}`,
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
          ? (fileName ? `已完成查看 ${fileName}` : '已完成文件检索')
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
        label: isDone ? '已完成终端命令执行' : '正在执行终端命令',
        subtitle: isDone ? '终端任务已结束' : '运行 Bash 脚本',
        colorClass: 'text-primary/80',
        bgClass: 'bg-primary/10'
      };
    }

    // Generic Tool Call
    return {
      type: 'calling',
      icon: <Gear size={14} weight="bold" className="text-violet-500" />,
      label: isDone ? `已完成调用 ${tool.name}` : `正在调用 ${tool.name}`,
      subtitle: isDone ? '工具执行完毕' : '执行工具函数',
      colorClass: 'text-violet-500/80',
      bgClass: 'bg-violet-500/10'
    };
  }

  // 3. Thinking
  if (reasoningText) {
    // Extract first line of reasoning as sub-title if it's short
    const firstLine = reasoningText.split('\n')[0].trim();
    const title = firstLine.length < 40 ? firstLine : '思考过程';
    return {
      type: 'thinking',
      icon: <Brain size={14} weight="bold" className="text-violet-500" />,
      label: title,
      subtitle: '规划与分析',
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

const TimelineStepCard = memo(function TimelineStepCard({ step, sessionId, compact }: { step: TimelineStep; sessionId?: string; compact?: boolean }) {
  const [open, setOpen] = useState(step.status === 'running' || step.status === 'retrying');
  const activity = getActivityInfo(step);
  const reasoningText = cleanReasoningText(step.reasoning);
  const isFirstThinkingStage = step.index === 1
    && step.status === 'running'
    && step.toolCalls.length === 0
    && !step.output.trim()
    && !reasoningText;
  const hasDetails = Boolean(
    step.dependencies.length > 0
    || reasoningText
    || step.toolCalls.length > 0
    || step.fileChanges.length > 0
    || step.output.trim()
    || step.error
    || step.status === 'retrying'
    || step.status === 'failed'
    || step.status === 'stopped',
  );

  // Background run timer
  const [showBgAction, setShowBgAction] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  
  useEffect(() => {
    if (step.status !== 'running') {
      setShowBgAction(false);
      return;
    }
    
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed > 20000) { // 20 seconds
        setShowBgAction(true);
        clearInterval(interval);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [step.status]);

  const handleBgRun = async () => {
    // 中文注释：发送后台运行信号。如果该步骤中有正在运行的工具，通知后端将其转入后台。
    if (!sessionId) return;
    
    const runningTools = step.toolCalls.filter(t => t.status === 'running');
    if (runningTools.length === 0) {
      setShowBgAction(false);
      return;
    }

    try {
      // Background all running tools in this step
      await Promise.all(runningTools.map(t => 
        fetch('/api/chat/background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, toolCallId: t.id }),
        })
      ));

      setShowBgAction(false);
      window.dispatchEvent(new CustomEvent('chat-status-message', { 
        detail: { message: '任务已转入后台持续处理，你可以继续提问。' } 
      }));
    } catch (err) {
      console.error('[AgentTimeline] Failed to background tools:', err);
    }
  };

  return (
    <div className="relative group">
      {/* Broken Timeline Connector - Dashed and faded */}
      <div className="absolute left-[7px] top-8 bottom-[-12px] w-px border-l border-dashed border-border/30 group-last:hidden" />
      
      <div className="relative flex gap-3">
        {/* Activity Icon Node - Smaller, cleaner */}
        <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border/40 z-10 overflow-hidden">
          {step.status === 'running' ? (
            <div className="flex h-full w-full items-center justify-center bg-primary/5">
              <SpinnerGap size={10} className="animate-spin text-primary" />
            </div>
          ) : (
            <div className={cn(
              "flex h-full w-full items-center justify-center bg-muted/5",
              step.status === 'completed' && "bg-emerald-500/5",
              step.status === 'failed' && "bg-red-500/5"
            )}>
              <div className="scale-75 opacity-60">{getStepIcon(step.status)}</div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 pb-4">
          <div className={cn(
            "rounded-xl border border-border/30 bg-background/60 transition-all duration-300",
            open ? "shadow-md ring-1 ring-border/20" : "hover:bg-muted/10"
          )}>
            <button
              type="button"
              onClick={() => hasDetails && setOpen((value) => !value)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left group/btn"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover/btn:scale-105 shadow-sm", activity.bgClass)}>
                {activity.icon}
              </div>
              
              <div className="min-w-0 flex-1">
                {isFirstThinkingStage ? (
                  <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/80">
                    <SpinnerGap size={14} className="animate-spin text-primary" />
                    <span>正在连接模型...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-bold text-foreground/90 leading-tight">{activity.label}</span>
                        {step.agent && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/5 border border-blue-500/10">
                            <span className="text-[9px] font-medium text-blue-600 uppercase tracking-tight">
                              {shortValue(step.agent)}
                            </span>
                          </div>
                        )}
                        {step.providerName && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/5 border border-emerald-500/10">
                            <span className="text-[9px] font-medium text-emerald-600 tracking-tight">
                              {shortValue(step.providerName)}
                            </span>
                          </div>
                        )}
                        {step.model && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 border border-border/20">
                            <Brain size={10} className="text-muted-foreground/70" />
                            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-tight">
                              {step.model.split('/').pop()}
                            </span>
                          </div>
                        )}
                        {/* Whitelist badge (Trae-like) - Matches agent-tools.ts logic */}
                        {step.status === 'running' && step.toolCalls.length > 0 && step.toolCalls.every(t => 
                          ['Read', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite'].includes(t.name) || 
                          t.name.startsWith('codepilot_') ||
                          (t.name.startsWith('mcp__') && /read|list|get|search/i.test(t.name))
                        ) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold text-emerald-600">
                                <CheckCircle size={10} weight="bold" />
                                <span>白名单</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>此工具已在安全白名单中，自动批准执行</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <span className="truncate text-[10px] text-muted-foreground/60 font-medium tracking-tight">{activity.subtitle}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {step.retryCount > 0 && (
                        <span className="text-[10px] text-amber-500 font-bold bg-amber-500/5 px-1.5 py-0.5 rounded-md tracking-tighter uppercase">重试 {step.retryCount} 次</span>
                      )}
                      {step.status !== 'completed' && step.status !== 'pending' && (
                        <span className={cn(
                          'rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight shadow-sm',
                          step.status === 'running' && 'bg-blue-500 text-white animate-pulse',
                          step.status === 'failed' && 'bg-red-500/10 text-red-600',
                          step.status === 'stopped' && 'bg-amber-500/10 text-amber-600',
                        )}>
                          {getStepStatusLabel(step.status)}
                        </span>
                      )}
                      {hasDetails && (
                        <CaretDown size={12} className={cn('text-muted-foreground/40 transition-transform duration-300', open && 'rotate-180')} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </button>

            {open && hasDetails && (
              <div className="space-y-3 border-t border-border/10 px-3 py-2.5 bg-muted/[0.03]">
                {/* Background run hint */}
                {showBgAction && (
                  <div className="flex items-center justify-between rounded-lg bg-blue-500/5 p-2 border border-blue-500/10">
                    <span className="text-[11px] text-blue-600 font-medium">任务执行较慢，是否转入后台？</span>
                    <Button variant="outline" size="sm" onClick={handleBgRun} className="h-6 px-2 text-[10px] border-blue-200 text-blue-600 hover:bg-blue-500/10">
                      <PushPin size={10} className="mr-1" />
                      后台运行
                    </Button>
                  </div>
                )}

                {reasoningText && (
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold text-violet-500/70 uppercase tracking-wider">
                      <Brain size={12} weight="bold" />
                      <span>思考路径</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80 font-medium">
                      {previewText(reasoningText, compact ? 300 : 800)}
                    </div>
                  </div>
                )}

                {(step.requestedAgent || step.agent || step.providerName || step.model || step.orchestrationProfileName) && (
                  <div className="rounded-lg border border-border/20 bg-background/40 p-2.5">
                    <div className="mb-1.5 text-[11px] font-bold text-foreground/60 uppercase tracking-wider">实际命中</div>
                    <div className="flex flex-wrap gap-2">
                      {step.requestedAgent && (
                        <div className="rounded-md border border-violet-500/10 bg-violet-500/5 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground/70">Requested: </span>
                          <span className="font-mono text-violet-600">{step.requestedAgent}</span>
                        </div>
                      )}
                      {step.agent && (
                        <div className="rounded-md border border-blue-500/10 bg-blue-500/5 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground/70">Resolved: </span>
                          <span className="font-mono text-blue-600">{step.agent}</span>
                        </div>
                      )}
                      {step.orchestrationProfileName && (
                        <div className="rounded-md border border-amber-500/10 bg-amber-500/5 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground/70">Profile: </span>
                          <span className="font-mono text-amber-600">{step.orchestrationProfileName}</span>
                        </div>
                      )}
                      {step.providerName && (
                        <div className="rounded-md border border-emerald-500/10 bg-emerald-500/5 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground/70">Provider: </span>
                          <span className="font-mono text-emerald-600">{step.providerName}</span>
                        </div>
                      )}
                      {step.model && (
                        <div className="rounded-md border border-border/20 bg-muted/20 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground/70">Model: </span>
                          <span className="font-mono text-foreground/80">{step.model}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {step.toolCalls.length > 0 && (
                  <div className="space-y-2">
                    {step.toolCalls.map((tool) => (
                      <div key={tool.id} className="rounded-lg border border-border/20 bg-background/40 overflow-hidden">
                        {(() => {
                          const agentInput = tool.name === 'Agent' ? renderAgentToolInput(tool.input) : null;
                          return (
                            <>
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/10">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <Gear size={12} weight="bold" className="text-primary/60 shrink-0" />
                            <span className="text-[11px] font-mono text-foreground/70 truncate">
                              {tool.name}({summarizeToolInput(tool.name, tool.input, true)})
                            </span>
                          </div>
                          {tool.status !== 'completed' && (
                            <span className="text-[10px] text-muted-foreground/50 italic">{tool.status === 'running' ? (tool.name === 'Agent' ? '子 Agent 执行中...' : '运行中...') : '失败'}</span>
                          )}
                        </div>
                        {agentInput && (
                          <div className="border-t border-border/10 bg-background/30 px-2.5 py-2 space-y-1.5">
                            <div className="text-[10px] text-muted-foreground/70">
                              <span className="font-semibold">目标 Agent:</span> <span className="font-mono">{agentInput.agent}</span>
                            </div>
                            {agentInput.prompt && (
                              <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-foreground/75 font-mono">
                                {agentInput.prompt}
                              </pre>
                            )}
                          </div>
                        )}
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
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}

                {step.fileChanges.length > 0 && (
                  <div className="space-y-2">
                    {step.fileChanges.map((change) => (
                      <DiffPreview key={`${change.path}-${change.operation}`} change={change} />
                    ))}
                  </div>
                )}

                {step.error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-red-500/80 font-medium">{step.error}</span>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('chat-retry', { detail: { stepId: step.id } }))}
                        className="shrink-0 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                      >
                        <ArrowsCounterClockwise size={12} weight="bold" />
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
}, (prev, next) => {
  // Custom equality check to prevent re-renders unless meaningful data changes
  return prev.step.status === next.step.status &&
         prev.step.output === next.step.output &&
         prev.step.error === next.step.error &&
         prev.step.reasoning === next.step.reasoning &&
         prev.step.toolCalls.length === next.step.toolCalls.length &&
         prev.step.retryCount === next.step.retryCount;
});

/**
 * 中文注释：功能名称「智能体执行时间线」，用法是在流式消息和历史消息中复用同一组件，
 * 把统一的 TimelineStep[] 渲染成步骤卡片和执行链路。
 */
export const AgentTimeline = memo(function AgentTimeline({ steps, sessionId, compact = false }: AgentTimelineProps) {
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
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/30 transition-colors text-muted-foreground/70 hover:text-foreground"
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
      </div>

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
                  sessionId={sessionId}
                  compact={compact}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}, (prev, next) => {
  return prev.sessionId === next.sessionId &&
         prev.steps.length === next.steps.length &&
         prev.steps.every((s, i) => s.status === next.steps[i].status && s.reasoning === next.steps[i].reasoning);
});
