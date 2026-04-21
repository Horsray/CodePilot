'use client';

import React, { useState, createElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';
import {
  File,
  NotePencil,
  TerminalWindow,
  MagnifyingGlass,
  Wrench,
  SpinnerGap,
  CheckCircle,
  XCircle,
  CaretRight,
  Brain,
  Image as ImageIcon,
  Lightning,
  GitDiff,
  Eye,
  Eyeglasses,
  ArrowSquareOut,
  Code,
  FilePlus,
  CaretDown,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';

const thinkingPlugins = { cjk, math, mermaid };

import type { MediaBlock, TimelineStep } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolAction {
  id?: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  media?: MediaBlock[];
}

interface ToolActionsGroupProps {
  tools: ToolAction[];
  steps?: TimelineStep[];
  isStreaming?: boolean;
  streamingToolOutput?: string;
  /** When true, skip the collapsible header and render the tool list directly */
  flat?: boolean;
  /** Thinking/reasoning content — rendered as the first expandable item inside the group */
  thinkingContent?: string;
  /** Status text from SSE stream */
  statusText?: string;
  /** Session ID for rewind operations */
  sessionId?: string;
  /** Rewind target user message ID */
  rewindUserMessageId?: string;
}

// ---------------------------------------------------------------------------
// Tool Registry — extensible per-type rendering
// ---------------------------------------------------------------------------

interface ToolRendererDef {
  match: (name: string, input?: unknown) => boolean;
  icon: Icon;
  label: string;
  getSummary: (input: unknown, name?: string) => string;
  /** Render inline detail when tool row is hovered/expanded (optional) */
  renderDetail?: (tool: ToolAction, streamingOutput?: string) => React.ReactNode;
}

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return '';
  return (inp.file_path || inp.path || inp.filePath || '') as string;
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 3);
}

