'use client';

import React, { useState, createElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import type { Transition } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';
import { Terminal } from '@phosphor-icons/react';
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
  Globe,
  ArrowSquareOut,
  Code,
  Eye,
  FileText,
  FilePlus,
  CaretDown,
  Play,
  ListChecks,
  ShieldCheck,
  PencilSimple,
  FolderOpen,
  ChatCircle
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { defaultViewMode, usePanel } from '@/hooks/usePanel';

const RENDERABLE_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.csv', '.tsv']);

/**
 * 中文注释：时间线卡片的「入场动画只播一次」包装。
 * 挂载时刻若处于流式（工具仍在运行 / 思考还在增长），给卡片套上 card-enter 动画；
 * 挂载后立即锁定结果 —— 工具完成后 result 到达使 active 变 false 时，
 * 类名不会被摘掉，动画不会播到一半被中断。
 * 非流式场景（历史加载、会话切换、流式结束后的正式消息）不套动画，避免整屏重放闪动。
 * 外壳用 display:contents，不产生额外盒子，卡片布局与原来完全一致。
 */
function EnterOnce({ active, children }: { active?: boolean; children: React.ReactNode }) {
  const [enabled] = useState(active);
  if (!enabled) return <>{children}</>;
  return <div className="contents timeline-card-enter">{children}</div>;
}

function canPreview(filename: string): boolean {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return RENDERABLE_EXTENSIONS.has(ext);
}
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { usePanelStore } from "@/store/usePanelStore";
import { MARKDOWN_PROSE_CLASS, markdownComponents } from "./markdown-shared";

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
  /**
   * 中文注释：功能名称「交付折叠」。
   *
   * 传入即启用手风琴形态（不再走 flat 铺开），展开状态由本组件自己持有 ——
   * 父组件只负责发「这条消息的任务已经彻底完成」这一个信号，不直接控制开合。
   * 这样设计的原因：用户点击展开后，父组件重渲染，
   * 若由父组件下发 expanded，用户的展开会被不断按回去。
   *
   * 调用方只有 MessageItem（消息落定、任务已完成的那一刻）；流式期间
   * StreamingMessage 不传这个 prop、走 flat 铺开，让任务进行中的步骤全程可见。
   * 注意：不传 = 完全保持旧行为，向后兼容。
   *
   * - `delivered`：任务已完成、结论已给出。挂载时决定初始开合（已交付 = 收起）。
   */
  processCollapse?: {
    delivered: boolean;
  };
}

/** 中文注释：项目统一入场曲线，与 globals.css 里各条动画保持一致（强 ease-out）。 */
const ENTER_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * 中文注释：收起专用曲线 —— 先加速后减速。
 * 不沿用 ENTER_EASE 的原因：那条是强 ease-out，位移集中在最开始，
 * 拿来收一个几千像素高的过程块会像被"抽走"一样糊成一片。
 * 收起是「大块内容离场」，需要起步稳、中段快、收尾软。
 */
const EXIT_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

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

type ContextGroupKind = 'search' | 'read' | 'other';

interface ContextGroupItem {
  label: string;
  path?: string;
  title?: string;
}

function isSearchLikeTool(name: string): boolean {
  const lowerName = name.toLowerCase();
  return [
    'search',
    'glob',
    'grep',
    'find_files',
    'search_files',
    'websearch',
    'web_search',
    'searchcodebase',
    'toolsearch',
  ].some((keyword) => lowerName.includes(keyword));
}

function isReadLikeTool(name: string): boolean {
  const lowerName = name.toLowerCase();
  return [
    'read',
    'read_file',
    'read_multiple_files',
    'view_file',
    'list_directory',
    'directory_tree',
  ].some((keyword) => lowerName.includes(keyword));
}

function getContextGroupKind(tool: ToolAction): ContextGroupKind {
  if (isSearchLikeTool(tool.name)) return 'search';
  if (isReadLikeTool(tool.name)) return 'read';
  return 'other';
}

function isLikelyFilePath(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(https?:)?\/\//i.test(trimmed)) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  return /(^|[\\/])[^\\/\s]+\.[A-Za-z0-9_-]+(?::\d+)?(?::.*)?$/.test(trimmed);
}

