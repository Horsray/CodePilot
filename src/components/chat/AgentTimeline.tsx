'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
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
  Play,
  FileText,
  CaretRight,
  ArrowSquareOut,
  ArrowElbowDownRight
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { TimelineFileChange, TimelineStep } from '@/types';
import { usePanel } from '@/hooks/usePanel';
import { usePanelStore } from '@/store/usePanelStore';

const RENDERABLE_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.tsx', '.jsx', '.csv', '.tsv']);

const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;

function Linkify({ children, className }: { children: string, className?: string }) {
  if (!children || typeof children !== 'string') return <>{children}</>;
  const parts = children.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return (
            <span
              key={i}
              className={cn("text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer", className)}
              onClick={(e) => {
                e.stopPropagation();
                usePanelStore.getState().openBrowserTab(part, '网页预览');
              }}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function canPreview(filename: string): boolean {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return RENDERABLE_EXTENSIONS.has(ext);
}

interface AgentTimelineProps {
  steps: TimelineStep[];
  compact?: boolean;
  liveStatusText?: string;
  showSummaryCard?: boolean;
  sessionId?: string;
  onForceStop?: () => void;
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



function getPrimaryTool(step: TimelineStep) {
  return step.toolCalls.find((tool) => tool.status === 'running') || step.toolCalls[0] || null;
}

function isReasoningDuplicateOfHeader(reasoningText: string, activityLabel: string, stepTitle: string): boolean {
  const firstLine = reasoningText.split('\n')[0]?.trim() || '';
  if (!firstLine) return false;
  const normalizedFirst = normalizeText(firstLine);
  return normalizedFirst === normalizeText(activityLabel) || normalizedFirst === normalizeText(stepTitle);
}



function DiffPreview({ change }: { change: TimelineFileChange }) {
  const [open, setOpen] = useState(false);
  const beforeLines = useMemo(() => change.beforeText.replace(/\r\n/g, '\n').split('\n'), [change.beforeText]);
  const afterLines = useMemo(() => change.afterText.replace(/\r\n/g, '\n').split('\n'), [change.afterText]);
  const beforePreview = open ? beforeLines : beforeLines.slice(0, 4);
  const afterPreview = open ? afterLines : afterLines.slice(0, 4);
  const { openPreviewTab } = usePanel();

  const showPreviewBtn = canPreview(change.fileName);

  return (
    <div className="rounded-lg border border-border/25 bg-background/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/5 text-[11px]">
        <PencilSimple size={12} weight="bold" className="shrink-0 text-amber-500/60" />
        <span className="flex-1 truncate font-mono text-foreground/70">{change.fileName}</span>
        <div className="flex items-center gap-1.5 px-2 font-mono">
          <span className="text-emerald-500/70">+{change.addedLines}</span>
          {change.operation !== 'create' && <span className="text-red-500/60">-{change.removedLines}</span>}
        </div>
        {showPreviewBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPreviewTab(change.path);
              }}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary transition hover:bg-primary/20"
              title="预览渲染效果"
            >
              <Play size={10} weight="fill" />
              预览
            </button>
          )}
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
    
    if (name === 'search' || name === 'glob' || name === 'grep' || name === 'find_files' || name === 'search_files' || name === 'websearch' || name === 'web_search' || name === 'searchcodebase') {
      return {
        type: 'searching',
        icon: <MagnifyingGlass size={14} weight="bold" className="text-blue-500" />,
        label: isDone ? '内容检索' : '正在检索',
        subtitle: (() => {
          if (tool.result) {
            const lines = tool.result.split('\n').filter(l => l.trim());
            const summaryLine = lines.find(l => /^found\s+\d+/i.test(l) || /^找到\s+\d+/i.test(l) || /^匹配\s+\d+/i.test(l) || /^\d+\s+matches/i.test(l) || /^\d+\s+results/i.test(l));
            if (summaryLine) return summaryLine;
          }
          return isDone ? '检索完成' : `使用 ${tool.name} 搜索内容`;
        })(),
        colorClass: 'text-blue-500/80',
        bgClass: 'bg-blue-500/10'
      };
    }

    // File Reading / Viewing
    if (name === 'read' || name === 'read_file' || name === 'mcp__filesystem__read_file' || name === 'mcp__filesystem__read_multiple_files' || name === 'mcp__filesystem__list_directory' || name === 'mcp__filesystem__directory_tree' || name === 'view_file') {
      const input = tool.input as Record<string, unknown> | undefined;
      const path = input?.path || input?.file_path || input?.filePath;
      const fileName = path && typeof path === 'string' ? path.split(/[\/\\]/).pop() : undefined;
      
      return {
        type: 'reading',
        icon: <FileText size={14} weight="bold" className="text-blue-500" />,
        label: isDone 
          ? (fileName ? `查看 ${fileName}` : '文件检索')
          : (fileName ? `正在查看 ${fileName}` : '正在检索文件'),
        subtitle: (() => {
          if (tool.result) {
            const lines = tool.result.split('\n').filter(l => l.trim());
            const summaryLine = lines.find(l => /^found\s+\d+/i.test(l) || /^找到\s+\d+/i.test(l) || /^读取了\s+\d+/i.test(l) || /^\d+\s+lines/i.test(l) || /^read\s+\d+/i.test(l));
            if (summaryLine) return summaryLine;
            
            if (name === 'mcp__filesystem__read_multiple_files') {
               const input = tool.input as Record<string, unknown>;
               if (input && Array.isArray(input.paths)) {
                 return `读取了 ${input.paths.length} 个文件`;
               }
            } else {
               return `读取了 ${lines.length} 行`;
            }
          }
          return `使用了 ${tool.name} 工具`;
        })(),
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
      subtitle: (() => {
        if (tool.result) {
          const lines = tool.result.split('\n').filter(l => l.trim());
          const summaryLine = lines.find(l => /^found\s+\d+/i.test(l) || /^找到\s+\d+/i.test(l) || /^读取了\s+\d+/i.test(l) || /^\d+\s+lines/i.test(l) || /^read\s+\d+/i.test(l) || /^匹配\s+\d+/i.test(l) || /^\d+\s+matches/i.test(l) || /^\d+\s+results/i.test(l));
          if (summaryLine) return summaryLine;
          
          if (['read', 'read_file', 'mcp__filesystem__read_file', 'view_file'].some(v => tool.name.toLowerCase().includes(v))) {
             return `读取了 ${lines.length} 行`;
          }
          if (['mcp__filesystem__read_multiple_files'].some(v => tool.name.toLowerCase().includes(v))) {
             const input = tool.input as any;
             if (input && Array.isArray(input.paths)) {
               return `读取了 ${input.paths.length} 个文件`;
             }
          }
        }
        return isDone ? '工具执行完毕' : '执行工具函数';
      })(),
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

function ActivityCard({
  step,
  compact,
  liveStatusText,
}: {
  step: TimelineStep;
  compact?: boolean;
  isExpanded?: boolean;
  liveStatusText?: string;
  sessionId?: string;
  onForceStop?: () => void;
}) {
  const primaryTool = getPrimaryTool(step);
  const isRunning = step.status === 'running' || step.status === 'retrying';
  const isCommandStep = Boolean(primaryTool && isCommandToolName(primaryTool.name));
  const isSearchTool = Boolean(primaryTool && ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search', 'searchcodebase', 'read', 'read_file', 'mcp__filesystem__read_file', 'mcp__filesystem__read_multiple_files', 'mcp__filesystem__list_directory', 'mcp__filesystem__directory_tree', 'view_file'].some(n => primaryTool.name.toLowerCase().includes(n)));
  
  // ---------------------------------------------------------------------------
  // Initialize as open when running. When finished, only remain open if explicitly toggled by user.
  // CRITICAL FIX: To prevent UI jumping and endless expanding/collapsing, we default to FALSE
  // when finished, unless the user explicitly requested it to be open.
  // CRITICAL FIX 4: The problem is `compact` view height collapsing and expanding for single steps. 
  // We NEVER auto-collapse steps in compact mode (since it's inside a fixed height scrolling box anyway), 
  // this prevents the jumping behavior entirely.
  // CRITICAL FIX 8: In compact mode, we STILL WANT TO COLLAPSE it when done, but we use fixed max-height on parent to prevent jumping.
  // We don't want it permanently open, that looks cluttered.
  // ---------------------------------------------------------------------------
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [internalExpanded, setInternalExpanded] = useState(isSearchTool ? false : isRunning);
  
  useEffect(() => {
    if (userToggled !== null) return;
    if (isSearchTool) {
      setInternalExpanded(false);
    } else if (isRunning) {
      setInternalExpanded(true);
    } else {
      const timer = setTimeout(() => {
        setInternalExpanded(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isRunning, isSearchTool, userToggled]);

  const open = userToggled ?? internalExpanded;

  // ---------------------------------------------------------------------------
  // 功能名称：执行卡片内的思考内容自动滚动控制
  // 用法：和 ThinkingRow 类似，当思考内容展开并处于渲染状态时，
  // 会将内容自动滚动到底部。用户手动上滑可取消自动跟随，滑到底部恢复。
  // ---------------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (open && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [step.reasoning, open, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
    setAutoScroll(isAtBottom);
  };

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
      return step.status === 'completed' ? '已查看检索细节' : activity.subtitle;
    }
    if (activity.type === 'calling') {
      if (isSearchTool && !showToolDetail) {
        return activity.subtitle;
      }
      return step.status === 'completed' ? activity.subtitle : activity.subtitle;
    }
    if (activity.type === 'executing') {
      return step.status === 'completed' ? '终端任务已结束' : activity.subtitle;
    }
    if (activity.type === 'thinking') {
      return showReasoningDetail
        ? '已完成思考分析'
        : activity.subtitle;
    }
    return activity.subtitle || step.summary || previewText(step.output.trim(), compact ? 80 : 140);
  })();
  const runningStatusText = isCommandStep
    ? extractStatusMessage(liveStatusText || '') || '正在执行命令'
    : activity.subtitle;




  return (
    <div className={cn("my-1 border-b border-border/20 last:border-0 pb-1 overflow-hidden", compact ? "bg-transparent" : "bg-background")}>
      <button
          type="button"
          onClick={() => {
            if (hasDetails) {
              if (isRunning) {
                setUserToggled(prev => prev === false ? null : false);
              } else {
                setUserToggled(prev => prev === true ? null : true);
              }
            }
          }}
          className={cn("flex w-full items-center justify-between px-2 py-1.5 hover:bg-muted/40 transition-colors rounded-[6px]", compact ? "text-[11px]" : "text-[12px]")}
        >
        <div className="flex items-center gap-2 overflow-hidden min-w-0 pr-2">
          {activity.icon}
          <span 
            className="font-medium text-foreground/80 truncate ml-1 text-left shrink-0"
            title={activity.label}
          >
            {activity.label}
          </span>
          <span className="text-border mx-1 shrink-0">|</span>
          <span 
            className="font-mono text-[11px] text-muted-foreground/60 truncate flex-1 text-left min-w-0"
            title={isCommandStep && step.status === 'running' ? runningStatusText : collapsedLead}
          >
            {isCommandStep && step.status === 'running' ? runningStatusText : collapsedLead}
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
          {step.status === 'running' && <SpinnerGap size={14} className="animate-spin text-primary" />}
          {step.status === 'failed' && <XCircle size={14} className="text-red-500" />}
          {step.status === 'completed' && <CheckCircle size={14} className="text-emerald-500" />}
        </div>
      </button>

      {open && hasDetails && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="space-y-3 mt-1.5 mb-2 ml-7">
            {showReasoningDetail && (
            <div className="rounded-[8px] bg-muted/20 border border-border/30 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-violet-500/80">
                <Brain size={12} weight="bold" />
                <span>思考内容</span>
              </div>
              <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80 max-h-[400px] overflow-y-auto overscroll-contain scrollbar-thin"
              >
                <Linkify>{reasoningText}</Linkify>
              </div>
            </div>
          )}

          {showToolDetail && (
            <div className="space-y-2">
              {step.toolCalls.map((tool) => (
                <div key={tool.id} className="rounded-[8px] border border-border/30 bg-background/40 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/10">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Gear size={12} weight="bold" className="text-primary/60 shrink-0" />
                      <span className="truncate font-mono text-[11px] text-foreground/70">
                        {tool.name}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/50">
                      {tool.status === 'running' ? '运行中...' : tool.status === 'failed' ? '执行失败' : '执行完毕'}
                    </span>
                  </div>
                  {Boolean(tool.input) && (
                    <div className="p-2 border-b border-border/20 bg-muted/5 overflow-x-auto">
                      <span className="text-[10px] font-medium text-muted-foreground/50 uppercase mb-1 block">Input</span>
                      <pre className="whitespace-pre-wrap text-[11px] leading-5 font-mono text-muted-foreground/70">
                        <Linkify>{formatResultText(JSON.stringify(tool.input, null, 2), compact)}</Linkify>
                      </pre>
                    </div>
                  )}
                  {tool.result && (
                    <div className="p-2 overflow-x-auto">
                      <span className="text-[10px] font-medium text-muted-foreground/50 uppercase mb-1 block">Output</span>
                      <pre className={cn(
                        'whitespace-pre-wrap text-[11px] leading-5 font-mono',
                        tool.isError ? 'text-red-500/80' : 'text-foreground/60',
                      )}>
                        <Linkify>{formatResultText(tool.result, compact)}</Linkify>
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
            <div className="rounded-[8px] border border-red-500/20 bg-red-500/[0.05] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-red-500/80 font-medium">{step.error}</span>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('chat-retry', { detail: { stepId: step.id } }))}
                  className="flex shrink-0 items-center gap-1 rounded-[4px] bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-500/20"
                >
                  <ClockCounterClockwise size={12} weight="bold" />
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
        </motion.div>
      )}
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

  // Only render the last 2 visible steps to prevent vertical explosion, unless expanded
  // If we are not running anymore, we want to show all steps, or we show the latest ones.
  // CRITICAL FIX 3: To stop the screen from jumping up and down, we only use `recentSteps` when running.
  // When complete, we show ALL steps so it doesn't suddenly shrink.
  const recentSteps = visibleSteps.slice(-5); // increased to 5
  // If we are in compact mode (which means this is a sub-agent timeline), ALWAYS just show recent steps to prevent huge scrolling containers
  // CRITICAL FIX 6: Use ALL steps for compact mode too when done to prevent shrinking
  // CRITICAL FIX 7: NEVER slice when compact, so we don't have items popping in and out constantly while running.
  // We're already putting it inside a scrolling container in ToolActionsGroup, so it's safe to just show them all.
  const displaySteps = compact ? visibleSteps : (isRunning ? recentSteps : visibleSteps);

  // Auto scroll to bottom when compact mode (subagent running)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compact && containerRef.current) {
      // Use a small timeout to let the DOM settle before scrolling
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    }
  }, [displaySteps, compact]);

  return (
    <div className={cn("group/timeline", compact ? "mt-1" : "mt-3")}>
      {!compact && (
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
      )}

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn("space-y-1", !compact && "ml-1 pl-1")}>
              {displaySteps.map((step) => (
                <ActivityCard
                  key={step.id}
                  step={step}
                  compact={compact}
                  liveStatusText={liveStatusText}
                  sessionId={sessionId}
                  onForceStop={onForceStop}
                />
              ))}
              <div ref={containerRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