const TOOL_REGISTRY: ToolRendererDef[] = [
  {
    match: (n) => ['bash', 'execute', 'run', 'shell', 'execute_command'].includes(n.toLowerCase()),
    icon: TerminalWindow,
    label: '',
    getSummary: (input) => {
      const cmd = ((input as Record<string, unknown>)?.command || (input as Record<string, unknown>)?.cmd || '') as string;
      return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
    },
    renderDetail: (tool, streamingOutput) => {
      const cmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
      const isRunning = tool.result === undefined;
      // While running: show command + last 5 lines of output (rolling window)
      // When done: show command + full result (collapsible)
      const outputText = isRunning ? streamingOutput : tool.result;
      const displayLines = (() => {
        if (!outputText) return null;
        if (isRunning) {
          // Rolling window: only last 5 lines while streaming
          const lines = outputText.split('\n');
          return lines.slice(-5).join('\n');
        }
        // Completed: show full output, truncated to 20 lines with indicator
        const lines = outputText.split('\n');
        if (lines.length > 20) {
          return lines.slice(0, 20).join('\n') + `\n… +${lines.length - 20} lines`;
        }
        return outputText;
      })();

      return (
        <div className="mt-1 rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground/80 max-h-[140px] overflow-auto whitespace-pre-wrap break-all">
          {cmd && <div className="text-foreground/70">$ {cmd}</div>}
          {displayLines && (
            <div className={cn("mt-1", isRunning ? "text-muted-foreground/50" : "text-muted-foreground/60")}>
              {displayLines}
            </div>
          )}
        </div>
      );
    },
  },
  {
    match: (n) => ['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(n.toLowerCase()),
    icon: NotePencil,
    label: '编辑',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : '文件';
    },
  },
  {
    match: (n) => ['read', 'readfile', 'read_file'].includes(n.toLowerCase()),
    icon: Eyeglasses,
    label: '读取',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : '文件';
    },
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    icon: MagnifyingGlass,
    label: '搜索',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : '搜索内容';
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : tool.result;
      if (!outputText) return null;

      let lines = outputText.split('\n').filter(l => l.trim().length > 0);
      
      // Try to parse JSON output if possible
      try {
        const parsed = JSON.parse(outputText);
        if (Array.isArray(parsed)) {
          lines = parsed.map(item => typeof item === 'string' ? item : JSON.stringify(item));
        } else if (parsed && typeof parsed === 'object') {
          // If it's a typical search result object
          if (Array.isArray(parsed.files)) {
            lines = parsed.files.map((f: any) => String(f));
          } else if (Array.isArray(parsed.results)) {
            lines = parsed.results.map((r: any) => typeof r === 'string' ? r : r.title || r.url || JSON.stringify(r));
          }
        }
      } catch {
        // Not JSON, just use raw lines
      }

      if (lines.length === 0) return null;

      const displayLines = lines.slice(0, 8);
      const more = lines.length - displayLines.length;

      return (
        <div className="mt-1 ml-[11px] border-l-2 border-blue-500/20 pl-4 py-1 space-y-1">
          {displayLines.map((line, i) => (
            <div key={i} className="text-[11px] font-mono text-muted-foreground/70 truncate flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-blue-500/40 shrink-0" />
              {line}
            </div>
          ))}
          {more > 0 && (
            <div className="text-[10px] font-medium text-muted-foreground/40 mt-1 pl-2">
              ... 及其他 {more} 项
            </div>
          )}
        </div>
      );
    },
  },
  {
    match: (n, input) => {
      const inp = input as Record<string, unknown> | undefined;
      return n.toLowerCase() === 'agent' && (inp?.agent === 'explore' || inp?.subagent_type === 'explore');
    },
    icon: MagnifyingGlass,
    label: 'Search Agent',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const prompt = (inp?.prompt || inp?.description || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return short;
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : undefined;
      if (!outputText && isRunning) return null;

      // Parse progress lines into structured items
      const lines = (outputText || '').split('\n').filter(Boolean);
      // Only show last 8 lines to avoid clutter
      const visible = lines.slice(-8);

      return (
        <div className="mt-1 ml-4 border-l-2 border-border/30 pl-2 space-y-0.5">
          {visible.map((line, i) => {
            const isActive = line.startsWith('>');
            const isDone = line.startsWith('[+]');
            const isError = line.startsWith('[x]');
            const isHeader = line.startsWith('[subagent:');
            return (
              <div
                key={i}
                className={cn(
                  "text-[11px] font-mono truncate",
                  isHeader ? "text-muted-foreground/70" :
                  isActive ? "text-muted-foreground/60" :
                  isDone ? "text-green-500/60" :
                  isError ? "text-red-500/60" :
                  "text-muted-foreground/50"
                )}
              >
                {isActive && <SpinnerGap size={10} className="inline-block mr-1 animate-spin align-text-bottom" />}
                {isDone && <CheckCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {isError && <XCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {line.replace(/^\[subagent:\w+\]\s*/, '').replace(/^>\s*/, '').replace(/^\[[+x]\]\s*/, '')}
              </div>
            );
          })}
        </div>
      );
    },
  },
  {
    match: (n, input) => {
      const inp = input as Record<string, unknown> | undefined;
      return n.toLowerCase() === 'agent' && inp?.agent !== 'explore' && inp?.subagent_type !== 'explore';
    },
    icon: Lightning,
    label: '智能体',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const agentType = (inp?.agent || inp?.subagent_type || 'general') as string;
      const prompt = (inp?.prompt || inp?.description || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return `${agentType}: ${short}`;
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : undefined;
      if (!outputText && isRunning) return null;

      // Parse progress lines into structured items
      const lines = (outputText || '').split('\n').filter(Boolean);
      // Only show last 8 lines to avoid clutter
      const visible = lines.slice(-8);

      return (
        <div className="mt-1 ml-4 border-l-2 border-border/30 pl-2 space-y-0.5">
          {visible.map((line, i) => {
            const isActive = line.startsWith('>');
            const isDone = line.startsWith('[+]');
            const isError = line.startsWith('[x]');
            const isHeader = line.startsWith('[subagent:');
            return (
              <div
                key={i}
                className={cn(
                  "text-[11px] font-mono truncate",
                  isHeader ? "text-muted-foreground/70" :
                  isActive ? "text-muted-foreground/60" :
                  isDone ? "text-green-500/60" :
                  isError ? "text-red-500/60" :
                  "text-muted-foreground/50"
                )}
              >
                {isActive && <SpinnerGap size={10} className="inline-block mr-1 animate-spin align-text-bottom" />}
                {isDone && <CheckCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {isError && <XCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {line.replace(/^\[subagent:\w+\]\s*/, '').replace(/^>\s*/, '').replace(/^\[[+x]\]\s*/, '')}
              </div>
            );
          })}
        </div>
      );
    },
  },
  {
    // Fallback — must be last. Shows the raw tool name so unregistered tools
    // (TodoWrite, MCP tools, plugin tools) remain identifiable.
    match: () => true,
    icon: Wrench,
    label: '',
    getSummary: (input, name?: string) => {
      const prefix = name || '';
      if (!input || typeof input !== 'object') return prefix;
      const data = input as Record<string, unknown>;
      const hint = String(
        data.file_path ?? data.path ?? data.query ?? data.pattern ?? data.url ?? data.command ?? ''
      ).trim();
      if (!hint) return prefix;
      const detail = hint.length > 50 ? `${hint.slice(0, 47)}...` : hint;
      return prefix ? `${prefix} ${detail}` : detail;
    },
  },
];

function getRenderer(name: string, input?: unknown): ToolRendererDef {
  return TOOL_REGISTRY.find((r) => r.match(name, input)) || TOOL_REGISTRY[TOOL_REGISTRY.length - 1];
}

/** Register a custom tool renderer. It takes priority over built-in ones. */
export function registerToolRenderer(def: ToolRendererDef): void {
  TOOL_REGISTRY.unshift(def);
}

// ---------------------------------------------------------------------------
// Status indicator — running: gray, completed: green, error: red
// ---------------------------------------------------------------------------

type ToolStatus = 'running' | 'success' | 'error';

function getStatus(tool: ToolAction): ToolStatus {
  if (tool.result === undefined) return 'running';
  return tool.isError ? 'error' : 'success';
}

function StatusDot({ status }: { status: ToolStatus }) {
  return (
    <AnimatePresence mode="wait">
      {status === 'running' && (
        <motion.span
          key="running"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="inline-flex"
        >
          <SpinnerGap size={14} className="shrink-0 animate-spin text-muted-foreground/50" />
        </motion.span>
      )}
      {status === 'success' && (
        <motion.span
          key="success"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="inline-flex"
        >
          <CheckCircle size={14} className="shrink-0 text-green-500" />
        </motion.span>
      )}
      {status === 'error' && (
        <motion.span
          key="error"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="inline-flex"
        >
          <XCircle size={14} className="shrink-0 text-red-500" />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Context tool grouping — auto-group 3+ consecutive read/search tools
// ---------------------------------------------------------------------------

const CONTEXT_TOOLS = new Set([
  'read', 'readfile', 'read_file',
  'glob', 'grep',
  'ls', 'list', 'list_files',
  'search', 'find_files', 'search_files',
]);

function isContextTool(name: string): boolean {
  return CONTEXT_TOOLS.has(name.toLowerCase());
}

function isActionTool(name: string): boolean {
  const n = name.toLowerCase();
  if (
    n === 'apply_patch' ||
    n.endsWith('__edit_file') ||
    n.endsWith('__write_file')
  ) return true;
  return ['bash', 'execute', 'run', 'shell', 'execute_command', 'write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(n) || n.startsWith('mcp__playwright');
}

type Segment =
  | { kind: 'context_group'; tools: ToolAction[] }
  | { kind: 'context_single'; tool: ToolAction }
  | { kind: 'action'; tool: ToolAction }
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string };

function computeSegments(
  tools: ToolAction[],
  thinkingContent?: string,
  steps?: TimelineStep[]
): Segment[] {
  if (steps && steps.length > 0) {
    const linear: Array<{ kind: 'thinking' | 'text'; content: string } | { kind: 'tool'; tool: ToolAction }> = [];
    steps.forEach((step) => {
      const toolMap = new Map(step.toolCalls.map((tool) => [tool.id, tool]));
      if (step.events && step.events.length > 0) {
        step.events.forEach((event) => {
          if (event.type === 'reasoning' && event.content.trim()) {
            linear.push({ kind: 'thinking', content: event.content });
          } else if (event.type === 'text' && event.content.trim()) {
            linear.push({ kind: 'text', content: event.content });
          } else if (event.type === 'tool') {
            const tc = toolMap.get(event.toolCallId);
            if (!tc) return;
            linear.push({
              kind: 'tool',
              tool: {
                id: tc.id,
                name: tc.name,
                input: tc.input,
                result: tc.result,
                isError: tc.isError,
                media: (tc as any).media,
              }
            });
          }
        });
        return;
      }
      if (step.reasoning?.trim()) {
        linear.push({ kind: 'thinking', content: step.reasoning });
      }
      if (step.output?.trim() && (!step.events || step.events.length === 0)) {
        linear.push({ kind: 'text', content: step.output });
      }
      step.toolCalls.forEach(tc => {
        linear.push({
          kind: 'tool',
          tool: {
            id: tc.id,
            name: tc.name,
            input: tc.input,
            result: tc.result,
            isError: tc.isError,
            media: (tc as any).media,
          }
        });
      });
    });

    const segments: Segment[] = [];
    let contextBuffer: ToolAction[] = [];

    const flushContext = () => {
      for (const t of contextBuffer) {
        segments.push({ kind: 'context_single', tool: t });
      }
      contextBuffer = [];
    };

    for (const item of linear) {
      if (item.kind === 'thinking') {
        flushContext();
        segments.push({ kind: 'thinking', content: item.content });
      } else if (item.kind === 'text') {
        flushContext();
        segments.push({ kind: 'text', content: item.content });
      } else if (item.kind === 'tool') {
        if (isActionTool(item.tool.name)) {
          flushContext();
          segments.push({ kind: 'action', tool: item.tool });
        } else {
          contextBuffer.push(item.tool);
        }
      }
    }
    flushContext();
    return segments;
  }

  const segments: Segment[] = [];
  if (thinkingContent?.trim()) {
    segments.push({ kind: 'thinking', content: thinkingContent });
  }

  let contextBuffer: ToolAction[] = [];
  const flushContext = () => {
    for (const t of contextBuffer) {
      segments.push({ kind: 'context_single', tool: t });
    }
    contextBuffer = [];
  };

  for (const tool of tools) {
    if (isActionTool(tool.name)) {
      flushContext();
      segments.push({ kind: 'action', tool });
    } else {
      contextBuffer.push(tool);
    }
  }
  flushContext();
  return segments;
}

function ContextGroup({ tools }: { tools: ToolAction[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const groupStatus: ToolStatus = hasRunning ? 'running' : hasError ? 'error' : 'success';

  return (
    <div className="my-1.5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-2 py-2 text-[13px] hover:bg-muted/40 transition-colors rounded-[6px]"
      >
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={16} className="text-blue-500" />
          <span className="font-medium text-foreground/80 ml-1">
            {hasRunning ? `正在检索 (${tools.length})` : `检索了 ${tools.length} 个文件`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasRunning && <SpinnerGap size={14} className="animate-spin text-primary" />}
          {!hasRunning && hasError && <XCircle size={14} className="text-red-500" />}
          {!hasRunning && !hasError && <CheckCircle size={14} className="text-emerald-500" />}
          <CaretDown
            size={12}
            className={cn(
              "shrink-0 text-muted-foreground/60 transition-transform duration-200 ml-1",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-border/20 bg-muted/10 p-2 space-y-1">
              {tools.map((tool, i) => (
                <ContextSingleRow key={tool.id || `ctx-${i}`} tool={tool} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking row — same style as tool rows, Brain icon → caret on hover
// ---------------------------------------------------------------------------

function ThinkingRow({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  // Always expanded during streaming, collapsed when done
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const isExpanded = userExpanded !== null ? userExpanded : Boolean(isStreaming);

  React.useEffect(() => {
    if (!isStreaming && userExpanded === null) {
      setUserExpanded(false);
    }
  }, [isStreaming, userExpanded]);

  return (
    <div className="my-1.5 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          const willExpand = !isExpanded;
          setUserExpanded(willExpand);
          if (willExpand) stopScroll();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex w-full items-center justify-between px-2 py-2 text-[13px] hover:bg-muted/40 transition-colors rounded-[6px]"
      >
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-violet-500" />
          <span className="font-medium text-foreground/80 truncate ml-1 text-left">
            {isStreaming ? '正在思考' : '思考'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {isStreaming && <SpinnerGap size={14} className="animate-spin text-primary" />}
          {!isStreaming && <CheckCircle size={14} className="text-emerald-500" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3 py-2 text-[12px] text-foreground/80 prose prose-sm dark:prose-invert max-w-none border-l-2 border-violet-500/20 ml-3">
              <Streamdown plugins={thinkingPlugins}>{content}</Streamdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact row for a single tool action
// ---------------------------------------------------------------------------

const MCP_TOOL_NAME_MAP: Record<string, string> = {
  'mcp__memory__search_nodes': '搜索记忆节点',
  'mcp__memory__read_graph': '读取记忆图谱',
  'mcp__memory__create_entities': '创建记忆实体',
  'mcp__fetch__fetch_markdown': '抓取网页(Markdown)',
  'mcp__fetch__fetch_readable': '抓取网页(Readable)',
  'mcp__fetch__fetch_json': '抓取网页(JSON)',
};

function getToolDisplayName(name: string): string {
  return MCP_TOOL_NAME_MAP[name] || name;
}

function ContextSingleRow({ tool, streamingToolOutput, expandedOverride, onToggle }: { tool: ToolAction; streamingToolOutput?: string; expandedOverride?: boolean; onToggle?: () => void }) {
  const renderer = getRenderer(tool.name, tool.input);
  const baseSummary = renderer.getSummary(tool.input, tool.name);
  const summary = MCP_TOOL_NAME_MAP[tool.name] ? baseSummary.replace(tool.name, MCP_TOOL_NAME_MAP[tool.name]) : baseSummary;
  const filePath = getFilePath(tool.input);
  const status = getStatus(tool);
  const hasDetail = renderer.icon === TerminalWindow || renderer.icon === Lightning || renderer.icon === MagnifyingGlass;
  const detailVisible = hasDetail && renderer.renderDetail && (status === 'running' || !!streamingToolOutput || !!tool.result);
  const [internalExpanded, setInternalExpanded] = useState(status === 'running');
  const [showRaw, setShowRaw] = useState(false);

  const expanded = expandedOverride !== undefined ? expandedOverride : internalExpanded;

  React.useEffect(() => {
    if (expandedOverride === undefined) {
      setInternalExpanded(status === 'running');
    }
  }, [status, expandedOverride]);

  const hasRawContent = !hasDetail && (tool.result || (tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0));

  return (
    <div className={cn(
      "my-1.5 overflow-hidden",
      status === 'error' ? "border border-red-500/20 rounded-[6px]" : ""
    )}>
      <button
        type="button"
        onClick={() => {
          if (detailVisible || hasRawContent) {
            if (hasRawContent) setShowRaw(prev => !prev);
            else if (onToggle) onToggle();
            else setInternalExpanded((prev) => !prev);
          }
        }}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-2 text-[13px] hover:bg-muted/40 transition-colors text-left rounded-[6px]",
          status === 'error' ? "bg-red-500/[0.03]" : ""
        )}
      >
        <div className="flex shrink-0 items-center justify-center">
          {createElement(renderer.icon, { size: 16, className: status === 'error' ? "text-red-500/80" : "text-blue-500" })}
        </div>

        <span className={cn(
          "font-medium truncate ml-1",
          status === 'error' ? "text-red-500/80" : "text-foreground/80"
        )}>
          {renderer.label || summary}
        </span>
        
        {(renderer.label ? !!summary : !!filePath) && (
          <>
            <span className="text-border mx-1">|</span>
            <span className={cn("font-mono text-[12px] text-muted-foreground/60 truncate", renderer.label && filePath ? "max-w-[200px]" : "flex-1")}>
              {renderer.label ? summary : truncatePath(filePath)}
            </span>
            {renderer.label && filePath && (
              <>
                <span className="text-border mx-1">|</span>
                <span className="font-mono text-[11px] text-muted-foreground/40 truncate flex-1">
                  {filePath}
                </span>
              </>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {status === 'running' && <SpinnerGap size={14} className="animate-spin text-primary" />}
          {status === 'success' && <CheckCircle size={14} className="text-emerald-500" />}
          {status === 'error' && <XCircle size={14} className="text-red-500" />}
        </div>
      </button>
      {detailVisible && expanded && renderer.renderDetail?.(tool, streamingToolOutput)}
      {hasRawContent && showRaw ? (
        <div className={cn(
          "px-3 py-3 border-l-2 ml-3",
          status === 'error' ? "border-red-500/20" : "border-blue-500/20"
        )}>
          {tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0 ? (
            <div className="mb-3">
              <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 mb-1">Input</h5>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[200px] overflow-auto">
                {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          ) : null}
          {tool.result ? (
            <div>
              <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 mb-1">
                {tool.isError ? 'Error' : 'Result'}
              </h5>
              <pre className={cn(
                "whitespace-pre-wrap break-all font-mono text-[11px] max-h-[300px] overflow-auto",
                tool.isError ? "text-red-500/80 font-medium" : "text-foreground/80",
              )}>
                {tool.result.length > 5000 ? tool.result.slice(0, 5000) + `\n… (truncated, ${tool.result.length} chars total)` : tool.result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionToolCard({ tool, isStreaming, streamingToolOutput, sessionId, rewindId }: { tool: ToolAction; isStreaming?: boolean; streamingToolOutput?: string; sessionId?: string; rewindId?: string }) {
  const k = toolKind2(tool.name);
  const status = getStatus(tool);
  
  // Unconditional hook calls at the top level
  const [expanded, setExpanded] = useState(status === 'running');

  React.useEffect(() => {
    if (status === 'running') {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [status]);

  if (k === 'write' || k === 'create') {
    const diff = extractDiff(tool);
    if (diff) {
      return <FileReviewRow diff={diff} sessionId={sessionId} rewindId={rewindId} />;
    }
  }
  
  if (k === 'bash') {
    const cmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
    const displayName = getToolDisplayName(tool.name);

    return (
      <div className="my-1.5 border border-border/50 bg-muted/30 rounded-[6px] overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between px-2 py-2 text-[13px] hover:bg-muted/40 transition-colors rounded-[6px]"
        >
          <div className="flex items-center gap-2">
            <TerminalWindow size={16} weight="bold" className="text-violet-500" />
            <span className="font-medium text-foreground/80 truncate max-w-[200px]">{displayName}</span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground ml-1">
              {status === 'running' ? '运行中' : status === 'error' ? '失败' : '完成'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
            {status === 'running' && <SpinnerGap size={14} className="animate-spin text-primary mr-1" />}
            在终端查看 <ArrowSquareOut size={12} />
          </div>
        </button>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-4 py-3 border-l-2 border-violet-500/20 ml-3">
                <div className="font-mono text-[13px] font-medium text-foreground/90 mb-2">$ {cmd}</div>
                <pre className="whitespace-pre-wrap break-all font-mono text-[12px] text-muted-foreground/80 max-h-[300px] overflow-auto">
                  {status === 'running' ? streamingToolOutput : tool.result}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
  
  return (
    <div className="bg-muted/30 p-0.5 my-1.5 border border-border/50 rounded-[6px] overflow-hidden">
      <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff helpers — fork-specific exports for StreamingMessage/MessageItem
// ---------------------------------------------------------------------------

function fp2(input: unknown): string {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return String(o.file_path ?? o.path ?? o.filePath ?? '');
}
function fname2(p: string) { return p.split('/').pop() || p; }
function countLines(text: string): number { return text ? text.split('\n').length : 0; }
function previewLines(text: string, max = 10): { lines: string[]; more: number } {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all.length <= max) return { lines: all, more: 0 };
  return { lines: all.slice(0, max), more: all.length - max };
}
function sv2(input: unknown, keys: string[]): string {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  return '';
}
function extractFirstFileFromPatch(patch: string): { path: string; mode: 'edit' | 'create' } | null {
  const m = patch.match(/^\*\*\*\s+(Update|Add)\s+File:\s+(.+)\s*$/m);
  if (!m) return null;
  return { mode: m[1] === 'Add' ? 'create' : 'edit', path: m[2].trim() };
}
function extractDiffFromPatchInput(input: unknown): DiffInfo | null {
  const patch = sv2(input, ['patch', 'patch_text', 'patchText', 'diff', 'diff_text']);
  if (!patch) return null;
  const file = extractFirstFileFromPatch(patch);
  if (!file) return null;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const removed = lines
    .filter((l) => l.startsWith('-') && !l.startsWith('---'))
    .map((l) => l.slice(1));
  const added = lines
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  const beforeText = file.mode === 'create' ? '' : removed.join('\n');
  const afterText = added.join('\n');
  const { lines: bl, more: mb } = previewLines(beforeText, 1000);
  const { lines: al, more: ma } = previewLines(afterText, 1000);
  return {
    filename: fname2(file.path),
    fullPath: file.path,
    mode: file.mode,
    added: added.length,
    removed: file.mode === 'create' ? 0 : removed.length,
    beforeLines: bl,
    afterLines: al,
    moreB: mb,
    moreA: ma,
  };
}
function extractDiffFromMcpFilesystemEditInput(input: unknown): { oldText: string; newText: string } | null {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const edits = Array.isArray(o.edits) ? o.edits as Array<Record<string, unknown>> : null;
  if (!edits || edits.length === 0) return null;

  const oldParts: string[] = [];
  const newParts: string[] = [];
  for (const edit of edits) {
    const oldText = typeof edit.oldText === 'string'
      ? edit.oldText
      : typeof edit.old_string === 'string'
        ? edit.old_string
        : '';
    const newText = typeof edit.newText === 'string'
      ? edit.newText
      : typeof edit.new_string === 'string'
        ? edit.new_string
        : '';
    if (!oldText && !newText) continue;
    if (oldText) oldParts.push(oldText);
    if (newText) newParts.push(newText);
  }
  if (oldParts.length === 0 && newParts.length === 0) return null;
  return { oldText: oldParts.join('\n'), newText: newParts.join('\n') };
}
function toolKind2(name: string): 'read' | 'write' | 'create' | 'search' | 'bash' | 'other' {
  const n = name.toLowerCase();
  if (['read', 'readfile', 'read_file', 'read_text_file', 'read_multiple_files'].includes(n)) return 'read';
  if (['edit', 'notebookedit', 'notebook_edit', 'apply_patch'].includes(n) || n.endsWith('__edit_file')) return 'write';
  if (n.endsWith('__write_file')) return 'create';
  if (['write', 'writefile', 'write_file', 'create_file', 'createfile'].includes(n)) return 'create';
  if (['glob', 'grep', 'search', 'find_files', 'search_files', 'websearch', 'web_search'].some(x => n.includes(x))) return 'search';
  if (['bash', 'execute', 'run', 'shell', 'execute_command', 'computer'].includes(n)) return 'bash';
  return 'other';
}

export interface DiffInfo {
  filename: string; fullPath: string; mode: 'edit' | 'create';
  added: number; removed: number;
  beforeLines: string[]; afterLines: string[];
  moreB: number; moreA: number;
}

export function extractDiff(t: ToolAction): DiffInfo | null {
  const k = toolKind2(t.name);
  if (k !== 'write' && k !== 'create') return null;
  const name = t.name.toLowerCase();
  if (name === 'apply_patch') {
    const diff = extractDiffFromPatchInput(t.input);
    if (diff) return diff;
  }
  const p = fp2(t.input);
  const mcpEdit = name.endsWith('__edit_file') ? extractDiffFromMcpFilesystemEditInput(t.input) : null;
  const old = mcpEdit?.oldText || sv2(t.input, ['old_string', 'oldText', 'previous']);
  const nw = mcpEdit?.newText || sv2(t.input, ['new_string', 'newText']);
  const content = sv2(t.input, ['content']);
  if (k === 'write' && !old && !nw) return null;
  if (k === 'create' && !content) return null;
  const added = k === 'create' ? countLines(content) : countLines(nw);
  const removed = k === 'create' ? 0 : countLines(old);
  const { lines: bl, more: mb } = previewLines(old || '', 1000);
  const { lines: al, more: ma } = previewLines(k === 'create' ? content : nw, 1000);
  return {
    filename: p ? fname2(p) : 'file', fullPath: p,
    mode: k === 'create' ? 'create' : 'edit',
    added, removed, beforeLines: bl, afterLines: al, moreB: mb, moreA: ma,
  };
}

// ---------------------------------------------------------------------------
// Completion summary — fork-specific export
// ---------------------------------------------------------------------------

function FileReviewRow({ diff, sessionId, rewindId }: { diff: DiffInfo; sessionId?: string; rewindId?: string }) {
  const [open, setOpen] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const openFile = () => {
    fetch('/api/open-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: diff.fullPath }),
    }).catch(() => {});
  };

  return (
    <div className="my-1.5 border border-border/50 bg-muted/30 rounded-[6px] overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-2 text-[13px] hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => { setOpen(v => !v); if (!open) stopScroll(); }}>
        <div className="flex shrink-0 items-center justify-center">
          {diff.mode === 'create'
            ? <FilePlus size={16} className="text-emerald-500" />
            : <NotePencil size={16} className="text-amber-500" />}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 ml-1">
          <span className="truncate font-medium text-foreground/80">{diff.filename}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground/50 hidden sm:inline max-w-[200px]">{diff.fullPath}</span>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0 font-mono text-[12px]">
          {diff.added > 0 && <span className="text-emerald-500/80">+{diff.added}</span>}
          {diff.removed > 0 && <span className="text-red-500/80">-{diff.removed}</span>}
        </div>
        <button
          type="button"
          className="ml-2 flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowSquareOut size={14} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div className="grid divide-y divide-border/20 border-t border-border/20 text-[11px] md:grid-cols-2 md:divide-x md:divide-y-0 max-h-[400px] overflow-y-auto">
              {diff.mode === 'edit' && (
                <div className="bg-red-500/[0.03] px-3 py-2.5">
                  <pre className="whitespace-pre-wrap break-all font-mono leading-[1.65] text-muted-foreground/50">
                    {diff.beforeLines.map((l, i) => <div key={i}><span className="mr-1 select-none text-red-400/30">−</span>{l}</div>)}
                    {diff.moreB > 0 && <div className="text-muted-foreground/25">… +{diff.moreB} lines</div>}
                  </pre>
                </div>
              )}
              <div className={cn('bg-emerald-500/[0.03] px-3 py-2.5', diff.mode === 'create' && 'md:col-span-2')}>
                <pre className="whitespace-pre-wrap break-all font-mono leading-[1.65] text-foreground/65">
                  {diff.afterLines.map((l, i) => <div key={i}><span className="mr-1 select-none text-emerald-500/30">+</span>{l}</div>)}
                  {diff.moreA > 0 && <div className="text-muted-foreground/25">… +{diff.moreA} lines</div>}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CompletionBar({
  changedFiles, errCount, sessionId, rewindId,
}: {
  changedFiles: { tool: ToolAction; diff: DiffInfo }[];
  errCount: number;
  sessionId?: string;
  rewindId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalAdded = changedFiles.reduce((acc, f) => acc + f.diff.added, 0);
  const totalRemoved = changedFiles.reduce((acc, f) => acc + f.diff.removed, 0);
  const pending = changedFiles.length;

  if (pending === 0) return null;

  return (
    <div className="mt-2 flex justify-start">
      <div className="w-fit min-w-[320px] max-w-[90%] overflow-hidden rounded-lg border border-border/40 bg-muted/20 shadow-sm">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Code size={14} weight="bold" />
          </div>
          <div className="min-w-0 flex-1 text-[13px] text-foreground/90 flex items-center gap-2">
            <span className="font-medium">{pending} 个文件已更改</span>
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-emerald-500 font-mono">+{totalAdded}</span>
              <span className="text-red-500 font-mono">-{totalRemoved}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1 text-[12px] font-medium text-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <span>查看变更</span>
            <CaretDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: 0.16 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="border-t border-border/20 max-h-[480px] overflow-y-auto bg-muted/5">
                {changedFiles.map(({ tool: t, diff: d }, i) => (
                  <FileReviewRow key={t.id || `fr-${i}`} diff={d} sessionId={sessionId} rewindId={rewindId} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main group component
// ---------------------------------------------------------------------------

export function ToolActionsGroup({
  tools,
  steps,
  isStreaming,
  streamingToolOutput,
  thinkingContent,
  statusText,
  flat,
  sessionId,
  rewindUserMessageId,
}: ToolActionsGroupProps & { flat?: boolean; sessionId?: string; rewindUserMessageId?: string }) {
  const [expanded, setExpanded] = useState(false);

  // If streaming and tools/thinking are present, default to expanded
  React.useEffect(() => {
    if (isStreaming && (tools.length > 0 || thinkingContent || (steps && steps.length > 0))) {
      setExpanded(true);
    }
  }, [isStreaming, tools.length, thinkingContent, steps]);

  const hasRunningTool = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const groupStatus = hasRunningTool ? 'running' : (hasError ? 'error' : 'success');

  const segments = computeSegments(tools, thinkingContent, steps);

  const renderSegments = () => {
    const blocks: React.ReactNode[] = [];
    let currentLineGroup: React.ReactNode[] = [];
    
    const flushLineGroup = () => {
      if (currentLineGroup.length > 0) {
        blocks.push(
          <div key={`line-${blocks.length}`} className="my-1.5 flex flex-col">
            {currentLineGroup}
          </div>
        );
        currentLineGroup = [];
      }
    };

    segments.forEach((segment, idx) => {
      if (segment.kind === 'action') {
        flushLineGroup();
        blocks.push(
          <ActionToolCard
            key={`action-${idx}`}
            tool={segment.tool} 
            isStreaming={isStreaming && segment.tool.result === undefined} 
            streamingToolOutput={isStreaming && segment.tool.result === undefined ? streamingToolOutput : undefined}
            sessionId={sessionId}
            rewindId={rewindUserMessageId}
          />
        );
      } else if (segment.kind === 'thinking') {
        flushLineGroup();
        blocks.push(
          <ThinkingRow key={`think-${idx}`} content={segment.content} isStreaming={isStreaming} />
        );
      } else if (segment.kind === 'text') {
        flushLineGroup();
        blocks.push(
          <div key={`text-${idx}`} className="my-1.5 px-2 text-[12px] text-muted-foreground/60 leading-relaxed break-words prose prose-sm dark:prose-invert max-w-none">
            <Streamdown plugins={thinkingPlugins}>{segment.content}</Streamdown>
          </div>
        );
      } else if (segment.kind === 'context_group') {
        currentLineGroup.push(<ContextGroup key={`ctx-group-${idx}`} tools={segment.tools} />);
      } else if (segment.kind === 'context_single') {
        currentLineGroup.push(<ContextSingleRow key={`ctx-single-${idx}`} tool={segment.tool} streamingToolOutput={isStreaming && segment.tool.result === undefined ? streamingToolOutput : undefined} />);
      }
    });
    flushLineGroup();
    
    return <>{blocks}</>;
  };

  // Filter out raw JSON payloads from statusText
  const displayStatusText = statusText && (!statusText.startsWith('{') && !statusText.includes('"subtype"')) ? statusText : undefined;

  // If flat mode, just render the segments without the outer container
  if (flat) {
    return (
      <div className="my-2">
        {renderSegments()}
      </div>
    );
  }

  // Trae style collapsible accordion
  const hasTools = tools.length > 0;
  
  let statusTitle = '';
  if (hasTools) {
    if (isStreaming) {
      statusTitle = hasRunningTool ? '正在执行任务...' : '正在思考...';
    } else {
      statusTitle = groupStatus === 'error' ? '执行遇到错误' : `${tools.length}个已完成 · 思考与执行完毕`;
    }
  } else {
    if (isStreaming) {
      statusTitle = '正在思考...';
    } else {
      statusTitle = '思考完毕';
    }
  }

  // Override if there is specific status text
  // We no longer override with displayStatusText because system status (like "Loading rules...")
  // should be displayed independently in StreamingStatusBar.

  return (
    <div className="my-2">
      {tools.length > 0 || (steps && steps.length > 0) ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between py-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors group"
        >
          <div className="flex items-center gap-2 truncate">
            <div className={cn(
              "flex items-center justify-center rounded h-[18px] text-[11px] font-medium",
              hasTools ? "bg-muted/80 dark:bg-muted/60 text-foreground/90 px-1.5 min-w-[20px]" : "bg-transparent text-muted-foreground min-w-0"
            )}>
              {hasTools ? tools.length : <Brain size={14} weight="bold" />}
            </div>
            
            <span className="truncate group-hover:text-foreground transition-colors font-medium">
              {statusTitle}
            </span>
          </div>
          <CaretDown
            size={14}
            className={cn("shrink-0 transition-transform duration-200 opacity-50 group-hover:opacity-100", expanded && "rotate-180")}
          />
        </button>
      ) : (
        displayStatusText && (
          <div className="py-1.5 text-[13px] text-muted-foreground">
            {displayStatusText}
          </div>
        )
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="py-2">
              <div className="ml-[9px] mt-0.5 border-l-[2px] border-border/60 pl-4 space-y-0.5">
                {renderSegments()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
