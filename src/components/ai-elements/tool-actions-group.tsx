'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  File, FilePlus, NotePencil, Terminal, MagnifyingGlass,
  Wrench, SpinnerGap, CheckCircle, XCircle, CaretDown,
  Brain, Eye, GitDiff, Check, X, ArrowSquareOut, Code,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import type { MediaBlock } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  isStreaming?: boolean;
  streamingToolOutput?: string;
  flat?: boolean;
  thinkingContent?: string;
  statusText?: string;
  sessionId?: string;
  rewindUserMessageId?: string;
  referencedFiles?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rec(input: unknown): Record<string, unknown> {
  return (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
}
function fp(input: unknown): string {
  const o = rec(input); return String(o.file_path ?? o.path ?? o.filePath ?? '');
}
function fname(p: string) { return p.split('/').pop() || p; }
function shortP(p: string, max = 48) {
  return p.length <= max ? p : '…' + p.slice(p.length - max + 1);
}
function sv(input: unknown, keys: string[]): string {
  const o = rec(input);
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  return '';
}
function countLines(text: string): number { return text ? text.split('\n').length : 0; }
function previewLines(text: string, max = 10): { lines: string[]; more: number } {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all.length <= max) return { lines: all, more: 0 };
  return { lines: all.slice(0, max), more: all.length - max };
}

type ToolKind = 'read' | 'write' | 'create' | 'search' | 'bash' | 'other';
function toolKind(name: string): ToolKind {
  const n = name.toLowerCase();
  if (['read', 'readfile', 'read_file', 'read_text_file', 'read_multiple_files'].includes(n)) return 'read';
  if (['edit', 'notebookedit', 'notebook_edit'].includes(n)) return 'write';
  if (['write', 'writefile', 'write_file', 'create_file', 'createfile'].includes(n)) return 'create';
  if (['glob', 'grep', 'search', 'find_files', 'search_files', 'websearch', 'web_search'].some(x => n.includes(x))) return 'search';
  if (['bash', 'execute', 'run', 'shell', 'execute_command', 'computer'].includes(n)) return 'bash';
  return 'other';
}

function stepLabel(t: ToolAction): string {
  const k = toolKind(t.name);
  const p = fp(t.input);
  const fn = p ? fname(p) : '';

  // Return the raw tool name if it starts with mcp__ so it's readable
  const name = t.name.startsWith('mcp__') ? t.name : t.name;

  // Handle abort/error results — show friendly message
  if (t.isError && t.result) {
    if (t.result.includes('aborted') || t.result.includes('abort')) {
      return fn ? `${fn} — 已中断` : `${name} — 已中断`;
    }
  }

  switch (k) {
    case 'read':   return fn ? `读取 ${fn}` : '读取文件';
    case 'write':  return fn ? `编辑 ${fn}` : '编辑文件';
    case 'create': return fn ? `创建 ${fn}` : '创建文件';
    case 'search': {
      const q = sv(t.input, ['pattern', 'query', 'glob', 'q']);
      return q ? `搜索 "${q.length > 30 ? q.slice(0, 27) + '…' : q}"` : '搜索';
    }
    case 'bash': {
      const cmd = sv(t.input, ['command', 'cmd', 'input']);
      return cmd ? `$ ${cmd.length > 42 ? cmd.slice(0, 39) + '…' : cmd}` : '执行命令';
    }
    default: return name;
  }
}

function stepIcon(k: ToolKind) {
  const map = { read: File, write: NotePencil, create: FilePlus, search: MagnifyingGlass, bash: Terminal, other: Wrench };
  return map[k];
}

type StepStatus = 'running' | 'ok' | 'err';
function stepStatus(t: ToolAction): StepStatus {
  if (t.result === undefined) return 'running';
  return t.isError ? 'err' : 'ok';
}

export interface DiffInfo {
  filename: string; fullPath: string; mode: 'edit' | 'create';
  added: number; removed: number;
  beforeLines: string[]; afterLines: string[];
  moreB: number; moreA: number;
}

