'use client';

import React, { useState, createElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Icon } from "@phosphor-icons/react";
import {
  File,
  NotePencil,
  Terminal,
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
  ArrowSquareOut,
  Code,
  FilePlus,
  CaretDown,
} from "@phosphor-icons/react";
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
  /** Referenced context files */
  referencedFiles?: string[];
}

// ---------------------------------------------------------------------------
// Tool Registry — extensible per-type rendering
// ---------------------------------------------------------------------------

interface ToolRendererDef {
  match: (name: string) => boolean;
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
    icon: Terminal,
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
    label: 'Edit',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['read', 'readfile', 'read_file'].includes(n.toLowerCase()),
    icon: File,
    label: 'Read',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    icon: MagnifyingGlass,
    label: 'Search',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : 'search';
    },
  },
  {
    match: (n) => n.toLowerCase() === 'agent',
    icon: Lightning,
    label: 'Agent',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const agentType = (inp?.agent || 'general') as string;
      const prompt = (inp?.prompt || '') as string;
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
      const str = JSON.stringify(input);
      const detail = str.length > 50 ? str.slice(0, 47) + '...' : str;
      return prefix ? `${prefix} ${detail}` : detail;
    },
  },
];

function getRenderer(name: string): ToolRendererDef {
  return TOOL_REGISTRY.find((r) => r.match(name)) || TOOL_REGISTRY[TOOL_REGISTRY.length - 1];
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
  return ['bash', 'execute', 'run', 'shell', 'execute_command', 'write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(n) || n.startsWith('mcp__playwright');
}

type Segment =
  | { kind: 'context_group'; tools: ToolAction[] }
  | { kind: 'context_single'; tool: ToolAction }
  | { kind: 'action'; tool: ToolAction }
  | { kind: 'thinking'; content: string };

function computeSegments(
  tools: ToolAction[],
  thinkingContent?: string,
  steps?: TimelineStep[]
): Segment[] {
  if (steps && steps.length > 0) {
    const linear: Array<{ kind: 'thinking'; content: string } | { kind: 'tool'; tool: ToolAction }> = [];
    steps.forEach(step => {
      if (step.reasoning?.trim()) {
        linear.push({ kind: 'thinking', content: step.reasoning });
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
      if (contextBuffer.length >= 3) {
        segments.push({ kind: 'context_group', tools: contextBuffer });
      } else {
        for (const t of contextBuffer) {
          segments.push({ kind: 'context_single', tool: t });
        }
      }
      contextBuffer = [];
    };

    for (const item of linear) {
      if (item.kind === 'thinking') {
        flushContext();
        segments.push({ kind: 'thinking', content: item.content });
      } else {
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
    if (contextBuffer.length >= 3) {
      segments.push({ kind: 'context_group', tools: contextBuffer });
    } else {
      for (const t of contextBuffer) {
        segments.push({ kind: 'context_single', tool: t });
      }
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
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors"
      >
        <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
        <CaretRight
          size={10}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        <span className="font-medium text-muted-foreground">
          {hasRunning ? `Gathering context (${tools.length})` : `Gathered context (${tools.length} files)`}
        </span>
        <span className="ml-auto">
          <StatusDot status={groupStatus} />
        </span>
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
            <div className="ml-6 border-l-2 border-border/30 pl-2">
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
  // Default open during streaming, collapsed in history
  const [expanded, setExpanded] = useState(!!isStreaming);
  const [hovered, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  // Extract summary from first **bold** or # heading
  const summary = (() => {
    const boldMatch = content.match(/\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1];
    const headingMatch = content.match(/^#{1,4}\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    return isStreaming ? 'Thinking...' : 'Thought';
  })();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded;
          setExpanded(willExpand);
          // Detach from auto-scroll when expanding to prevent page jump
          if (willExpand) stopScroll();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors w-full"
      >
        {hovered ? (
          <CaretRight
            size={14}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        ) : (
          <Brain size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-muted-foreground/60 truncate flex-1 text-left">
          {isStreaming ? <Shimmer duration={1.5}>{summary}</Shimmer> : summary}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-6 px-2 py-1.5 text-xs text-muted-foreground/70 border-l-2 border-border/30 prose prose-sm dark:prose-invert max-w-none">
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

function ContextSingleRow({ tool, streamingToolOutput }: { tool: ToolAction; streamingToolOutput?: string }) {
  const renderer = getRenderer(tool.name);
  const baseSummary = renderer.getSummary(tool.input, tool.name);
  const summary = MCP_TOOL_NAME_MAP[tool.name] ? baseSummary.replace(tool.name, MCP_TOOL_NAME_MAP[tool.name]) : baseSummary;
  const filePath = getFilePath(tool.input);
  const status = getStatus(tool);
  const hasDetail = renderer.icon === Terminal || renderer.icon === Lightning;
  const detailVisible = hasDetail && renderer.renderDetail && (status === 'running' || !!streamingToolOutput || !!tool.result);
  const [expanded, setExpanded] = useState(status === 'running');
  const [showRaw, setShowRaw] = useState(false);

  React.useEffect(() => {
    setExpanded(status === 'running');
  }, [status]);

  const hasRawContent = !hasDetail && (tool.result || (tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0));

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (detailVisible || hasRawContent) {
            if (hasRawContent) setShowRaw(prev => !prev);
            else setExpanded((prev) => !prev);
          }
        }}
        className="flex w-full items-center gap-2 px-2 py-1 min-h-[28px] text-[13px] hover:bg-muted/30 rounded-sm transition-colors text-left"
      >
        {createElement(renderer.icon, { size: 14, className: "shrink-0 text-muted-foreground" })}

        <span className="font-mono text-muted-foreground/70 truncate flex-1">
          {summary}
        </span>

        {filePath && !hasDetail && (
          <span className="text-muted-foreground/40 text-[11px] font-mono truncate max-w-[200px] hidden sm:inline">
            {truncatePath(filePath)}
          </span>
        )}

        {tool.media && tool.media.length > 0 && (
          <ImageIcon size={14} className="shrink-0 text-primary/60" />
        )}

        {detailVisible && (
          <CaretRight
            size={10}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        )}
        {hasRawContent ? (
          <CaretRight
            size={10}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              showRaw && "rotate-90",
            )}
          />
        ) : null}
        <StatusDot status={status} />
      </button>
      {detailVisible && expanded && renderer.renderDetail?.(tool, streamingToolOutput)}
      {hasRawContent && showRaw ? (
        <div className="mt-1 ml-[11px] space-y-1.5 border-l-[2px] border-border/40 pl-4">
          {tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0 ? (
            <div className="rounded bg-muted/40 px-2 py-1.5">
              <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1">Input</h5>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80 max-h-[200px] overflow-auto">
                {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          ) : null}
          {tool.result ? (
            <div className={cn(
              "rounded px-2 py-1.5",
              tool.isError ? "bg-destructive/10" : "bg-muted/40",
            )}>
              <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1">
                {tool.isError ? 'Error' : 'Result'}
              </h5>
              <pre className={cn(
                "whitespace-pre-wrap break-all font-mono text-[11px] max-h-[300px] overflow-auto",
                tool.isError ? "text-destructive/80" : "text-muted-foreground/80",
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
  if (k === 'write' || k === 'create') {
    const diff = extractDiff(tool);
    if (diff) {
      return (
        <div className="rounded-lg border border-border/40 shadow-sm overflow-hidden bg-muted/20">
          <FileReviewRow diff={diff} sessionId={sessionId} rewindId={rewindId} />
        </div>
      );
    }
  }
  
  if (k === 'bash') {
    const cmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
    const status = getStatus(tool);
    return (
      <div className="rounded-lg border border-border/40 shadow-sm overflow-hidden bg-muted/20">
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] bg-muted/30">
          <Terminal size={14} className="text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground/80 truncate flex items-center">
            {status === 'running' ? '正在执行命令' : status === 'error' ? '命令执行失败' : '命令已执行'}
            <span className="ml-2 font-mono text-muted-foreground/70 font-normal truncate max-w-[300px]">{cmd}</span>
          </span>
          <span className="ml-auto shrink-0">
             <StatusDot status={status} />
          </span>
        </div>
        {(tool.result || streamingToolOutput) && (
          <div className="border-t border-border/20 bg-muted/10 px-3 py-2">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80 max-h-[300px] overflow-auto">
              {status === 'running' ? streamingToolOutput : tool.result}
            </pre>
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div className="rounded-lg border border-border/40 shadow-sm overflow-hidden bg-muted/20 p-1">
      <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header summary helper — build running task description
// ---------------------------------------------------------------------------

function getRunningDescription(tools: ToolAction[]): string {
  const running = tools.filter((t) => t.result === undefined);
  if (running.length === 0) return '';
  const last = running[running.length - 1];
  return getRenderer(last.name).getSummary(last.input, last.name);
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
function toolKind2(name: string): 'read' | 'write' | 'create' | 'search' | 'bash' | 'other' {
  const n = name.toLowerCase();
  if (['read', 'readfile', 'read_file', 'read_text_file', 'read_multiple_files'].includes(n)) return 'read';
  if (['edit', 'notebookedit', 'notebook_edit'].includes(n)) return 'write';
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
  const p = fp2(t.input);
  const old = sv2(t.input, ['old_string', 'oldText', 'previous']);
  const nw = sv2(t.input, ['new_string', 'newText']);
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
    <div className="border-t border-border/20 first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-3 text-[12px]">
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          diff.mode === 'create' ? 'bg-emerald-500/12' : 'bg-amber-500/12',
        )}>
          {diff.mode === 'create'
            ? <FilePlus size={12} className="text-emerald-500/70" />
            : <NotePencil size={12} className="text-amber-500/70" />}
        </div>
        <button
          type="button"
          onClick={openFile}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:text-foreground"
        >
          <span className="truncate font-mono text-[13px] text-foreground/78">{diff.filename}</span>
        </button>
        {diff.added > 0 && <span className="text-emerald-500/70">+{diff.added}</span>}
        {diff.removed > 0 && <span className="text-red-500/65">-{diff.removed}</span>}
        <button
          type="button"
          onClick={() => { setOpen(v => !v); if (!open) stopScroll(); }}
          className="rounded px-1 text-muted-foreground/45 transition hover:text-muted-foreground/70"
          title={open ? '收起 diff' : '展开 diff'}
        >
          <CaretDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
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
  referencedFiles,
}: ToolActionsGroupProps & { flat?: boolean; sessionId?: string; rewindUserMessageId?: string; referencedFiles?: string[] }) {
  const [expanded, setExpanded] = useState(false);

  // If streaming and tools/thinking are present, default to expanded
  React.useEffect(() => {
    if (isStreaming && (tools.length > 0 || thinkingContent || (steps && steps.length > 0))) {
      setExpanded(true);
    }
  }, [isStreaming, tools.length, thinkingContent, steps?.length]);

  const hasRunningTool = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const groupStatus = hasRunningTool ? 'running' : hasError ? 'error' : 'success';

  const segments = computeSegments(tools, thinkingContent, steps);

  const renderSegments = () => {
    const blocks: React.ReactNode[] = [];
    let currentLineGroup: React.ReactNode[] = [];
    
    const flushLineGroup = () => {
      if (currentLineGroup.length > 0) {
        blocks.push(
          <div key={`line-${blocks.length}`} className="ml-[11px] border-l-[2px] border-border/40 pl-4 space-y-1 my-2.5">
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
          <div key={`action-${idx}`} className="my-3 ml-2.5">
            <ActionToolCard 
              tool={segment.tool} 
              isStreaming={isStreaming && segment.tool.result === undefined} 
              streamingToolOutput={isStreaming && segment.tool.result === undefined ? streamingToolOutput : undefined}
              sessionId={sessionId}
              rewindId={rewindUserMessageId}
            />
          </div>
        );
      } else if (segment.kind === 'thinking') {
        // Render thinking inline as plain text (no accordion)
        currentLineGroup.push(
          <div key={`think-${idx}`} className="my-2.5">
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground/70 mb-1.5 font-medium">
              <Brain size={14} />
              <span>Thinking...</span>
            </div>
            <div className="text-[12.5px] leading-relaxed text-muted-foreground/80 prose prose-sm dark:prose-invert max-w-none">
              <Streamdown plugins={thinkingPlugins}>{segment.content}</Streamdown>
            </div>
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
  return (
    <div className="my-2">
      {tools.length > 0 || (steps && steps.length > 0) ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between py-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors group"
        >
          <div className="flex items-center gap-2 truncate">
            <div className="flex items-center justify-center bg-muted/60 dark:bg-muted/40 rounded px-1.5 min-w-[20px] h-[18px] text-[11px] font-medium text-foreground/80">
              {tools.length > 0 ? tools.length : (steps?.length || 1)}
            </div>
            
            <span className="truncate group-hover:text-foreground transition-colors">
              {displayStatusText || 
               (hasRunningTool ? '正在执行任务...' : 
                groupStatus === 'error' ? '执行遇到错误' : `${tools.length > 0 ? tools.length : (steps?.length || 1)}个已完成 · 思考与执行完毕`)}
              {referencedFiles && referencedFiles.length > 0 && ` · 引用 ${referencedFiles.length} 个上下文`}
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
              <div className="ml-[9px] mt-0.5 border-l-[2px] border-border/40 pl-4 space-y-0.5">
                {renderSegments()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