function dedupeGroupItems(items: ContextGroupItem[]): ContextGroupItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.path ? `path:${item.path}` : `label:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getContextToolSignature(tool: ToolAction): string {
  const input = tool.input as Record<string, unknown> | undefined;
  const name = tool.name.toLowerCase();
  const keyParts: string[] = [name];

  if (input) {
    const query = String(input.pattern || input.query || input.glob || input.url || getFilePath(input) || '').trim();
    if (query) keyParts.push(query);
    if (Array.isArray(input.paths)) {
      keyParts.push((input.paths.filter((value): value is string => typeof value === 'string')).join('|'));
    }
  }

  return keyParts.join('::');
}

function extractReadPaths(tool: ToolAction): string[] {
  const input = tool.input as Record<string, unknown> | undefined;
  if (!input) return [];
  const values: string[] = [];
  if (Array.isArray(input.paths)) {
    values.push(...input.paths.filter((value): value is string => typeof value === 'string'));
  }
  const singlePath = getFilePath(input);
  if (singlePath) values.push(singlePath);
  return Array.from(new Set(values));
}

function extractSearchOutputLines(outputText?: string): string[] {
  if (!outputText) return [];
  let lines = outputText.split('\n').filter((line) => line.trim().length > 0);

  try {
    const parsed = JSON.parse(outputText);
    if (Array.isArray(parsed)) {
      lines = parsed.map((item) => typeof item === 'string' ? item : JSON.stringify(item));
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray((parsed as Record<string, unknown>).files)) {
        lines = ((parsed as Record<string, unknown>).files as unknown[]).map((item) => String(item));
      } else if (Array.isArray((parsed as Record<string, unknown>).results)) {
        lines = ((parsed as Record<string, unknown>).results as unknown[]).map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            return String(record.path || record.url || record.title || JSON.stringify(record));
          }
          return String(item);
        });
      }
    }
  } catch {
    // 中文注释：功能名称「搜索结果行提取容错」，用法是搜索输出不是 JSON 时继续按纯文本行处理，避免聚合详情丢失。
  }

  if (lines.length > 0 && (/^found\s+\d+/i.test(lines[0]) || /^找到\s+\d+/i.test(lines[0]) || /^匹配\s+\d+/i.test(lines[0]) || /^\d+\s+matches/i.test(lines[0]) || /^\d+\s+results/i.test(lines[0]))) {
    lines = lines.slice(1);
  }

  return lines;
}

function extractSearchGroupItems(tool: ToolAction): ContextGroupItem[] {
  const items: ContextGroupItem[] = [];
  const input = tool.input as Record<string, unknown> | undefined;
  const query = String(input?.pattern || input?.query || input?.glob || '').trim();
  if (query) {
    items.push({
      label: `"${query.length > 80 ? `${query.slice(0, 77)}...` : query}"`,
      title: query,
    });
  }

  const outputLines = extractSearchOutputLines(tool.result);
  outputLines.forEach((line) => {
    const grepMatch = line.match(/^([^:]+):(\d+):(.*)$/);
    if (grepMatch && isLikelyFilePath(grepMatch[1])) {
      items.push({
        label: `${extractFilename(grepMatch[1])}:${grepMatch[2]}`,
        path: grepMatch[1],
        title: `${grepMatch[1]}:${grepMatch[2]}`,
      });
      return;
    }

    if (isLikelyFilePath(line)) {
      const cleanPath = line.replace(/:\d+(?::.*)?$/, '');
      items.push({
        label: extractFilename(cleanPath),
        path: cleanPath,
        title: cleanPath,
      });
      return;
    }

    items.push({
      label: line.length > 120 ? `${line.slice(0, 117)}...` : line,
      title: line,
    });
  });

  return dedupeGroupItems(items);
}

export function extractReadGroupItems(tools: ToolAction[]): ContextGroupItem[] {
  return dedupeGroupItems(
    tools.flatMap((tool) => extractReadPaths(tool).map((path) => ({
      label: extractFilename(path),
      path,
      title: path,
    })))
  );
}

export function extractSearchGroupSummary(tools: ToolAction[]): { queryCount: number; resultCount: number; items: ContextGroupItem[] } {
  const items = dedupeGroupItems(tools.flatMap(extractSearchGroupItems));
  const queryCount = tools.length;
  const resultCount = items.filter((item) => item.path).length || items.length;
  return { queryCount, resultCount, items };
}

export const AGENT_META: Record<string, { icon: React.ElementType, color: string, bg: string, label: string }> = {
  search: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '搜索' },
  explorer: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '探索' },
  explore: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '探索' },
  planner: { icon: ListChecks, color: 'text-purple-500', bg: 'bg-purple-500/10', label: '规划' },
  executor: { icon: PencilSimple, color: 'text-orange-500', bg: 'bg-orange-500/10', label: '执行' },
  verifier: { icon: ShieldCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: '校验' },
  analyst: { icon: Brain, color: 'text-indigo-500', bg: 'bg-indigo-500/10', label: '分析' },
  tester: { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', label: '测试' },
  qa: { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', 'label': '质量检测' },
  debugger: { icon: Wrench, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: '调试' },
  general: { icon: Robot, color: 'text-slate-500', bg: 'bg-slate-500/10', label: '通用' },
  architect: { icon: Brain, color: 'text-indigo-600', bg: 'bg-indigo-600/10', label: '架构' },
  tracer: { icon: MagnifyingGlass, color: 'text-blue-400', bg: 'bg-blue-400/10', label: '追踪' },
  'security-reviewer': { icon: ShieldCheck, color: 'text-rose-600', bg: 'bg-rose-600/10', label: '安全审查' },
  'code-reviewer': { icon: Eyeglasses, color: 'text-violet-500', bg: 'bg-violet-500/10', label: '代码审查' },
  'test-engineer': { icon: ShieldCheck, color: 'text-rose-400', bg: 'bg-rose-400/10', label: '测试工程' },
  designer: { icon: NotePencil, color: 'text-pink-500', bg: 'bg-pink-500/10', label: '设计' },
  writer: { icon: NotePencil, color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: '文档撰写' },
  'qa-tester': { icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-500/10', label: 'QA 测试' },
  scientist: { icon: Brain, color: 'text-teal-500', bg: 'bg-teal-500/10', label: '数据科学' },
  'document-specialist': { icon: NotePencil, color: 'text-sky-500', bg: 'bg-sky-500/10', label: '文档整理' },
  'git-master': { icon: Code, color: 'text-orange-600', bg: 'bg-orange-600/10', label: 'Git' },
  'code-simplifier': { icon: Wrench, color: 'text-yellow-600', bg: 'bg-yellow-600/10', label: '代码精简' },
  critic: { icon: Eyeglasses, color: 'text-red-500', bg: 'bg-red-500/10', label: '评审' },
  // 新增角色翻译
  researcher: { icon: MagnifyingGlass, color: 'text-blue-500', bg: 'bg-blue-500/10', label: '调研' },
  coordinator: { icon: Robot, color: 'text-purple-500', bg: 'bg-purple-500/10', label: '协调' },
  monitor: { icon: Eye, color: 'text-teal-500', bg: 'bg-teal-500/10', label: '监控' },
  optimizer: { icon: Lightning, color: 'text-amber-500', bg: 'bg-amber-500/10', label: '优化' },
  refactoring: { icon: Wrench, color: 'text-orange-500', bg: 'bg-orange-500/10', label: '重构' },
  integration: { icon: Globe, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: '集成' },
  deployment: { icon: Play, color: 'text-blue-600', bg: 'bg-blue-600/10', label: '部署' },
  documentation: { icon: NotePencil, color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: '文档' },
  review: { icon: Eyeglasses, color: 'text-violet-500', bg: 'bg-violet-500/10', label: '审查' },
  implement: { icon: PencilSimple, color: 'text-orange-500', bg: 'bg-orange-500/10', label: '实现' },
};

export function isSubAgentTool(name: string): boolean {
  const lowerName = name.toLowerCase();
  // Do NOT filter out 'team' tool, so the "团队协作模式" card remains visible!
  // Only filter out the individual sub-agents that are already rendered by SubAgentTimeline.
  if (lowerName === 'agent') return true;
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
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[400px] overflow-y-auto">
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
    icon: Terminal,
    label: '',
    getSummary: (input) => {
      const rawCmd = ((input as Record<string, unknown>)?.command || (input as Record<string, unknown>)?.cmd || '') as string;
      const cmd = rawCmd.replace(/^cd\s+(?:'[^']+'|"[^"]+"|[^&]+)\s*&&\s*/, '');
      return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
    },
    renderDetail: (tool, streamingOutput) => {
      const rawCmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
      const cmd = rawCmd.replace(/^cd\s+(?:'[^']+'|"[^"]+"|[^&]+)\s*&&\s*/, '');
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
        // Completed: show full output, truncated to 100 lines with indicator
        const lines = outputText.split('\n');
        if (lines.length > 100) {
          return lines.slice(0, 100).join('\n') + `\n… +${lines.length - 100} lines`;
        }
        return outputText;
      })();

      return (
        <div className="mt-1 rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground/80 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all">
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
      const paths = extractReadPaths(tool);
      if (paths.length === 0) return null;

      return (
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-2 bg-background/30 rounded-r-md">
          <div className="space-y-1">
            {paths.map((path, index) => (
              <button
                key={`${path}-${index}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  usePanelStore.getState().openPreviewTab(path, defaultViewMode);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50 transition-colors"
                title={path}
              >
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <span className="font-mono text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 truncate underline">
                  {path}
                </span>
              </button>
            ))}
          </div>
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
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80 max-h-[400px] overflow-y-auto">
            {cleanText.length > 5000 ? cleanText.slice(0, 5000) + `\n… (已截断，共 ${cleanText.length} 字符)` : cleanText}
          </pre>
        </div>
      );
    }
  },
  {
    match: (n) => ['websearch', 'web_search'].includes(n.toLowerCase()),
    icon: Globe,
    label: '联网搜索',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const query = (inp?.query || inp?.pattern || '') as string;
      return query ? `"${query.length > 50 ? query.slice(0, 47) + '...' : query}"` : '联网检索内容';
    },
  },
  {
    match: (n) => n.toLowerCase().includes('webfetch') || (n.toLowerCase().includes('fetch') && !n.toLowerCase().includes('filesystem')),
    icon: Globe,
    label: '网页抓取',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const url = (inp?.url || inp?.uri || '') as string;
      return url ? (url.length > 60 ? url.slice(0, 57) + '...' : url) : '抓取网页内容';
    },
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
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[400px] overflow-y-auto">
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
                  "whitespace-pre-wrap break-all font-mono text-[11px] max-h-[400px] overflow-y-auto",
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
        <div className="mt-2 ml-3 border-l-2 border-blue-500/30 pl-3 py-1 space-y-1 rounded-r-md">
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
            <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto p-2 rounded">
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

    if (lowerName.includes('websearch') || lowerName.includes('web_search') || lowerName.includes('webfetch') || (lowerName.includes('fetch') && !lowerName.includes('filesystem'))) {
      return { ...match, icon: Globe };
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

// 中文注释：每个 segment 带稳定 key —— 修复此前用数组下标做 key 导致的
// "新增/合并段时后续节点整片重挂载"（表现为流式期间一闪一闪、展开状态莫名重置）。
type Segment =
  | { kind: 'context_group'; key: string; tools: ToolAction[]; groupType: ContextGroupKind }
  | { kind: 'context_single'; key: string; tool: ToolAction }
  | { kind: 'action'; key: string; tool: ToolAction }
  | { kind: 'text'; key: string; content: string }
  | { kind: 'thinking'; key: string; content: string }
  /* 中文注释：同一思考步骤里连续的 action 工具（bash/写文件/浏览器等）折叠成一个可展开组 */
  | { kind: 'step_group'; key: string; tools: ToolAction[] };

export function buildContextSegments(tools: ToolAction[]): Segment[] {
  const segments: Segment[] = [];
  let currentKind: ContextGroupKind | null = null;
  let bucket: ToolAction[] = [];

  const flushBucket = () => {
    if (bucket.length === 0 || currentKind === null) return;
    if (currentKind !== 'other' && bucket.length > 1) {
      segments.push({ kind: 'context_group', key: `ctxg:${bucket.map((t) => t.id).join('|')}`, tools: bucket, groupType: currentKind });
    } else {
      bucket.forEach((tool) => segments.push({ kind: 'context_single', key: `ctx:${tool.id}`, tool }));
    }
    bucket = [];
    currentKind = null;
  };

  tools.forEach((tool) => {
    const nextKind = getContextGroupKind(tool);
    const previousTool = bucket[bucket.length - 1];
    if (previousTool && getContextToolSignature(previousTool) === getContextToolSignature(tool)) {
      return;
    }
    if (currentKind === null || currentKind === nextKind) {
      currentKind = nextKind;
      bucket.push(tool);
      return;
    }

    flushBucket();
    currentKind = nextKind;
    bucket = [tool];
  });

  flushBucket();
  return segments;
}

function computeSegments(
  tools: ToolAction[],
  thinkingContent?: string,
  steps?: TimelineStep[]
): Segment[] {
  if (steps && steps.length > 0) {
    const linear: Array<{ kind: 'thinking' | 'text'; content: string; key: string } | { kind: 'tool'; tool: ToolAction; stepId: string }> = [];
    steps.forEach((step) => {
      const toolMap = new Map(step.toolCalls.map((tool) => [tool.id, tool]));
      if (step.events && step.events.length > 0) {
        step.events.forEach((event, evtIdx) => {
          if (event.type === 'reasoning' && event.content.trim()) {
            linear.push({ kind: 'thinking', content: event.content, key: `think:${step.id}:${evtIdx}` });
          } else if (event.type === 'text' && event.content.trim()) {
            linear.push({ kind: 'text', content: event.content, key: `text:${step.id}:${evtIdx}` });
          } else if (event.type === 'tool') {
            const tc = toolMap.get(event.toolCallId);
            if (!tc) return;
            linear.push({
              kind: 'tool',
              stepId: step.id,
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
        linear.push({ kind: 'thinking', content: step.reasoning, key: `think:${step.id}` });
      }
      if (step.output?.trim() && (!step.events || step.events.length === 0)) {
        linear.push({ kind: 'text', content: step.output, key: `text:${step.id}` });
      }
      step.toolCalls.forEach(tc => {
        linear.push({
          kind: 'tool',
          stepId: step.id,
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
    /* 中文注释：连续 action 工具缓冲 —— 同一思考过程（两次 reasoning/text 之间）里的多条
       bash/写文件/浏览器等执行完成后折叠成一个 step_group；单个 action 工具仍平铺为 action。
       边界以 thinking/text 事件为准，而非 step 边界：appendTimelineToolUse 会让每条工具独占
       一个 step，若按 stepId 切分则永远凑不满 2 条、折叠永不触发。 */
    let actionBuffer: ToolAction[] = [];

    const flushContext = () => {
      segments.push(...buildContextSegments(contextBuffer));
      contextBuffer = [];
    };

    const flushAction = () => {
      if (actionBuffer.length === 0) return;
      if (actionBuffer.length >= 2) {
        segments.push({ kind: 'step_group', key: `stepg:${actionBuffer.map((t) => t.id).join('|')}`, tools: actionBuffer });
      } else {
        segments.push({ kind: 'action', key: `action:${actionBuffer[0].id}`, tool: actionBuffer[0] });
      }
      actionBuffer = [];
    };

    for (const item of linear) {
      if (item.kind === 'thinking') {
        flushContext();
        flushAction();
        segments.push({ kind: 'thinking', key: item.key, content: item.content });
      } else if (item.kind === 'text') {
        flushContext();
        flushAction();
        segments.push({ kind: 'text', key: item.key, content: item.content });
      } else if (item.kind === 'tool') {
        if (isActionTool(item.tool.name)) {
          flushContext();
          actionBuffer.push(item.tool);
        } else {
          flushAction();
          contextBuffer.push(item.tool);
        }
      }
    }
    flushContext();
    flushAction();
    return segments;
  }

  const segments: Segment[] = [];
  if (thinkingContent?.trim()) {
    segments.push({ kind: 'thinking', key: 'think:live', content: thinkingContent });
  }

  let contextBuffer: ToolAction[] = [];
  const flushContext = () => {
    segments.push(...buildContextSegments(contextBuffer));
    contextBuffer = [];
  };

  for (const tool of tools) {
    if (isActionTool(tool.name)) {
      flushContext();
      segments.push({ kind: 'action', key: `action:${tool.id}`, tool });
    } else {
      contextBuffer.push(tool);
    }
  }
  flushContext();
  return segments;
}

function ContextGroup({ tools, groupType, timelineIcon }: { tools: ToolAction[]; groupType: ContextGroupKind; timelineIcon?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { openPreviewTab } = usePanel();
  const hasRunning = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const readItems = React.useMemo(() => extractReadGroupItems(tools), [tools]);
  const searchSummary = React.useMemo(() => extractSearchGroupSummary(tools), [tools]);

  const meta = groupType === 'read'
    ? {
        icon: Eyeglasses,
        title: hasRunning ? `正在读取 ${tools.length} 个文件` : `读取了 ${readItems.length || tools.length} 个文件`,
        detailItems: readItems,
        emptyText: '暂无已读取的文件清单',
      }
    : {
        icon: MagnifyingGlass,
        title: hasRunning
          ? `正在搜索（${searchSummary.queryCount} 次）`
          : `搜索了 ${searchSummary.queryCount} 次，命中 ${searchSummary.resultCount} 项`,
        detailItems: searchSummary.items,
        emptyText: '暂无可展示的搜索结果',
      };
  const GroupIcon = meta.icon;

  return (
    <div className={cn("relative my-1 overflow-hidden", timelineIcon && "pl-8")}>
      {timelineIcon && (
        <div className="absolute left-0 top-0 z-10 flex h-5 w-5 items-center justify-center">
          <GroupIcon size={14} className="text-blue-500" />
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between py-1 text-[12px] hover:bg-muted/40 transition-colors rounded-[6px]",
          /* 中文注释：与 ContextSingleRow 同一规则 —— 时间线行左侧零内边距，文字对齐 pl-8 边界。 */
          timelineIcon ? "pr-2" : "px-2"
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0 pr-2">
          {!timelineIcon && <GroupIcon size={14} className="text-blue-500 shrink-0" />}
          <span
            className="text-foreground/80 truncate"
            title={meta.title}
          >
            {meta.title}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasRunning && <SpinnerGap size={14} className="animate-spin text-primary" />}
          {!hasRunning && hasError && <XCircle size={14} className="text-red-500" />}
          {!hasRunning && !hasError && <CheckCircle size={14} className="text-emerald-500" />}
          <CaretDown
            size={14}
            className={cn(
              "shrink-0 text-muted-foreground/55 transition-transform duration-200",
              expanded ? "rotate-0" : "-rotate-90"
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
            <div className="border-t border-border/20 bg-muted/10 p-2">
              {meta.detailItems.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-muted-foreground/60">
                  {meta.emptyText}
                </div>
              ) : (
                <div className="space-y-1">
                  {meta.detailItems.map((item, index) => (
                    <button
                      key={`${item.path || item.label}-${index}`}
                      type="button"
                      disabled={!item.path}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (item.path) openPreviewTab(item.path);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors",
                        item.path ? "hover:bg-muted/60 cursor-pointer" : "cursor-default"
                      )}
                      title={item.title || item.label}
                    >
                      <div className="w-1 h-1 rounded-full bg-blue-500/40 shrink-0" />
                      <span className={cn("truncate", item.path ? "text-blue-500 underline underline-offset-2" : "text-muted-foreground/75")}>
                        {item.label}
                      </span>
                      {item.path && (
                        <span className="truncate text-[10px] text-muted-foreground/45 min-w-0 ml-auto">
                          {item.path}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {groupType === 'search' && (
                <div className="px-2 pt-2 text-[10px] text-muted-foreground/45">
                  已合并连续搜索调用，避免重复占用消息区域。
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step tool group — 同一思考步骤内连续的 action 工具（bash/写文件/浏览器等）
// 执行完成后折叠成一条摘要，点击展开后像文件树一样向右缩进逐条查看。
// ---------------------------------------------------------------------------

function buildStepSummary(tools: ToolAction[]): string {
  const n = tools.length;
  const kinds = tools.map((t) => toolKind2(t.name));
  const bashCount = kinds.filter((k) => k === 'bash').length;
  const writeCount = kinds.filter((k) => k === 'write' || k === 'create').length;
  if (bashCount === n) return `执行了 ${n} 条命令`;
  if (writeCount === n) return `修改了 ${n} 个文件`;
  return `执行了 ${n} 个操作`;
}

function StepToolGroup({ tools, sessionId, rewindId }: { tools: ToolAction[]; sessionId?: string; rewindId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = tools.some((t) => t.isError);
  const summary = buildStepSummary(tools);
  const allBash = tools.every((t) => toolKind2(t.name) === 'bash');
  const GroupIcon = allBash ? Terminal : Lightning;

  return (
    <div className="relative my-1 pl-8">
      {/* 左侧图标槽 —— 与时间线其它行对齐 */}
      <div className="absolute left-0 top-0 z-10 flex h-5 w-5 items-center justify-center">
        <GroupIcon size={14} className={hasError ? 'text-red-500/80' : 'text-emerald-500'} />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between py-1 pr-2 text-[12px] hover:bg-muted/40 transition-colors rounded-[6px]"
      >
        <span className={cn('truncate text-left font-medium', hasError ? 'text-red-500/80' : 'text-foreground/80')} title={summary}>
          {summary}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {hasError ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-emerald-500" />}
          <CaretDown
            size={14}
            className={cn('shrink-0 text-muted-foreground/55 transition-transform duration-200', expanded ? 'rotate-0' : '-rotate-90')}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            {/* 文件树：左侧竖线 + 每个子条目一条小横线连接 */}
            <div className="relative ml-[7px] border-l border-border/60 pl-4">
              {tools.map((tool) => (
                <div key={tool.id} className="relative">
                  <span className="absolute -left-4 top-[15px] h-px w-4 bg-border/60" aria-hidden="true" />
                  <ActionToolCard tool={tool} sessionId={sessionId} rewindId={rewindId} />
                </div>
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
  // 中文注释：对齐 cc-haha ThinkingBlock——思考默认折叠，图标右侧内联展示最近一段
  // 思考预览（最后一条非空行），用户点击才展开完整思考过程，不再自动展开后再收起。
  const [expanded, setExpanded] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const { stopScroll } = useStickToBottomContext();

  const preview = React.useMemo(() => {
    const lines = content.split('\n').filter((l) => l.trim());
    const lastLine = lines[lines.length - 1]?.replace(/\s+/g, ' ').trim() || '';
    return lastLine.length > 80 ? lastLine.slice(0, 80) + '...' : lastLine;
  }, [content]);

  React.useEffect(() => {
    if (expanded && isStreaming && scrollRef.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [content, expanded, isStreaming]);

  return (
    <div className="group relative my-1 flex items-start justify-start pl-8">
      <style>{thinkingCursorStyles}</style>

      {/* 时间线图标绝对定位在标题行顶部，避免展开内容导致图标随行高漂移 */}
      <div className="absolute left-0 top-0 z-10 flex h-5 w-5 items-center justify-center">
        <Brain size={14} className="text-[var(--color-text-tertiary)]" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start">
        <button
          type="button"
          onClick={() => {
            const willExpand = !expanded;
            setExpanded(willExpand);
            if (willExpand) stopScroll();
          }}
          className="flex min-h-5 w-full items-center justify-between rounded-[6px] text-left text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <div className="flex min-w-0 items-center gap-2 overflow-hidden pr-2">
            <span className="shrink-0 font-medium">
              思考
              {isStreaming && <span className="thinking-dots" />}
            </span>
            {!expanded && preview && (
              <>
                <span className="mx-1 shrink-0 text-[var(--color-border)]">|</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)] opacity-80">
                  {preview}
                  {isStreaming && <span className="thinking-inline-cursor" />}
                </span>
              </>
            )}
          </div>
          <CaretDown
            size={14}
            className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        {expanded && (
          <div
            ref={scrollRef}
            className="mt-1.5 w-full max-h-[300px] overflow-y-auto rounded-lg border border-[var(--color-border)]/30 bg-[var(--color-surface-container-lowest)]/50 p-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)] shadow-sm"
          >
            <Streamdown
              plugins={thinkingPlugins}
              components={markdownComponents}
            >
              {content}
            </Streamdown>
            {isStreaming && <span className="thinking-cursor" />}
          </div>
        )}
      </div>
    </div>
  );
}

const thinkingCursorStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-inline-cursor {
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--color-text-tertiary);
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
`

// ---------------------------------------------------------------------------
// Compact row for a single tool action
// ---------------------------------------------------------------------------

import { getToolDisplayName } from '@/lib/tool-display-names';

function ContextSingleRow({ tool, streamingToolOutput, expandedOverride, onToggle, timelineIcon }: { tool: ToolAction; streamingToolOutput?: string; expandedOverride?: boolean; onToggle?: () => void; timelineIcon?: boolean }) {
  const renderer = getRenderer(tool.name, tool.input);
  const { openPreviewTab } = usePanel();
  
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
  // 中文注释：行级工具默认折叠，仅用户点击展开（去掉运行中自动展开/结束后自动合上）。
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const expanded = expandedOverride !== undefined ? expandedOverride : internalExpanded;

  const hasRawContent = !hasDetail && (tool.result || (tool.input && Object.keys(tool.input as Record<string, unknown>).length > 0));
  const currentOpen = hasRawContent ? showRaw : expanded;

  return (
    <div className={cn(
      "relative my-1 overflow-hidden",
      timelineIcon && "pl-8"
    )}>
      {timelineIcon && (
        <div className="absolute left-0 top-0 z-10 flex h-5 w-5 items-center justify-center">
          {createElement(renderer.icon, { size: 14, className: status === 'error' ? "text-red-500/80" : (isTeam ? "text-purple-500" : (isTodoWrite ? "text-blue-500" : "text-blue-500")) })}
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (detailVisible || hasRawContent) {
            if (hasRawContent) setShowRaw(prev => !prev);
            else if (onToggle) onToggle();
            else setInternalExpanded((prev) => !prev);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (detailVisible || hasRawContent) {
              if (hasRawContent) setShowRaw(prev => !prev);
              else if (onToggle) onToggle();
              else setInternalExpanded((prev) => !prev);
            }
          }
        }}
        className={cn(
          "flex w-full items-center gap-2 py-1 text-[11px] hover:bg-muted/40 transition-colors text-left rounded-[6px]",
          /* 中文注释：对齐 cc-haha —— 时间线行左侧零内边距，文字直接落在 pl-8 边界（与"思考"行同列）；
             卡片内（非时间线）场景保留左右内边距。展开箭头统一放右侧，不再挤占文字列。 */
          timelineIcon ? "pr-2" : "px-2",
          isTeam ? "bg-purple-500/[0.05] hover:bg-purple-500/[0.1] text-purple-500" : "",
          isTodoWrite ? "bg-blue-500/[0.05] hover:bg-blue-500/[0.1] text-blue-500" : ""
        )}
      >
        {!timelineIcon && (
          <div className="flex shrink-0 items-center justify-center">
            {createElement(renderer.icon, { size: 14, className: status === 'error' ? "text-red-500/80" : (isTeam ? "text-purple-500" : (isTodoWrite ? "text-blue-500" : "text-blue-500")) })}
          </div>
        )}

        <span
          className={cn(
            "truncate text-left font-medium text-[12px]",
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
          {status === 'success' && ['read', 'read_file', 'mcp__filesystem__read_file', 'view_file'].some(n => tool.name.toLowerCase().includes(n)) && filePath && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPreviewTab(filePath);
              }}
              className="flex items-center justify-center rounded-sm hover:text-primary transition-colors focus-visible:outline-none"
              title="预览文件"
            >
              <Eye size={14} />
            </button>
          )}
          {status === 'running' && <SpinnerGap size={14} className={cn("animate-spin", isTeam ? "text-purple-500" : "text-primary")} />}
          {status === 'success' && <CheckCircle size={14} className={isTeam ? "text-purple-500" : (isTodoWrite ? "text-blue-500" : "text-emerald-500")} />}
          {status === 'error' && <XCircle size={14} className="text-red-500" />}
          {/* 中文注释：展开箭头固定在右侧（对齐 cc-haha 的 ChevronDown 位置），
              不再出现在图标与文字之间造成文字列错位。 */}
          {detailVisible || hasRawContent ? (
            <CaretDown
              size={14}
              className={cn(
                "shrink-0 text-muted-foreground/55 transition-transform duration-200",
                currentOpen ? "rotate-0" : "-rotate-90"
              )}
            />
          ) : null}
        </div>
      </div>
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
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/70 max-h-[400px] overflow-y-auto">
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
                      "whitespace-pre-wrap break-all font-mono text-[11px] max-h-[400px] overflow-y-auto",
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

  // 中文注释：工具卡默认折叠，仅用户点击展开 —— 不再"运行时自动展开、结束后 500ms 自动合上"。
  const [expanded, setExpanded] = useState(false);
  
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

  if (k === 'write' || k === 'create') {
    const diff = extractDiff(tool);
    if (diff) {
      return <FileReviewRow diff={diff} status={status} sessionId={sessionId} rewindId={rewindId} />;
    }
    if (status === 'running') {
      const path = fp2(tool.input);
      if (path) {
        return (
          <FileReviewRow
            diff={{
              filename: fname2(path),
              fullPath: path,
              mode: k === 'create' ? 'create' : 'edit',
              added: 0,
              removed: 0,
              beforeLines: [],
              afterLines: [],
              moreB: 0,
              moreA: 0,
            }}
            status={status}
            sessionId={sessionId}
            rewindId={rewindId}
          />
        );
      }
      // 中文注释：等待文件路径到达时，用占位文件卡展示「写入文件/编辑文件 + 等待文件路径...」，
      // 避免出现黑色小条空卡片（对齐 cc-haha 的 isFileChangeWaiting 处理）。
      return (
        <FileReviewRow
          diff={{
            filename: k === 'create' ? '写入文件' : '编辑文件',
            fullPath: '',
            mode: k === 'create' ? 'create' : 'edit',
            added: 0,
            removed: 0,
            beforeLines: [],
            afterLines: [],
            moreB: 0,
            moreA: 0,
          }}
          status={status}
          pending
        />
      );
    }
  }
  
  if (k === 'bash') {
    const rawCmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
    // 去除 AI SDK 自动添加的工作目录 cd 前缀，保留真实的执行命令
    const cmd = rawCmd.replace(/^cd\s+(?:'[^']+'|"[^"]+"|[^&]+)\s*&&\s*/, '');
    const displayName = getToolDisplayName(tool.name);

    return (
      /* 中文注释：对齐 cc-haha ToolCallBlock 的终端卡片——图标收进卡片内部、全宽、
         surface-container 背景 + 细边框 + 轻阴影，展开后命令与输出分块显示。 */
      <div className="my-1 flex w-full flex-col rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container)] shadow-sm">
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
          className="flex min-w-0 w-full items-center justify-between py-1.5 pr-3 pl-2.5 cursor-pointer rounded-[6px] transition-colors duration-200 hover:bg-[var(--color-surface-hover)]/30 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <Terminal size={14} weight="bold" className="text-[var(--timeline-bash)]" />
            </span>
            <span className="shrink-0 text-[13px] font-medium text-[var(--color-text-primary)]" title={displayName}>{displayName}</span>
            {cmd && (
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)] opacity-80"
                title={`$ ${cmd}`}
              >
                $ {cmd}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 ml-2 text-[11px] text-[var(--color-text-tertiary)] transition-colors">
            {status === 'running' && <SpinnerGap size={14} className="animate-spin text-primary" />}
            {status === 'success' && <CheckCircle size={14} className="text-emerald-500" />}
            {status === 'error' && <XCircle size={14} className="text-red-500" />}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBottomPanelTab('terminal');
                setBottomPanelOpen(true);
                setTerminalOpen(true);
                // 中文注释：功能名称「终端历史回放」，用法是点击在终端查看时，
                // 把该工具卡的命令和结果通过事件传递给终端面板显示
                // 注意这里传回 rawCmd 以保证完整回放
                window.dispatchEvent(new CustomEvent('terminal:show-history', {
                  detail: {
                    command: rawCmd,
                    result: tool.result || '',
                    isError: tool.isError || false,
                  },
                }));
                setTimeout(() => window.dispatchEvent(new CustomEvent('action:focus-terminal')), 50);
              }}
              className="flex items-center gap-1 hover:text-[var(--color-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
              title="在终端查看"
            >
              在终端查看 <ArrowSquareOut size={12} />
            </button>
            <CaretDown
              size={14}
              className="shrink-0 transition-transform duration-200"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
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
              <div className="w-full border-t border-[var(--color-border)]/20">
                {cmd && (
                  <div className="overflow-x-auto bg-[var(--color-code-bg)] px-3 py-2.5 font-mono text-[12px] leading-[1.4] whitespace-pre-wrap break-words">
                    <span className="mr-1.5 select-none text-[var(--color-primary)] opacity-80">$</span>
                    <span className="text-[var(--color-text-primary)]">{cmd}</span>
                  </div>
                )}
                <pre className="max-h-[300px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[12px] leading-[1.4] text-[var(--color-text-secondary)] opacity-80">
                  {status === 'running' ? streamingToolOutput || '执行中...' : (tool.result || '执行完成，无输出')}
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
        <div className="border border-blue-500/30 bg-[var(--color-surface-container)] rounded-[6px] overflow-hidden shadow-sm">
          <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
        </div>
      </div>
    );
  }

  if (k === 'todowrite') {
    return (
      <div className="my-1 border border-blue-500/30 bg-[var(--color-surface-container)] rounded-[6px] overflow-hidden shadow-sm">
        <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
      </div>
    );
  }

  if (k === 'team') {
    return (
      <div className="my-1 border border-purple-500/30 bg-[var(--color-surface-container)] rounded-[6px] overflow-hidden shadow-sm">
        <ContextSingleRow tool={tool} streamingToolOutput={streamingToolOutput} expandedOverride={expanded} onToggle={() => setExpanded(!expanded)} />
      </div>
    );
  }

  return (
    /* 中文注释：通用工具卡对齐 cc-haha 容器语言——surface-container 背景 + 细边框 + 轻阴影 */
    <div className="my-1 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container)] shadow-sm">
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

function FileReviewRow({ diff, status, pending }: { diff: DiffInfo; status?: 'running' | 'success' | 'error'; sessionId?: string; rewindId?: string; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const { stopScroll } = useStickToBottomContext();
  const { openPreviewTab } = usePanel();

  const showPreviewBtn = canPreview(diff.filename);

  return (
    /* 中文注释：对齐 cc-haha ToolCallBlock 的文件编辑卡片——图标收进卡片内部、全宽、
       surface-container 背景 + 细边框 + 轻阴影；写入中右侧显示 loading 圆圈，
       下方显示「正在写入文件...」状态条，点击可展开查看新增/删除内容。 */
    <div className="my-1 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container)] shadow-sm">
      <div className="flex min-w-0 w-full cursor-pointer items-center justify-between py-1.5 pr-3 pl-2.5 rounded-[6px] transition-colors duration-200 hover:bg-[var(--color-surface-hover)]/30" onClick={() => { if (!pending) { setOpen(v => !v); if (!open) stopScroll(); } }}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {diff.mode === 'create'
              ? <FilePlus size={14} className="text-emerald-500" />
              : <NotePencil size={14} className="text-amber-500" />}
          </span>
          <span
            className="shrink-0 text-[13px] font-medium text-[var(--color-text-primary)]"
            title={diff.filename}
          >
            {diff.filename}
          </span>
          <span
            className="hidden max-w-[300px] truncate font-mono text-[10px] text-[var(--color-text-tertiary)] opacity-80 sm:inline"
            title={diff.fullPath}
          >
            {pending ? '等待文件路径...' : diff.fullPath}
          </span>
          <span className="ml-1 flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {diff.added > 0 && <span className="rounded bg-[var(--color-success)]/10 px-1 text-[var(--color-success)]">+{diff.added}</span>}
            {diff.removed > 0 && <span className="rounded bg-[var(--color-error)]/10 px-1 text-[var(--color-error)]">-{diff.removed}</span>}
          </span>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          {status === 'running' && <SpinnerGap size={14} className="animate-spin text-[var(--color-text-tertiary)]" />}
          {status === 'success' && <CheckCircle size={14} className="text-emerald-500" />}
          {status === 'error' && <XCircle size={14} className="text-red-500" />}
          {!pending && (
            <span className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]">
              查看变更
              <CaretDown size={14} className={cn("text-[var(--color-text-tertiary)] transition-transform", open && 'rotate-180')} />
            </span>
          )}
          {showPreviewBtn && (
             <button
               type="button"
               onClick={(e) => {
                 e.stopPropagation();
                 openPreviewTab(diff.fullPath);
               }}
               className="rounded p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
               title="预览渲染效果"
             >
               <Play size={14} weight="fill" />
             </button>
           )}
          {!pending && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (diff.fullPath) openPreviewTab(diff.fullPath);
              }}
              className="rounded p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              title="在内置预览中打开"
            >
              <ArrowSquareOut size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Writing in progress indicator */}
      {status === 'running' && (
        <div className="flex items-center gap-2.5 border-t border-[var(--color-border)]/10 px-3 py-2">
          <SpinnerGap size={14} className="animate-spin text-[var(--color-text-tertiary)]" />
          <span className="text-[12px] text-[var(--color-text-tertiary)]">正在写入文件...</span>
          <div className="flex-1" />
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text-tertiary)]" style={{ animationDelay: '0ms' }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text-tertiary)]" style={{ animationDelay: '200ms' }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text-tertiary)]" style={{ animationDelay: '400ms' }} />
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div className="flex flex-col border-t border-[var(--color-border)]/20 text-[11px] max-h-[400px] overflow-y-auto font-mono">
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

// 中文注释：React.memo —— 流式期间 StreamingMessage 每帧重渲染（渐进揭示 12ms），
// 工具组在结构未变时跳过重渲染，避免整棵时间线树每帧重算（卡顿来源之一）。
export const ToolActionsGroup = React.memo(function ToolActionsGroup({
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
  processCollapse,
}: ToolActionsGroupProps & { flat?: boolean; sessionId?: string; rewindUserMessageId?: string; hideSubAgents?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // ---------------------------------------------------------------------------
  // 交付折叠
  // ---------------------------------------------------------------------------
  const collapseEnabled = processCollapse !== undefined;
  const delivered = processCollapse?.delivered ?? false;

  /**
   * 中文注释：初值就是一个静态判断 —— 任务已完成就收起，否则展开。
   *
   * 之所以可以这么简单（不需要任何「交付边沿」的 effect）：本组件挂载的这一刻，
   * 这条消息的任务状态就已经定死了。流式期间父组件（StreamingMessage）根本不传
   * processCollapse，走 flat 铺开；传 processCollapse 的只有 MessageItem，
   * 而消息一旦落定，delivered 就不会再变。
   * 无交付边沿 = 无「中途收起后弹不回来」的隐患（那是一版按 isSummarizing 触发的 bug）。
   */
  const [collapseExpanded, setCollapseExpanded] = useState(() => !delivered);

  /**
   * 中文注释：收起动画时长。只用于用户手动收起自己刚展开的过程块；
   * 交付那一刻的收起是挂载即定型（不需要动画，也不会看到高度跳变）。
   */
  const collapseDuration = 0.34;

  const handleCollapseToggle = React.useCallback(() => {
    setCollapseExpanded((value) => !value);
  }, []);

  // 交付折叠模式下由 collapseExpanded 决定开合；否则沿用手风琴自己的 expanded（历史上未被使用，保留兼容）
  const isExpanded = collapseEnabled ? collapseExpanded : expanded;

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
          <EnterOnce key={segment.key} active={isStreaming && segment.tool.result === undefined}>
            <ActionToolCard
              tool={segment.tool}
              isStreaming={isStreaming && segment.tool.result === undefined}
              streamingToolOutput={isStreaming && segment.tool.result === undefined ? streamingToolOutput : undefined}
              sessionId={sessionId}
              rewindId={rewindUserMessageId}
            />
          </EnterOnce>
        );
      } else if (segment.kind === 'thinking') {
        flushLineGroup();
        const isSegmentStreaming = isStreaming && idx === segments.length - 1;
        blocks.push(
          <EnterOnce key={segment.key} active={isSegmentStreaming}>
            <ThinkingRow content={segment.content} isStreaming={isSegmentStreaming} />
          </EnterOnce>
        );
      } else if (segment.kind === 'text') {
        flushLineGroup();
        blocks.push(
          /* 中文注释：中段文字按"正常助手消息"渲染 —— 与 cc-haha 一致（带蓝色消息图标、
             与正文同一列）。-ml-8 + 图标槽让图标对齐消息图标列、文字对齐正文，
             因此"正文→时间线"重归类时文字位置不变，只多出图标。
             w-[calc(100%+2rem)] 补偿 -ml-8 造成的左移，否则右边缘会比时间线行少 32px。 */
          <div key={segment.key} className="animate-segment-enter relative -ml-8 my-1 flex w-[calc(100%+2rem)] items-start gap-3">
            <div className="flex h-[20px] w-5 shrink-0 items-center justify-center pt-[1px]">
              <ChatCircle size={16} className="text-[#2F80ED]" weight="regular" />
            </div>
            <Streamdown
              /* min-w-0 必须保留：flex 子项默认 min-width:auto，宽表格/长代码会把这一列
                 撑到 max-content 宽度，直接溢出到消息列外面（实测 820px 列里撑出 2032px）。 */
              className={cn("min-w-0 flex-1 text-sm text-foreground leading-relaxed break-words", MARKDOWN_PROSE_CLASS)}
              plugins={thinkingPlugins}
              components={markdownComponents}
            >
              {segment.content}
            </Streamdown>
          </div>
        );
      } else if (segment.kind === 'context_group') {
        currentLineGroup.push(
          <EnterOnce key={segment.key} active={isStreaming && segment.tools.some((t) => t.result === undefined)}>
            <ContextGroup tools={segment.tools} groupType={segment.groupType} timelineIcon />
          </EnterOnce>
        );
      } else if (segment.kind === 'context_single') {
        currentLineGroup.push(
          <EnterOnce key={segment.key} active={isStreaming && segment.tool.result === undefined}>
            <ContextSingleRow tool={segment.tool} streamingToolOutput={isStreaming && segment.tool.result === undefined ? streamingToolOutput : undefined} timelineIcon />
          </EnterOnce>
        );
      } else if (segment.kind === 'step_group') {
        flushLineGroup();
        blocks.push(
          <EnterOnce key={segment.key} active={false}>
            <StepToolGroup tools={segment.tools} sessionId={sessionId} rewindId={rewindUserMessageId} />
          </EnterOnce>
        );
      }
    });
    flushLineGroup();
    
    return <>{blocks}</>;
  };

  // Filter out raw JSON payloads from statusText
  const displayStatusText = statusText && (!statusText.startsWith('{') && !statusText.includes('"subtype"')) ? statusText : undefined;

  // If flat mode, just render the segments without the outer container.
  // 中文注释：交付折叠开启时必须走手风琴（见 props 注释），因此这里互斥。
  if (flat && !collapseEnabled) {
    if (segments.length === 0) return null;
    return (
      <div className="my-1">
        {renderSegments()}
      </div>
    );
  }

  // Trae style collapsible accordion
  const hasTools = tools.length > 0;

  // 中文注释：交付折叠模式下没有可收起的段落就直接不渲染，避免留一条空汇总条
  if (collapseEnabled && segments.length === 0) return null;

  /* 中文注释：交付折叠下，这条标题就是收起后用户唯一能看到的过程信息（展开态则是运行中提示）。
     判定带上 `delivered`：被中断、没给出结论的消息（delivered=false）即使不再流式，
     也不该被读成「思考完毕」——它其实是没跑完，文案要说实话。 */
  const stillWorking = isStreaming && !delivered;
  let statusTitle = '';
  if (hasTools) {
    if (stillWorking) {
      statusTitle = hasRunningTool ? '正在执行任务...' : '思考...';
    } else {
      statusTitle = groupStatus === 'error' ? '执行遇到错误' : `${tools.length}个已完成 · 思考与执行完毕`;
    }
  } else {
    if (stillWorking) {
      statusTitle = '思考...';
    } else {
      statusTitle = '思考完毕';
    }
  }

  // Override if there is specific status text
  // We no longer override with displayStatusText because system status (like "Loading rules...")
  // should be displayed independently in StreamingStatusBar.

  /* 中文注释：交付折叠的过渡曲线。
     收起与展开给的是两条不同的时间线，因为两个动作要"读起来"是同一件事：
     - 展开：容器先减速撑开（0.4s ease-out），内容延迟 60ms 再淡入 —— 先让出位置再显影，
       否则文字会在容器还只有几像素高时就以全亮度挤出来，看着像闪了一下。
     - 收起：高度用同一条 ease-out（起始快、收尾慢，符合"东西被吸上去"的直觉），
       透明度用 easeIn 拖到后段才淡出 —— 内容主体靠 overflow:hidden 从底部裁切消失，
       而不是和高度同速淡出。同速淡出会出现"先整块变淡、再合拢空隙"的两段式观感。 */
  const expandTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : {
        height: { duration: 0.4, ease: ENTER_EASE },
        opacity: { duration: 0.24, ease: 'easeOut', delay: 0.06 },
      };

  const exitTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : {
        height: { duration: collapseDuration, ease: EXIT_EASE },
        opacity: { duration: collapseDuration, ease: [0.55, 0, 1, 1] },
      };

  return (
    <div className="my-1">
      {tools.length > 0 || (steps && steps.length > 0) ? (
        <button
          type="button"
          onClick={(event) => {
            // 中文注释：过程块里的中段文字/卡片本身可能带点击行为，头部按钮只负责开合
            event.preventDefault();
            if (collapseEnabled) handleCollapseToggle();
            else setExpanded(!expanded);
          }}
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
            className={cn("shrink-0 transition-transform duration-200 opacity-50 group-hover:opacity-100", isExpanded && "rotate-180")}
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
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: expandTransition }}
            exit={{ height: 0, opacity: 0, transition: exitTransition }}
            /* 中文注释：overflow:hidden 是收起动画的关键 —— 高度收缩时内容从底部被裁切，
               而不是被压扁。也正因为有裁切，透明度才敢走「后段才淡出」（见 exitTransition）。
               刻意不加 translateY：globals.css 里记录过，位移中的文字会落到亚像素位置被重采样，
               表现为"文字发虚"（与流式滚动叠加时更明显）。 */
            style={{ overflow: 'hidden' }}
          >
            <div className="py-2">
              {/* 中文注释：对齐 cc-haha 时间线——去掉整体左侧竖线缩进，改为每行自带 pl-8 绝对定位图标；
                  带容器的卡片（bash/文件编辑/通用工具）全宽渲染，与 cc-haha 一致 */}
              <div className="space-y-0.5">
                {renderSegments()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
