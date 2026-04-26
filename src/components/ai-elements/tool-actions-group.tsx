'use client';

import React, { useState, createElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';
import { TerminalWindow } from '@phosphor-icons/react';
import {
  NotePencil,
  MagnifyingGlass,
  Wrench,
  SpinnerGap,
  CheckCircle,
  XCircle,
  Brain,
  Lightning,
  Robot,
  Eyeglasses,
  ArrowSquareOut,
  Code,
  Eye,
  FileText,
  ChatCircle,
  FilePlus,
  CaretDown,
  Play,
  ListChecks,
  ShieldCheck,
  PencilSimple,
  FolderOpen
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { usePanel } from '@/hooks/usePanel';

const RENDERABLE_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.tsx', '.jsx', '.csv', '.tsv']);

function canPreview(filename: string): boolean {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return RENDERABLE_EXTENSIONS.has(ext);
}
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { usePanelStore } from "@/store/usePanelStore";

const LOCAL_URL_REGEX = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/i;
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';

const thinkingPlugins = { cjk, math, mermaid };

import type { MediaBlock, TimelineStep } from '@/types';
import { AgentTimeline } from '../chat/AgentTimeline';
import {
  createTimelineAccumulator,
  appendTimelineReasoning,
  appendTimelineOutput,
  appendTimelineToolUse,
  appendTimelineToolResult,
  completeTimelineStep,
  cloneTimelineSteps,
  finalizeTimelineSteps
} from '@/lib/agent-timeline';

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
  /** When true, filter out sub-agent tools from the timeline */
  hideSubAgents?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Registry — extensible per-type rendering
// ---------------------------------------------------------------------------

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
                usePanelStore.getState().openBrowserTab(part, "网页预览");
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

interface ToolRendererDef {
  match: (name: string, input?: unknown) => boolean;
  icon: Icon;
  label: string;
  getSummary: (input: unknown, name?: string, tool?: ToolAction) => string;
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

export const AGENT_META: Record<string, { icon: React.ElementType, color: string, bg: string, label: string }> = {
  search: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '搜索者' },
  explorer: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '探索者' },
  explore: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '探索者' },
  planner: { icon: ListChecks, color: 'text-purple-500', bg: 'bg-purple-500/10', label: '规划者' },
  executor: { icon: PencilSimple, color: 'text-orange-500', bg: 'bg-orange-500/10', label: '执行者' },
  verifier: { icon: ShieldCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: '验证者' },
  analyst: { icon: Brain, color: 'text-indigo-500', bg: 'bg-indigo-500/10', label: '分析者' },
  tester: { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', label: '测试者' },
  qa: { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', label: '质量保证' },
  debugger: { icon: Wrench, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: '调试者' },
  general: { icon: Robot, color: 'text-slate-500', bg: 'bg-slate-500/10', label: '通用助手' },
  architect: { icon: Brain, color: 'text-indigo-600', bg: 'bg-indigo-600/10', label: '架构师' },
  tracer: { icon: MagnifyingGlass, color: 'text-blue-400', bg: 'bg-blue-400/10', label: '追踪者' },
  'security-reviewer': { icon: ShieldCheck, color: 'text-rose-600', bg: 'bg-rose-600/10', label: '安全审查员' },
  'code-reviewer': { icon: Eyeglasses, color: 'text-violet-500', bg: 'bg-violet-500/10', label: '代码审查员' },
  'test-engineer': { icon: ShieldCheck, color: 'text-rose-400', bg: 'bg-rose-400/10', label: '测试工程师' },
  designer: { icon: NotePencil, color: 'text-pink-500', bg: 'bg-pink-500/10', label: '设计师' },
  writer: { icon: NotePencil, color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: '技术作者' },
  'qa-tester': { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', label: 'QA 测试员' },
  scientist: { icon: Brain, color: 'text-teal-500', bg: 'bg-teal-500/10', label: '数据科学家' },
  'document-specialist': { icon: NotePencil, color: 'text-sky-500', bg: 'bg-sky-500/10', label: '文档专家' },
  'git-master': { icon: Code, color: 'text-orange-600', bg: 'bg-orange-600/10', label: 'Git 大师' },
  'code-simplifier': { icon: Wrench, color: 'text-yellow-600', bg: 'bg-yellow-600/10', label: '代码简化者' },
  critic: { icon: Eyeglasses, color: 'text-red-500', bg: 'bg-red-500/10', label: '审查员' }
};

export function isSubAgentTool(name: string): boolean {
  const lowerName = name.toLowerCase();
  // Do NOT filter out 'team' tool, so the "团队协作模式" card remains visible!
  // Only filter out the individual sub-agents that are already rendered by SubAgentTimeline.
  if (['agent', 'mcp__codepilot-agent__agent'].includes(lowerName)) return true;
  if (lowerName.includes('mcp__codepilot-agent__')) return true;
  return !!AGENT_META[lowerName] || lowerName.endsWith('agent') || lowerName.replace(/\s+/g, '') === 'searchagent';
}

function TeamAgentTimelines({ outputText, isRunning }: { outputText: string, isRunning: boolean }) {
  // 1. Check if outputText has agent outputs (Team runner format)
  // We determine if this is a team pipeline by looking for JSON with an 'agent' field.
  const hasTeamFormat = React.useMemo(() => {
    if (!outputText) return false;
    const lines = outputText.split('\n').filter(Boolean);
    // Scan all lines to be sure, since first few lines might just be text before JSON starts
    return lines.some(line => {
      try {
        const d = JSON.parse(line);
        return Boolean(d.agent);
      } catch {
        return false;
      }
    });
  }, [outputText]);

  if (!hasTeamFormat) {
    // If it's just raw text output from the agent, render it directly as text
    return (
      <div className="mt-2 ml-3 border-l-2 border-primary/20 pl-3 py-1 bg-background/30 rounded-r-md">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[300px] overflow-auto">
          <Linkify>{outputText}</Linkify>
        </pre>
      </div>
    );
  }

  const agentStates = React.useMemo(() => {
    const states = new Map<string, { model?: string, state: ReturnType<typeof createTimelineAccumulator> }>();
    if (!outputText) return states;

    const lines = outputText.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (!data.agent) continue;
        
        let entry = states.get(data.agent);
        if (!entry) {
          entry = { state: createTimelineAccumulator(Date.now()) };
          states.set(data.agent, entry);
        }
        
        if (data.event === 'start') {
          if (data.model) entry.model = data.model;
        } else if (data.event === 'done') {
          completeTimelineStep(entry.state, undefined, Date.now());
        } else if (data.payload) {
          const event = data.payload;
          const now = Date.now();
          if (event.type === 'step_status') {
            // we could sync status here, but the standard events are enough
          } else if (event.type === 'reasoning' || event.type === 'thinking') {
            appendTimelineReasoning(entry.state, event.data || '', now);
          } else if (event.type === 'text') {
            appendTimelineOutput(entry.state, event.data || '', now);
          } else if (event.type === 'tool_use') {
            const t = JSON.parse(event.data);
            appendTimelineToolUse(entry.state, { id: t.id, name: t.name, input: t.input }, now);
          } else if (event.type === 'tool_result') {
            const r = JSON.parse(event.data);
            appendTimelineToolResult(entry.state, { tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error }, now);
          }
        }
      } catch {
        // Not a JSON line or invalid
      }
    }
    return states;
  }, [outputText]);

  if (agentStates.size === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2 mb-2 ml-4 relative">
      {/* Visual connecting line for the pipeline */}
      <div className="absolute left-[13px] top-4 bottom-4 w-px bg-border/40 -z-10" />

      {Array.from(agentStates.entries()).map(([agentId, entry]) => {
        const steps = cloneTimelineSteps(entry.state);
        // Force finalize if not running overall
        if (!isRunning && steps.length > 0) {
          const last = steps[steps.length - 1];
          if (last && last.status === 'running') {
            last.status = 'completed';
          }
        }
        
        const lastStep = steps[steps.length - 1];
        const isAgentRunning = isRunning && (!lastStep || (lastStep.status !== 'completed' && lastStep.status !== 'failed'));
        const hasError = steps.some(s => s.status === 'failed' || s.error);
        
        const meta = AGENT_META[agentId.toLowerCase()] || { icon: Brain, color: 'text-muted-foreground', bg: 'bg-muted/30', label: `智能体 (${agentId})` };
        const IconComponent = meta.icon;

        // Force fixed height container for running agents to prevent jumping when content updates
        // CRITICAL FIX 5: Use a fixed height with scroll for running agents, but let it grow naturally
        // when completed so it doesn't jump.
        return (
          <div key={agentId} className={cn("border rounded-xl overflow-hidden shadow-sm z-10 bg-card my-1 transition-all duration-300", `border-${meta.color.split('-')[1]}-500/20`)}>
            <div className={cn("px-3 py-2 border-b flex items-center justify-between", meta.bg, `border-${meta.color.split('-')[1]}-500/20`)}>
              <div className="flex items-center gap-2">
                <IconComponent size={14} className={cn(meta.color, isAgentRunning && "animate-pulse")} />
                <span className="font-medium text-xs tracking-wide text-foreground/90">
                  {meta.label} 
                  <span className={cn("ml-2", isAgentRunning ? "text-blue-500" : (hasError ? "text-red-500" : "text-emerald-500"))}>
                    {isAgentRunning ? '执行中...' : (hasError ? '执行失败' : '执行完毕')}
                  </span>
                </span>
              </div>
              {entry.model && (
                <div className="text-[10px] font-mono bg-background/50 border border-border/50 px-1.5 py-0.5 rounded text-muted-foreground">
                  {entry.model.split('/').pop()}
                </div>
              )}
            </div>
            
            <AnimatePresence initial={false}>
              {/* Only conditionally render AnimatePresence to keep it open when done */}
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className={cn("p-2 bg-muted/10 [&_.text-sm]:!text-xs", isAgentRunning && "h-[250px] overflow-y-auto")}>
                  <AgentTimeline steps={steps} compact={true} />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function parseMcpResultText(result: string): string {
  if (!result) return '';
  try {
    const parsed = JSON.parse(result);
    
    // Check if it matches the Anthropic SDK block structure format
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.content)) {
      return parsed.content.map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
        return JSON.stringify(item);
      }).join('\n');
    }
    
    // Check if it's already an array of strings
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return item;
        if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
        return JSON.stringify(item);
      }).join('\n');
    }
    
    // Look for text field
    if (parsed && typeof parsed === 'object') {
      if (parsed.text) return String(parsed.text);
      if (parsed.content && typeof parsed.content === 'string') return parsed.content;
      
      // Attempt to prettify JSON objects as a fallback
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // If it's not valid JSON, check if it's just a raw string wrapped in quotes
    if (typeof result === 'string' && result.startsWith('"') && result.endsWith('"')) {
       try {
         return JSON.parse(result);
       } catch {
         return result;
       }
    }
    return result;
  }
  return result;
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
    match: (n) => ['read', 'readfile', 'read_file', 'mcp__filesystem__read_file'].includes(n.toLowerCase()),
    icon: Eyeglasses,
    label: '读取文件',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : '文件';
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      if (isRunning) {
        return (
          <div className="mt-2 ml-3 pl-3 py-1 space-y-1 text-[11px] text-muted-foreground/60 italic">
            正在读取文件内容...
          </div>
        );
      }
      const outputText = tool.result;
      if (!outputText) return null;
      
      const cleanText = parseMcpResultText(outputText);
      
      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-2 bg-background/30 rounded-r-md">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80 max-h-[300px] overflow-auto">
            {cleanText.length > 5000 ? cleanText.slice(0, 5000) + `\n… (已截断，共 ${cleanText.length} 字符)` : cleanText}
          </pre>
        </div>
      );
    }
  },
  {
    match: (n) => ['list_directory', 'directory_tree', 'mcp__filesystem__list_directory', 'mcp__filesystem__directory_tree'].includes(n.toLowerCase()),
    icon: FolderOpen,
    label: '查看目录',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : '目录';
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      if (isRunning) {
        return (
          <div className="mt-2 ml-3 pl-3 py-1 space-y-1 text-[11px] text-muted-foreground/60 italic">
            正在查看目录内容...
          </div>
        );
      }
      const outputText = tool.result;
      if (!outputText) return null;
      
      const cleanText = parseMcpResultText(outputText);
      
      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-2 bg-background/30 rounded-r-md">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80 max-h-[300px] overflow-auto">
            {cleanText.length > 5000 ? cleanText.slice(0, 5000) + `\n… (已截断，共 ${cleanText.length} 字符)` : cleanText}
          </pre>
        </div>
      );
    }
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    icon: MagnifyingGlass,
    label: '搜索',
    getSummary: (input, name, tool) => {
      const outputText = tool?.result;
      if (outputText) {
        // Try to get the first line that looks like "Found X files", "找到 X 个文件", "Found X results", etc.
        const lines = outputText.split('\n').filter(l => l.trim());
        const summaryLine = lines.find(l => /^found\s+\d+/i.test(l) || /^找到\s+\d+/i.test(l) || /^匹配\s+\d+/i.test(l) || /^\d+\s+matches/i.test(l) || /^\d+\s+results/i.test(l));
        if (summaryLine) {
          return summaryLine;
        }
      }
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

      // If the first line is our summary line, we can skip rendering it in the detail body
      if (lines.length > 0 && (/^found\s+\d+/i.test(lines[0]) || /^找到\s+\d+/i.test(lines[0]) || /^匹配\s+\d+/i.test(lines[0]) || /^\d+\s+matches/i.test(lines[0]) || /^\d+\s+results/i.test(lines[0]))) {
        lines = lines.slice(1);
      }

      if (lines.length === 0) return null;

      const displayLines = lines.slice(0, 8);
      const more = lines.length - displayLines.length;

      return (
        <div className="mt-1 ml-[11px] border-l-2 border-blue-500/20 pl-4 py-1 space-y-1">
          {displayLines.map((line, i) => {
            // Very basic heuristic to check if it's a file path
            // For example: /Users/... or src/...
            const isFilePath = !line.includes(' ') && (line.includes('/') || line.includes('\\')) && line.includes('.');
            
            // Grep might return path:line:content
            const matchFormat = line.match(/^([^:]+):(\d+):(.*)$/);
            
            return (
              <div key={i} className="text-[11px] font-mono text-muted-foreground/70 truncate flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-blue-500/40 shrink-0" />
                {isFilePath ? (
                  <span 
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer truncate"
                    onClick={(e) => {
                      e.stopPropagation();
                      fetch('/api/open-file', {
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: line }),
                      }).catch(() => {});
                    }}
                    title="点击在编辑器中打开文件"
                  >
                    {line}
                  </span>
                ) : matchFormat ? (
                  <div className="truncate flex items-center">
                    <span 
                      className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        fetch('/api/open-file', {
                          method: 'POST', 
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: matchFormat[1] }),
                        }).catch(() => {});
                      }}
                    >
                      {matchFormat[1]}
                    </span>
                    <span className="text-muted-foreground/50 mx-1 shrink-0">:{matchFormat[2]}:</span>
                    <span className="truncate">{matchFormat[3]}</span>
                  </div>
                ) : (
                  <span>{line}</span>
                )}
              </div>
            );
          })}
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
      return (n.toLowerCase() === 'team' || n.toLowerCase().includes('__team'));
    },
    icon: Robot,
    label: '团队协作模式',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const prompt = (inp?.goal || inp?.prompt || inp?.description || inp?.query || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return `${short}`;
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const inp = tool.input as Record<string, unknown> | undefined;
      const prompt = (inp?.goal || inp?.prompt || inp?.description || inp?.query || '') as string;
      
      return (
        <div className="px-3 pb-3 pt-2 border-t border-purple-500/10 mt-1">
          <div className="text-[12px] text-purple-600/80 dark:text-purple-400/80 mb-1 font-medium">任务详情：</div>
          <div className="text-[12px] text-muted-foreground/80 break-words whitespace-pre-wrap leading-relaxed">
            {prompt || '无任务详情'}
          </div>
          {isRunning && (
            <div className="mt-3 text-[11px] text-purple-500/60 italic flex items-center gap-1.5">
              <SpinnerGap size={12} className="animate-spin" />
              正在协同规划与执行任务，请查看底部面板...
            </div>
          )}
        </div>
      );
    },
  },
  {
    match: (n, input) => {
      const inp = input as Record<string, unknown> | undefined;
      return (n.toLowerCase() === 'agent' || n.toLowerCase().includes('__agent')) && (inp?.agent === 'explore' || inp?.subagent_type === 'explore');
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
      if (!isRunning) {
        return (
          <div className="px-3 py-3 border-l-2 ml-3 border-blue-500/20 bg-background/50 rounded-r-md mt-1">
            {tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0 ? (
              <div className="mb-3">
                <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 mb-1">任务详情 (Input)</h5>
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[200px] overflow-auto">
                  {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            ) : null}
            {tool.result ? (
              <div>
                <h5 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 mb-1">
                  {tool.isError ? '执行失败 (Error)' : '执行结果 (Result)'}
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
        );
      }

      const outputText = streamingOutput;
      if (!outputText) return null;

      // Parse progress lines into structured items
      const lines = (outputText || '').split('\n').filter(Boolean);
      // Show more lines for sub-agent transparency
      const visible = lines.slice(-15);

      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-1 space-y-1 bg-background/30 rounded-r-md">
          {visible.map((line, i) => {
            const isActive = line.startsWith('>');
            const isDone = line.startsWith('[+]');
            const isError = line.startsWith('[x]');
            const isHeader = line.startsWith('[subagent:');
            
            // Highlight tool calls from the sub-agent
            if (isActive) {
              return (
                <div key={i} className="text-[11px] font-mono truncate text-blue-500/70 bg-blue-500/5 px-1 py-0.5 rounded flex items-center">
                  <SpinnerGap size={10} className="inline-block mr-1.5 animate-spin shrink-0" />
                  {line.replace(/^>\s*/, '')}
                </div>
              );
            }
            if (isDone) {
              return (
                <div key={i} className="text-[11px] font-mono truncate text-emerald-500/70 flex items-center">
                  <CheckCircle size={10} className="inline-block mr-1.5 shrink-0" />
                  {line.replace(/^\[\+\]\s*/, '')}
                </div>
              );
            }
            if (isError) {
              return (
                <div key={i} className="text-[11px] font-mono truncate text-red-500/70 flex items-center">
                  <XCircle size={10} className="inline-block mr-1.5 shrink-0" />
                  {line.replace(/^\[x\]\s*/, '')}
                </div>
              );
            }
            
            // Regular thought process or summary
            return (
              <div
                key={i}
                className={cn(
                  "text-[11px] font-mono whitespace-pre-wrap break-all",
                  isHeader ? "text-muted-foreground/70 font-bold mb-2" : "text-muted-foreground/60"
                )}
              >
                {line.replace(/^\[subagent:\w+\]\s*/, '')}
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
      return (n.toLowerCase() === 'agent' || n.toLowerCase().includes('__agent')) && inp?.agent !== 'explore' && inp?.subagent_type !== 'explore';
    },
    icon: Robot, // Changed from Lightning to Robot for consistency with SubAgentTimeline
    label: '智能体',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const agentType = (inp?.agent || inp?.subagent_type || 'general') as string;
      const prompt = (inp?.prompt || inp?.description || inp?.query || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return `${AGENT_META[agentType.toLowerCase()]?.label || agentType}: ${short}`;
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      if (!isRunning) {
        // When finished, return null to keep it as a single line in the main timeline.
        // The actual details are shown in the SubAgentTimeline at the bottom.
        return null;
      }

      const outputText = streamingOutput;
      if (!outputText) return null;

      // Show minimal text during streaming
      return (
        <div className="mt-2 ml-3 pl-3 py-1 space-y-1 text-[11px] text-muted-foreground/60 italic">
          智能体正在后台执行任务，请查看底部面板...
        </div>
      );
    },
  },
  {
    match: (n) => n.toLowerCase() === 'todowrite' || n.toLowerCase().includes('__todowrite'),
    icon: ListChecks,
    label: '更新任务计划',
    getSummary: () => '更新任务计划',
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : tool.result;
      
      // Try to extract JSON content for prettier display if needed, 
      // or just show a nice loading state / JSON view.
      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-1 space-y-1 bg-background/30 rounded-r-md">
          {isRunning ? (
            <div className="text-[11px] text-blue-500/70 flex items-center">
              <SpinnerGap size={10} className="inline-block mr-1.5 animate-spin shrink-0" />
              正在更新任务计划...
            </div>
          ) : (
            <div className="text-[11px] text-emerald-500/70 flex items-center mb-2">
              <CheckCircle size={10} className="inline-block mr-1.5 shrink-0" />
              任务计划更新完成
            </div>
          )}
          
          {outputText && (
            <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-auto bg-muted/20 p-2 rounded">
              {typeof outputText === 'string' && outputText.startsWith('{') 
                ? (() => {
                    try {
                      return JSON.stringify(JSON.parse(outputText), null, 2);
                    } catch {
                      return outputText;
                    }
                  })()
                : outputText}
            </div>
          )}
        </div>
      );
    },
  },
  {
    match: (n) => ['read', 'read_file', 'mcp__filesystem__read_file', 'mcp__filesystem__read_multiple_files', 'mcp__filesystem__list_directory', 'mcp__filesystem__directory_tree', 'view_file'].some(v => n.toLowerCase().includes(v)),
    icon: Eyeglasses,
    label: '读取文件',
    getSummary: (input, name, tool) => {
      const outputText = tool?.result;
      if (outputText) {
        const lines = outputText.split('\n').filter(l => l.trim());
        const summaryLine = lines.find(l => /^found\s+\d+/i.test(l) || /^找到\s+\d+/i.test(l) || /^读取了\s+\d+/i.test(l) || /^\d+\s+lines/i.test(l) || /^read\s+\d+/i.test(l));
        if (summaryLine) {
          return summaryLine;
        }
      }
      const inp = input as Record<string, unknown> | undefined;
      if (inp && Array.isArray(inp.paths)) {
        return `读取了 ${inp.paths.length} 个文件`;
      }
      if (inp && (inp.path || inp.file_path || inp.filePath)) {
        const linesCount = outputText ? outputText.split('\n').length : 0;
        if (linesCount > 0) return `读取了 ${linesCount} 行`;
        return `读取了文件`;
      }
      return '读取了文件';
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      if (isRunning) {
        return (
          <div className="mt-2 ml-3 pl-3 py-1 space-y-1 text-[11px] text-muted-foreground/60 italic">
            正在读取文件内容...
          </div>
        );
      }

      const input = tool.input as Record<string, unknown> | undefined;
      const paths = (input?.paths as string[]) || (input?.path ? [input.path as string] : []);
      if (paths.length === 0) return null;

      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-2 space-y-1 bg-background/30 rounded-r-md">
          <div className="flex flex-col gap-1">
            {paths.map((path, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-2 group cursor-pointer hover:bg-muted/50 p-1 rounded transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  fetch('/api/open-file', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path }),
                  }).catch(() => {});
                }}
                title="点击在编辑器中打开文件"
              >
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <span className="font-mono text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 truncate underline">
                  {path}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    },
  },
  {
    match: (n) => n.toLowerCase() === 'mcp__codepilot-todo__codepilot_mcp_activate' || n.toLowerCase() === 'codepilot_mcp_activate',
    icon: Wrench,
    label: '激活 MCP 工具',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      return (inp?.serverName as string) || 'MCP Server';
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : tool.result;
      if (!outputText) return null;

      const cleanText = parseMcpResultText(outputText);

      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-2 bg-background/30 rounded-r-md">
          <div className="text-[11px] text-muted-foreground/80 break-words whitespace-pre-wrap leading-relaxed">
            {cleanText}
          </div>
        </div>
      );
    }
  },
  {
    // Fallback — must be last. Shows the raw tool name so unregistered tools
    // (TodoWrite, MCP tools, plugin tools) remain identifiable.
    match: () => true,
    icon: Wrench,
    label: '',
    getSummary: (input, name?: string) => {
      const prefix = name || '';
      
      // Memory MCP tools
      if (prefix.toLowerCase().includes('memory') || prefix === '记忆召回' || prefix === '记忆整理' || prefix === '记忆操作') {
        if (prefix.includes('search') || prefix.includes('recent') || prefix === '记忆召回') return '记忆召回';
        if (prefix.includes('store') || prefix.includes('save') || prefix.includes('write') || prefix === '记忆整理') return '记忆整理';
        return '记忆操作';
      }

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
  const match = TOOL_REGISTRY.find((r) => r.match(name, input)) || TOOL_REGISTRY[TOOL_REGISTRY.length - 1];
  
  // Special cases to override the default Wrench icon based on tool semantics
  if (match === TOOL_REGISTRY[TOOL_REGISTRY.length - 1]) {
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('memory') || name === 'mcp__codepilot-memory-search__codepilot_memory_recent') {
      return { ...match, icon: Brain };
    }
    
    if (lowerName.includes('search')) {
      return { ...match, icon: MagnifyingGlass };
    }
    
    if (lowerName.includes('read') || lowerName.includes('list') || lowerName.includes('tree') || lowerName.includes('fetch')) {
      return { ...match, icon: Eye };
    }
    
    if (lowerName.includes('write') || lowerName.includes('create') || lowerName.includes('move')) {
      return { ...match, icon: FileText };
    }
  }
  
  return match;
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

// ---------------------------------------------------------------------------
// Action tool detection — tools that perform writes/changes
// ---------------------------------------------------------------------------

function isActionTool(name: string): boolean {
  const n = name.toLowerCase();
  if (
    n === 'apply_patch' ||
    n.endsWith('__edit_file') ||
    n.endsWith('__write_file')
  ) return true;
  return ['bash', 'execute', 'run', 'shell', 'execute_command', 'write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit', 'codepilot_open_browser'].includes(n) || n.startsWith('mcp__playwright');
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

  return (
    <div className="my-1 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-2 py-1 text-[11px] hover:bg-muted/40 transition-colors rounded-[6px]"
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0 pr-2">
          <MagnifyingGlass size={14} className="text-blue-500 shrink-0" />
          <span 
            className="text-foreground/80 ml-1 truncate"
            title={hasRunning ? `正在检索 (${tools.length})` : `检索了 ${tools.length} 个文件`}
          >
            {hasRunning ? `正在检索 (${tools.length})` : `检索了 ${tools.length} 个文件`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
            transition={{ duration: 0.3, ease: 'easeInOut' }}
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
  // 默认折叠运行，用户手动点击后才展开
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const isExpanded = userExpanded !== null ? userExpanded : false;

  // ---------------------------------------------------------------------------
  // 功能名称：思考卡片自动滚动控制
  // 用法：通过监听滚动容器的 scrollTop 和 scrollHeight 差值，
  // 判断用户是否手动向上滚动，如果是则停止自动跟随最新内容，
  // 若滚动回底部，则恢复自动跟随。
  // ---------------------------------------------------------------------------
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll logic
  React.useEffect(() => {
    if (isExpanded && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isExpanded, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user scrolled up (more than 10px from bottom), disable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
    setAutoScroll(isAtBottom);
  };

  React.useEffect(() => {
    if (!isStreaming && userExpanded === null) {
      const timer = setTimeout(() => {
        setUserExpanded(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, userExpanded]);

  return (
    <div className="my-1 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          const willExpand = !isExpanded;
          setUserExpanded(willExpand);
          if (willExpand) stopScroll();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex w-full items-center justify-between px-2 py-1 text-[11px] hover:bg-muted/40 transition-colors rounded-[6px]"
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0 pr-2">
          <Brain size={14} className="text-violet-500 shrink-0" />
          <span 
            className="text-foreground/80 truncate ml-1 text-left"
            title="思考"
          >
            思考
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
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
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="px-3 py-2 text-[12px] text-foreground/80 prose prose-sm dark:prose-invert max-w-none border-l-2 border-violet-500/20 ml-3 max-h-[400px] overflow-y-auto overscroll-contain scrollbar-thin"
            >
              <Streamdown
                plugins={thinkingPlugins}
                components={{
                  a: ({ node, href, children, ...aProps }: any) => {
                    return (
                      <a
                        href={href}
                        {...aProps}
                        onClick={(e) => {
                          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                            e.preventDefault();
                            usePanelStore.getState().openBrowserTab(href, "网页预览");
                          } else if (aProps.onClick) {
                            aProps.onClick(e);
                          }
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                  h1: ({ children }: any) => <span className="font-bold text-[12px] block mt-2 mb-1">{children}</span>,
                  h2: ({ children }: any) => <span className="font-bold text-[12px] block mt-2 mb-1">{children}</span>,
                  h3: ({ children }: any) => <span className="font-bold text-[12px] block mt-1">{children}</span>,
                  h4: ({ children }: any) => <span className="font-bold text-[12px] block mt-1">{children}</span>,
                  h5: ({ children }: any) => <span className="font-bold text-[12px] block mt-1">{children}</span>,
                  h6: ({ children }: any) => <span className="font-bold text-[12px] block mt-1">{children}</span>,
                  code: ({ children, ...codeProps }: any) => {
                    // 如果代码块被 <pre> 包裹，说明是大段代码，此时类名通常会带有 'language-'，交给原本的 pre 处理即可
                    if (codeProps.className && (codeProps.className.includes('language-') || codeProps.className.includes('!bg-['))) {
                      return <code {...codeProps}>{children}</code>;
                    }
                    if (typeof children === 'string' && (children.startsWith('http://') || children.startsWith('https://'))) {
                      return (
                        <span 
                          className={cn("bg-muted/40 px-1 py-[1px] rounded font-mono text-[12px] border border-border/30 mx-0.5 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer break-all", codeProps.className)}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            usePanelStore.getState().openBrowserTab(children, "网页预览");
                          }}
                        >
                          {children}
                        </span>
                      );
                    }
                    // 处理行内小段代码的样式：移除前后反引号，保留背景色，取消巨大的字体
                    return (
                      <code 
                        className="bg-muted/40 px-1 py-[1px] rounded font-mono text-[12px] text-foreground/80 before:content-none after:content-none border border-border/30 mx-0.5" 
                        {...codeProps}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {content}
              </Streamdown>
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
  'mcp__codepilot-memory-search__codepilot_memory_recent': '记忆召回',
  'mcp__filesystem__read_multiple_files': '读取多个文件',
  'mcp__filesystem__list_directory': '查看目录内容',
  'mcp__filesystem__directory_tree': '查看目录树',
  'mcp__filesystem__read_file': '读取文件',
  'mcp__filesystem__write_file': '写入文件',
  'mcp__filesystem__create_directory': '创建目录',
  'mcp__filesystem__move_file': '移动文件',
  'mcp__filesystem__search_files': '搜索文件',
  'mcp__codepilot-todo__codepilot_mcp_activate': '激活 MCP 工具',
};

function getToolDisplayName(name: string): string {
  // Try to find an exact match first
  if (MCP_TOOL_NAME_MAP[name]) {
    return MCP_TOOL_NAME_MAP[name];
  }

  const lowerName = name.toLowerCase();

  // If it's a memory tool that wasn't exactly matched above
  if (lowerName.includes('memory')) {
    if (lowerName.includes('search') || lowerName.includes('recent')) return '记忆召回';
    if (lowerName.includes('store') || lowerName.includes('save') || lowerName.includes('write')) return '记忆整理';
    return '记忆操作';
  }
  
  // If it's a filesystem tool
  if (lowerName.includes('filesystem')) {
    if (lowerName.includes('read_multiple')) return '读取多个文件';
    if (lowerName.includes('read_text') || lowerName.includes('read_file')) return '读取文件';
    if (lowerName.includes('list_dir')) return '查看目录内容';
    if (lowerName.includes('dir_tree') || lowerName.includes('directory_tree')) return '查看目录树';
    if (lowerName.includes('write')) return '写入文件';
    if (lowerName.includes('search')) return '搜索文件';
    return '文件系统操作';
  }

  return name;
}

function ContextSingleRow({ tool, streamingToolOutput, expandedOverride, onToggle }: { tool: ToolAction; streamingToolOutput?: string; expandedOverride?: boolean; onToggle?: () => void }) {
  const renderer = getRenderer(tool.name, tool.input);
  
  // Use our smart display name function to replace raw MCP tool names
  const displayName = getToolDisplayName(tool.name);
  const baseSummary = renderer.getSummary(tool.input, displayName, tool);
  
  // For file operations, try to extract file paths for a cleaner summary
  let summary = baseSummary;
  const toolInput = tool.input as Record<string, unknown> | undefined;
  
  if (tool.name.includes('mcp__filesystem') && toolInput) {
    if (tool.name.includes('read_multiple_files') && Array.isArray(toolInput.paths)) {
      const count = toolInput.paths.length;
      summary = `读取了 ${count} 个文件`;
    } else if (toolInput.path && typeof toolInput.path === 'string') {
      summary = truncatePath(toolInput.path);
    }
  }
  
  const filePath = getFilePath(tool.input);
  const status = getStatus(tool);
  const isTeam = tool.name.toLowerCase() === 'team' || tool.name.toLowerCase().includes('__team');
  const isTodoWrite = tool.name.toLowerCase() === 'todowrite' || tool.name.toLowerCase().includes('__todowrite');
  const isFileOrSearch = ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search', 'searchcodebase', 'read', 'read_file', 'read_multiple_files', 'list_directory', 'directory_tree', 'view_file'].some(n => tool.name.toLowerCase().includes(n));
  const hasDetail = !!renderer.renderDetail;
  const detailVisible = hasDetail && (status === 'running' || !!streamingToolOutput || !!tool.result);
  const [internalExpanded, setInternalExpanded] = useState((isTeam || isTodoWrite || isFileOrSearch) ? false : status === 'running');
  const [showRaw, setShowRaw] = useState(false);

  const expanded = expandedOverride !== undefined ? expandedOverride : internalExpanded;

  React.useEffect(() => {
    if (expandedOverride === undefined) {
      if (isTeam || isTodoWrite || isFileOrSearch) {
        setInternalExpanded(false);
      } else if (status === 'running') {
        setInternalExpanded(true);
      } else {
        const timer = setTimeout(() => {
          setInternalExpanded(false);
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [status, expandedOverride, isTeam, isTodoWrite, isFileOrSearch]);

  const hasRawContent = !hasDetail && (tool.result || (tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0));

  return (
    <div className={cn(
      "my-1 overflow-hidden",
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
          "flex w-full items-center gap-2 px-2 py-1 text-[11px] hover:bg-muted/40 transition-colors text-left rounded-[6px]",
          status === 'error' ? "bg-red-500/[0.03]" : "",
          isTeam ? "bg-purple-500/[0.05] hover:bg-purple-500/[0.1] text-purple-500" : "",
          isTodoWrite ? "bg-blue-500/[0.05] hover:bg-blue-500/[0.1] text-blue-500" : ""
        )}
      >
        <div className="flex shrink-0 items-center justify-center">
          {createElement(renderer.icon, { size: 14, className: status === 'error' ? "text-red-500/80" : (isTeam ? "text-purple-500" : (isTodoWrite ? "text-blue-500" : "text-blue-500")) })}
        </div>

        <span 
          className={cn(
            "truncate ml-1 text-left font-medium",
            status === 'error' ? "text-red-500/80" : (isTeam ? "text-purple-600 dark:text-purple-400" : (isTodoWrite ? "text-blue-600 dark:text-blue-400" : "text-foreground/80"))
          )}
          title={renderer.label || (isTeam ? '' : displayName)}
        >
          {renderer.label || (isTeam ? '' : displayName)}
        </span>
        
        {!(isTeam || isTodoWrite) && (renderer.label ? !!summary : !!filePath || !!displayName) && (
          <>
            <span className="mx-1 text-border shrink-0">|</span>
            <span 
              className={cn("font-mono text-[11px] truncate text-muted-foreground/60 min-w-0", renderer.label && filePath ? "max-w-[200px]" : "flex-1")}
              title={renderer.label ? summary : (tool.name.includes('mcp__filesystem') ? summary : truncatePath(filePath || displayName))}
            >
              {renderer.label ? summary : (tool.name.includes('mcp__filesystem') ? summary : truncatePath(filePath || displayName))}
            </span>
            {renderer.label && filePath && !tool.name.includes('mcp__filesystem') && (
              <>
                <span className="mx-1 text-border shrink-0">|</span>
                <span 
                  className="font-mono text-[10px] truncate flex-1 text-muted-foreground/40 min-w-0"
                  title={filePath}
                >
                  {filePath}
                </span>
              </>
            )}
          </>
        )}

        <div className={cn("ml-auto flex shrink-0 items-center gap-2", isTeam ? "text-purple-500/80" : (isTodoWrite ? "text-blue-500/80" : "text-muted-foreground"))}>
          {status === 'running' && <SpinnerGap size={14} className={cn("animate-spin", isTeam ? "text-purple-500" : "text-primary")} />}
          {status === 'success' && <CheckCircle size={14} className={isTeam ? "text-purple-500" : (isTodoWrite ? "text-blue-500" : "text-emerald-500")} />}
          {status === 'error' && <XCircle size={14} className="text-red-500" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {(detailVisible && expanded) || (hasRawContent && showRaw) ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
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
                      <Linkify>{typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}</Linkify>
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
                      <Linkify>{tool.result.length > 5000 ? tool.result.slice(0, 5000) + `\n… (truncated, ${tool.result.length} chars total)` : tool.result}</Linkify>
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ActionToolCard({ tool, streamingToolOutput, sessionId, rewindId }: { tool: ToolAction; isStreaming?: boolean; streamingToolOutput?: string; sessionId?: string; rewindId?: string }) {
  const k = toolKind2(tool.name);
  const status = getStatus(tool);

  // Unconditional hook calls at the top level
  const [expanded, setExpanded] = useState(k === 'team' ? false : status === 'running');
  const browserDispatchedRef = React.useRef(false);
  const { setTerminalOpen, setBottomPanelOpen, setBottomPanelTab } = usePanel();

  // 浏览器面板打开：当工具成功完成时触发，不依赖 prevStatus 避免跳过 running 状态导致失效
  React.useEffect(() => {
    const isBrowserTool = tool.name === 'codepilot_open_browser' || tool.name.endsWith('__codepilot_open_browser');
    if (isBrowserTool && status === 'success' && !browserDispatchedRef.current) {
      browserDispatchedRef.current = true;
      const input = tool.input as { url?: string; title?: string } | undefined;
      const url = input?.url;
      if (url) {
        window.dispatchEvent(new CustomEvent('action:open-browser-panel', {
          detail: { url, title: input?.title }
        }));
      }
    }
  }, [tool.name, status, tool.input]);

  React.useEffect(() => {
    if (k === 'team' || k === 'todowrite') return; // Do not auto-expand team or todowrite
    if (status === 'running') {
      setExpanded(true);
    } else {
      const timer = setTimeout(() => {
        setExpanded(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status, k]);

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
      <div className="my-1 border border-border/50 bg-muted/30 rounded-[6px] overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
          className="flex w-full items-center justify-between px-2 py-1 text-[11px] hover:bg-muted/40 transition-colors rounded-[6px] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4 min-w-0">
            <TerminalWindow size={14} weight="bold" className="text-violet-500 shrink-0" />
            <span className="text-foreground/80 shrink-0 text-left truncate" title={displayName}>{displayName}</span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0">
              {status === 'running' ? '运行中' : status === 'error' ? '失败' : '完成'}
            </span>
            {cmd && (
              <>
                <span className="text-muted-foreground/40 shrink-0 ml-1">|</span>
                <span 
                  className="text-muted-foreground/70 font-mono text-[11px] truncate ml-1 text-left min-w-0"
                  title={`$ ${cmd}`}
                >
                  $ {cmd}
                </span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            {status === 'running' && <SpinnerGap size={14} className="animate-spin text-primary mr-1" />}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBottomPanelTab('terminal');
                setBottomPanelOpen(true);
                setTerminalOpen(true);
                // 中文注释：功能名称「终端历史回放」，用法是点击在终端查看时，
                // 把该工具卡的命令和结果通过事件传递给终端面板显示
                window.dispatchEvent(new CustomEvent('terminal:show-history', {
                  detail: {
                    command: cmd,
                    result: tool.result || '',
                    isError: tool.isError || false,
                  },
                }));
                setTimeout(() => window.dispatchEvent(new CustomEvent('action:focus-terminal')), 50);
              }}
              className="flex items-center gap-1 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
            >
              在终端查看 <ArrowSquareOut size={12} />
            </button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-4 pb-2.5 pt-0.5 border-l-2 border-violet-500/20 ml-3">
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
  
  if (k === 'agent') {
    return (
      <div className="my-1 ml-4 border-l-[2px] border-border/50 pl-4 py-1">
        <div className="border border-blue-500/30 bg-muted/20 rounded-[8px] overflow-hidden shadow-sm">
          <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
        </div>
      </div>
    );
  }

  if (k === 'todowrite') {
    return (
      <div className="my-1 border border-blue-500/30 bg-blue-500/[0.05] rounded-[8px] overflow-hidden shadow-sm">
        <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
      </div>
    );
  }

  if (k === 'team') {
    return (
      <div className="my-1 border border-purple-500/30 bg-purple-500/[0.05] rounded-[8px] overflow-hidden shadow-sm">
        <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
      </div>
    );
  }

  return (
    <div className="bg-muted/30 my-1 border border-border/50 rounded-[6px] overflow-hidden">
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
function toolKind2(name: string): 'read' | 'write' | 'create' | 'search' | 'bash' | 'agent' | 'team' | 'todowrite' | 'other' {
  const n = name.toLowerCase();
  if (n === 'todowrite' || n.includes('__todowrite')) return 'todowrite';
  if (['read', 'readfile', 'read_file', 'read_text_file', 'read_multiple_files'].includes(n)) return 'read';
  if (['edit', 'notebookedit', 'notebook_edit', 'apply_patch'].includes(n) || n.endsWith('__edit_file')) return 'write';
  if (n.endsWith('__write_file')) return 'create';
  if (['write', 'writefile', 'write_file', 'create_file', 'createfile'].includes(n)) return 'create';
  if (['glob', 'grep', 'search', 'find_files', 'search_files', 'websearch', 'web_search'].some(x => n.includes(x))) return 'search';
  if (n === 'team' || n.includes('__team')) return 'team';
  if (n.toLowerCase() === 'agent' || n.toLowerCase().includes('__agent')) return 'agent';
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

function FileReviewRow({ diff }: { diff: DiffInfo; sessionId?: string; rewindId?: string }) {
  const [open, setOpen] = useState(false);
  const { stopScroll } = useStickToBottomContext();
  const { openPreviewTab } = usePanel();

  const showPreviewBtn = canPreview(diff.filename);

  return (
    <div className="my-1 border border-border/50 bg-muted/30 rounded-[6px] overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => { setOpen(v => !v); if (!open) stopScroll(); }}>
        <div className="flex shrink-0 items-center justify-center">
          {diff.mode === 'create'
            ? <FilePlus size={14} className="text-emerald-500" />
            : <NotePencil size={14} className="text-amber-500" />}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 ml-1 overflow-hidden">
          <span 
            className="truncate text-foreground/80 shrink-0"
            title={diff.filename}
          >
            {diff.filename}
          </span>
          <span 
            className="truncate font-mono text-[10px] text-muted-foreground/50 hidden sm:inline max-w-[200px]"
            title={diff.fullPath}
          >
            {diff.fullPath}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0 font-mono text-[11px]">
          {diff.added > 0 && <span className="text-emerald-500/80">+{diff.added}</span>}
          {diff.removed > 0 && <span className="text-red-500/80">-{diff.removed}</span>}
        </div>
        <div className="ml-2 flex items-center gap-1 shrink-0">
          {showPreviewBtn && (
             <button
               type="button"
               onClick={(e) => {
                 e.stopPropagation();
                 openPreviewTab(diff.fullPath);
               }}
               className="p-1 rounded text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors"
               title="预览渲染效果"
             >
               <Play size={14} weight="fill" />
             </button>
           )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (diff.fullPath) {
                const dir = diff.fullPath.substring(0, diff.fullPath.lastIndexOf('/'));
                if (typeof window !== 'undefined' && (window as any).electronAPI?.shell?.openPath) {
                  (window as any).electronAPI.shell.openPath(dir).catch(() => {});
                }
              }
            }}
            className="flex items-center gap-1 rounded p-1 text-muted-foreground/60 transition hover:text-foreground hover:bg-muted/50"
            title="在 Finder 中打开"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div className="flex flex-col border-t border-border/20 text-[11px] max-h-[400px] overflow-y-auto font-mono">
              {diff.mode === 'edit' && diff.beforeLines.map((l, i) => (
                <div key={`b-${i}`} className="flex bg-red-500/[0.08] hover:bg-red-500/[0.12] transition-colors border-b border-border/5">
                  <div className="w-8 shrink-0 text-center select-none text-red-500/60 py-0.5 border-r border-border/5">-</div>
                  <div className="flex-1 px-3 py-0.5 whitespace-pre-wrap break-all text-red-600 dark:text-red-400 font-medium line-through opacity-80">{l || ' '}</div>
                </div>
              ))}
              {diff.mode === 'edit' && diff.moreB > 0 && (
                <div className="px-8 py-1 text-muted-foreground/40 bg-red-500/[0.02] border-b border-border/5">… +{diff.moreB} lines</div>
              )}
              {diff.afterLines.map((l, i) => (
                <div key={`a-${i}`} className="flex bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] transition-colors border-b border-border/5">
                  <div className="w-8 shrink-0 text-center select-none text-emerald-500/60 py-0.5 border-r border-border/5">+</div>
                  <div className="flex-1 px-3 py-0.5 whitespace-pre-wrap break-all text-emerald-600 dark:text-emerald-400 font-medium">{l || ' '}</div>
                </div>
              ))}
              {diff.moreA > 0 && (
                <div className="px-8 py-1 text-muted-foreground/40 bg-emerald-500/[0.02] border-b border-border/5">… +{diff.moreA} lines</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CompletionBar({
  changedFiles, sessionId, rewindId,
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
              transition={{ duration: 0.3, ease: 'easeInOut' }}
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
  hideSubAgents,
}: ToolActionsGroupProps & { flat?: boolean; sessionId?: string; rewindUserMessageId?: string; hideSubAgents?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // 中文注释：功能名称「过滤子Agent工具调用」，用法是当 hideSubAgents 为 true 时（通常是因为下方已经渲染了专门的子Agent卡片），
  // 在此处将其从时间线中过滤掉，避免在界面上出现重复显示的“Search Agent”或“探索者”工具卡片。
  // 请其他 AI 不要改动此处的过滤逻辑，确保时间线和 Agent 卡片不重复渲染。
  const effectiveTools = React.useMemo(() => {
    if (!hideSubAgents) return tools;
    return tools.filter(t => !isSubAgentTool(t.name));
  }, [tools, hideSubAgents]);

  const effectiveSteps = React.useMemo(() => {
    if (!steps || !hideSubAgents) return steps;
    return steps.map(step => ({
      ...step,
      toolCalls: step.toolCalls.filter(tc => !isSubAgentTool(tc.name)),
      events: step.events?.filter(e => {
        if (e.type !== 'tool') return true;
        const tc = step.toolCalls.find(t => t.id === e.toolCallId);
        return tc ? !isSubAgentTool(tc.name) : true;
      })
    })).filter(step => step.reasoning || step.output || step.toolCalls.length > 0 || (step.events && step.events.length > 0));
  }, [steps, hideSubAgents]);

  // If streaming and tools/thinking are present, default to expanded
  React.useEffect(() => {
    if (isStreaming && (effectiveTools.length > 0 || thinkingContent || (effectiveSteps && effectiveSteps.length > 0))) {
      setExpanded(true);
    }
  }, [isStreaming, effectiveTools.length, thinkingContent, effectiveSteps]);

  const hasRunningTool = effectiveTools.some((t) => t.result === undefined);
  const hasError = effectiveTools.some((t) => t.isError);
  const groupStatus = hasRunningTool ? 'running' : (hasError ? 'error' : 'success');

  const segments = computeSegments(effectiveTools, thinkingContent, effectiveSteps);

  const renderSegments = () => {
    const blocks: React.ReactNode[] = [];
    let currentLineGroup: React.ReactNode[] = [];
    
    const flushLineGroup = () => {
      if (currentLineGroup.length > 0) {
        blocks.push(
          <div key={`line-${blocks.length}`} className="my-1 flex flex-col">
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
          <div key={`text-${idx}`} className="my-1 flex items-start gap-2.5 px-2 py-1.5">
            <div className="flex shrink-0 items-center justify-center mt-[3px]">
              <ChatCircle size={15} className="text-emerald-500/80" />
            </div>
            <Streamdown
              className="flex-1 text-[13px] text-foreground/80 leading-relaxed break-words prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              plugins={thinkingPlugins}
              components={{
                  a: ({ node, href, children, ...aProps }: any) => {
                    return (
                      <a
                        href={href}
                        {...aProps}
                        onClick={(e) => {
                          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                            e.preventDefault();
                            usePanelStore.getState().openBrowserTab(href, "网页预览");
                          } else if (aProps.onClick) {
                            aProps.onClick(e);
                          }
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                  h1: ({ children }: any) => <span className="font-bold text-[13px] block mt-2 mb-1">{children}</span>,
                  h2: ({ children }: any) => <span className="font-bold text-[13px] block mt-2 mb-1">{children}</span>,
                  h3: ({ children }: any) => <span className="font-bold text-[13px] block mt-1">{children}</span>,
                  h4: ({ children }: any) => <span className="font-bold text-[13px] block mt-1">{children}</span>,
                  h5: ({ children }: any) => <span className="font-bold text-[13px] block mt-1">{children}</span>,
                  h6: ({ children }: any) => <span className="font-bold text-[13px] block mt-1">{children}</span>,
                }}
              >
                {segment.content}
              </Streamdown>
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
    if (segments.length === 0) return null;
    return (
      <div className="my-1">
        {renderSegments()}
      </div>
    );
  }

  // Trae style collapsible accordion
  const hasTools = tools.length > 0;
  
  let statusTitle = '';
  if (hasTools) {
    if (isStreaming) {
      statusTitle = hasRunningTool ? '正在执行任务...' : '思考...';
    } else {
      statusTitle = groupStatus === 'error' ? '执行遇到错误' : `${tools.length}个已完成 · 思考与执行完毕`;
    }
  } else {
    if (isStreaming) {
      statusTitle = '思考...';
    } else {
      statusTitle = '思考完毕';
    }
  }

  // Override if there is specific status text
  // We no longer override with displayStatusText because system status (like "Loading rules...")
  // should be displayed independently in StreamingStatusBar.

  return (
    <div className="my-1">
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
            transition={{ duration: 0.3, ease: 'easeInOut' }}
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