export function extractDiff(t: ToolAction): DiffInfo | null {
  const k = toolKind(t.name);
  if (k !== 'write' && k !== 'create') return null;
  const p = fp(t.input);
  const old = sv(t.input, ['old_string', 'oldText', 'previous']);
  const nw = sv(t.input, ['new_string', 'newText']);
  const content = sv(t.input, ['content']);
  if (k === 'write' && !old && !nw) return null;
  if (k === 'create' && !content) return null;
  const added = k === 'create' ? countLines(content) : countLines(nw);
  const removed = k === 'create' ? 0 : countLines(old);
  const { lines: bl, more: mb } = previewLines(old || '', 1000);
  const { lines: al, more: ma } = previewLines(k === 'create' ? content : nw, 1000);
  return {
    filename: p ? fname(p) : 'file', fullPath: p,
    mode: k === 'create' ? 'create' : 'edit',
    added, removed, beforeLines: bl, afterLines: al, moreB: mb, moreA: ma,
  };
}

// ─── Timeline segments ────────────────────────────────────────────────────────
// thinkingContent is "fullThinking\n\n---\n\naccumulatedThinking" — split by ---
// and interleave with tool calls so thinking appears BEFORE the tool it preceded.
//
// Layout: think[0] → tool[0] → think[1] → tool[1] → … → think[N] (current)

type Segment =
  | { type: 'thinking'; content: string; streaming: boolean }
  | { type: 'tool'; tool: ToolAction; streamingOutput?: string };

function buildSegments(
  tools: ToolAction[],
  thinkingContent: string | undefined,
  isStreaming: boolean,
  streamingToolOutput: string | undefined,
): Segment[] {
  const segs: Segment[] = [];
  const lastRunningId = [...tools].reverse().find(t => t.result === undefined)?.id;

  const phases = (thinkingContent || '')
    .split(/\n\n---\n\n/)
    .map(s => s.trim())
    .filter(Boolean);

  // Add all tools
  for (let i = 0; i < tools.length; i++) {
    if (phases.length > 0) {
      segs.push({ type: 'thinking', content: phases.shift()!, streaming: false });
    }
    segs.push({
      type: 'tool', tool: tools[i],
      streamingOutput: tools[i].id === lastRunningId ? streamingToolOutput : undefined,
    });
  }

  // Any remaining thinking phases (or the current thinking if no tools are running)
  for (let i = 0; i < phases.length; i++) {
    const isLast = i === phases.length - 1;
    segs.push({ type: 'thinking', content: phases[i], streaming: isLast && isStreaming });
  }

  return segs;
}
// ─── UI Components ────────────────────────────────────────────────────────────

/** Inline thinking row — always expanded, real-time, never truncated */
function ThinkingRow({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
        {streaming
          ? <SpinnerGap size={11} className="animate-spin text-violet-400/60" />
          : <Brain size={11} className="text-violet-400/60" />}
      </div>
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground/50 whitespace-pre-wrap break-words italic">
        {!content && streaming && (
          <span className="text-violet-400/40 not-italic">思考中…</span>
        )}
        {content}
        {streaming && content && (
          <span className="ml-0.5 inline-block h-2.5 w-0.5 animate-pulse rounded-sm bg-violet-400/40 align-middle not-italic" />
        )}
      </div>
    </div>
  );
}

/** Tool step row — one line per tool call */
function ToolRow({ tool, streamingOutput }: { tool: ToolAction; streamingOutput?: string }) {
  const k = toolKind(tool.name);
  const s = stepStatus(tool);
  const Icon = stepIcon(k);
  const label = stepLabel(tool);
  const diff = useMemo(() => extractDiff(tool), [tool]);
  const isBash = k === 'bash';
  const bashOutput = isBash ? (streamingOutput ?? (s !== 'running' ? tool.result : undefined)) : undefined;
  const hasBashOutput = isBash && bashOutput;
  // Show diff card for completed write/create, or while running if input already has content
  const showDiff = diff !== null;

  return (
    <div className="py-0.5">
      {/* main row */}
      <div className="flex items-center gap-2.5 py-1">
        <div className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
          s === 'running' && 'bg-blue-500/10',
          s === 'ok'      && 'bg-emerald-500/8',
          s === 'err'     && 'bg-red-500/8',
        )}>
          {s === 'running'
            ? <SpinnerGap size={11} className="animate-spin text-blue-400/70" />
            : <Icon size={11} className={cn(
                s === 'ok'  && 'text-emerald-500/60',
                s === 'err' && 'text-red-500/60',
              )} />
          }
        </div>
        <span className={cn(
          'flex-1 truncate text-[12px]',
          s === 'running' && 'text-foreground/70',
          s === 'ok'      && 'text-foreground/75',
          s === 'err'     && 'text-red-500/70',
        )}>
          {label}
        </span>
        {s === 'ok'  && <CheckCircle size={12} weight="fill" className="shrink-0 text-emerald-500/60" />}
        {s === 'err' && <XCircle     size={12} weight="fill" className="shrink-0 text-red-500/60" />}
        {s === 'running' && !isBash && (
          <span className="shrink-0 text-[11px] text-blue-400/50">进行中</span>
        )}
      </div>

      {/* error message block for non-bash tools */}
      {s === 'err' && tool.result && !isBash && (
        <div className="ml-[30px] mt-0.5 mb-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-500/80 leading-relaxed whitespace-pre-wrap break-all">
          {tool.result.length > 200 ? tool.result.slice(0, 200) + '...' : tool.result}
        </div>
      )}

      {/* bash output — compact, right below the step */}
      {hasBashOutput && <BashBlock output={bashOutput} live={!!streamingOutput} isError={s === 'err'} />}

      {/* diff card — right below the edit/create step, even while running */}
      {showDiff && <DiffCard diff={diff} />}
    </div>
  );
}

/** Compact bash output */
function BashBlock({ output, live, isError }: { output: string; live: boolean; isError?: boolean }) {
  const [open, setOpen] = useState(false);
  const { lines: ls, more } = previewLines(output, live ? 4 : 8);
  const preview = ls[0]?.slice(0, 60) || '';

  return (
    <div className="ml-[30px] mt-1 mb-1">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors",
          isError 
            ? "border-red-500/25 bg-red-500/[0.03] text-red-400 hover:bg-red-500/[0.06] dark:bg-red-950/30 dark:hover:bg-red-950/50"
            : "border-border/25 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 dark:bg-zinc-950/50 dark:hover:bg-zinc-950/70"
        )}>
        <Terminal size={10} className="shrink-0 text-zinc-500/50" />
        <span className="flex-1 truncate">{preview}{output.length > 60 ? '…' : ''}</span>
        {live && <span className="inline-block h-2.5 w-1 animate-pulse rounded-sm bg-zinc-400/40" />}
        <CaretDown size={9} className={cn('shrink-0 text-zinc-500/40 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.12 }} style={{ overflow: 'hidden' }}>
            <div className={cn(
              "max-h-[120px] overflow-auto rounded-b-md border border-t-0 px-2.5 py-2",
              isError
                ? "border-red-500/25 bg-red-500/[0.03] dark:bg-red-950/30"
                : "border-border/25 bg-zinc-900 dark:bg-zinc-950/50"
            )}>
              <pre className={cn(
                "whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.6]",
                isError ? "text-red-400" : "text-zinc-300 dark:text-zinc-400/60"
              )}>
                {ls.join('\n')}
                {more > 0 && `\n… +${more} lines`}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Diff card — shows +N -N, click to expand, click to open file */
function DiffCard({ diff }: { diff: DiffInfo }) {
  const [open, setOpen] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const openFile = () => {
    // Try to open file in editor via API
    fetch('/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: diff.fullPath }),
    }).catch(() => {});
  };

  return (
    <div className="ml-[30px] mt-1 mb-1 overflow-hidden rounded-lg border border-border/35">
      {/* header */}
      <div className="flex items-center gap-2 bg-muted/15 px-2.5 py-1.5 text-[11px]">
        <GitDiff size={11} className="shrink-0 text-muted-foreground/45" />
        <span className="flex-1 truncate font-mono text-foreground/70">{diff.filename}</span>
        {diff.added > 0 && <span className="text-emerald-500/70">+{diff.added}</span>}
        {diff.removed > 0 && <span className="text-red-400/60">-{diff.removed}</span>}
        {diff.mode === 'create' && (
          <span className="rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/12 text-emerald-500/70">new</span>
        )}
        <button type="button" onClick={() => { setOpen(v => !v); if (!open) stopScroll(); }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/50 hover:bg-muted/30 hover:text-muted-foreground/70 transition-colors">
          <Eye size={10} />{open ? '收起' : 'diff'}
        </button>
        {diff.fullPath && (
          <button type="button" onClick={openFile}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/50 hover:bg-muted/30 hover:text-muted-foreground/70 transition-colors">
            <ArrowSquareOut size={10} />打开
          </button>
        )}
      </div>
      {/* expandable diff */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/25 text-[11px] max-h-[400px] overflow-y-auto">
              {diff.mode === 'edit' && (
                <div className="bg-red-500/[0.03] px-2.5 py-2">
                  <pre className="whitespace-pre-wrap break-all font-mono leading-[1.65] text-muted-foreground/55">
                    {diff.beforeLines.map((l, i) => <div key={i}><span className="mr-1 select-none text-red-400/35">−</span>{l}</div>)}
                    {diff.moreB > 0 && <div className="text-muted-foreground/30">… +{diff.moreB} lines</div>}
                  </pre>
                </div>
              )}
              <div className={cn('bg-emerald-500/[0.03] px-2.5 py-2', diff.mode === 'create' && 'md:col-span-2')}>
                <pre className="whitespace-pre-wrap break-all font-mono leading-[1.65] text-foreground/70">
                  {diff.afterLines.map((l, i) => <div key={i}><span className="mr-1 select-none text-emerald-500/35">+</span>{l}</div>)}
                  {diff.moreA > 0 && <div className="text-muted-foreground/30">… +{diff.moreA} lines</div>}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
// ─── Completion summary ───────────────────────────────────────────────────────

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

/** Single file review row in completion section */
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
          <span className="truncate text-[12px] text-muted-foreground/55">{shortP(diff.fullPath, 42)}</span>
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function ToolActionsGroup({
  tools,
  isStreaming = false,
  streamingToolOutput,
  flat = false,
  thinkingContent,
  statusText,
  sessionId,
  rewindUserMessageId,
  referencedFiles,
}: ToolActionsGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const segments = useMemo(
    () => buildSegments(tools, thinkingContent, isStreaming, streamingToolOutput),
    [tools, thinkingContent, isStreaming, streamingToolOutput],
  );

  const allDone = !isStreaming && tools.length > 0 && tools.every(t => t.result !== undefined);
  const errCount = tools.filter(t => t.isError).length;
  const running = tools.filter(t => t.result === undefined);
  const changedFiles = useMemo(() => {
    return tools
      .map(t => ({ tool: t, diff: extractDiff(t) }))
      .filter((x): x is { tool: ToolAction; diff: DiffInfo } => x.diff !== null);
  }, [tools]);

  if (segments.length === 0) return null;

  if (flat) {
    return (
      <div className="py-1">
        <div className="relative pl-3 ml-2.5 border-l-2 border-border/30 pb-1">
          {segments.map((seg, i) => (
            <div key={i}>
              {seg.type === 'thinking' ? (
                <ThinkingRow content={seg.content} streaming={seg.streaming} />
              ) : (
                <ToolRow tool={seg.tool} streamingOutput={seg.streamingOutput} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 功能：Trae 风格的工具调用折叠面板
  // 用法：渲染一个按钮，在默认情况下仅展示工具总数和当前运行的工具状态，点击可展开完整的工具调用时间线
  const summaryText = running.length > 0
    ? `${stepLabel(running[running.length - 1])}…`
    : `使用了 ${tools.length} 个工具`;

  return (
    <div className="py-2">
      {/* Trae style Accordion Header */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <button 
          type="button" 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
        >
          <div className="flex h-5 w-5 items-center justify-center rounded bg-muted/30">
            {running.length > 0 ? (
              <SpinnerGap size={12} className="animate-spin text-blue-500/70" />
            ) : errCount > 0 ? (
              <Wrench size={12} className="text-red-500/70" />
            ) : (
              <Brain size={12} className="text-violet-500/70" />
            )}
          </div>
          <span className="font-medium">{summaryText}</span>
          <CaretDown size={10} className={cn("transition-transform duration-200", expanded ? "rotate-180" : "")} />
        </button>

        {/* Referenced Context Tags */}
        {referencedFiles && referencedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 ml-1">
            {referencedFiles.map((file, idx) => {
              const isAgents = file.includes('AGENTS.md');
              const isClaude = file.includes('CLAUDE.md');
              const isRules = file.includes('rules.md');
              return (
                <div 
                  key={idx}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-[10px] text-muted-foreground/80 font-medium"
                >
                  <Code size={10} className={cn(
                    isAgents && "text-blue-500/70",
                    isClaude && "text-indigo-500/70",
                    isRules && "text-emerald-500/70"
                  )} />
                  <span>{fname(file)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(expanded || isStreaming) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="relative pl-3 ml-2.5 border-l-2 border-border/30 pb-2">
              {segments.map((seg, i) => (
                <div key={i}>
                  {seg.type === 'thinking' ? (
                    <ThinkingRow content={seg.content} streaming={seg.streaming} />
                  ) : (
                    <ToolRow tool={seg.tool} streamingOutput={seg.streamingOutput} />
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
