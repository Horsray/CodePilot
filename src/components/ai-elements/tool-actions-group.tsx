'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  File, FilePlus, NotePencil, Terminal, MagnifyingGlass,
  Wrench, SpinnerGap, CheckCircle, XCircle, CaretDown,
  Brain, Eye, GitDiff, Check, X, ArrowSquareOut,
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

  // Handle abort/error results — show friendly message
  if (t.isError && t.result) {
    if (t.result.includes('aborted') || t.result.includes('abort')) {
      return fn ? `${fn} — 已中断` : `${t.name} — 已中断`;
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
    default: return t.name;
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

interface DiffInfo {
  filename: string; fullPath: string; mode: 'edit' | 'create';
  added: number; removed: number;
  beforeLines: string[]; afterLines: string[];
  moreB: number; moreA: number;
}

function extractDiff(t: ToolAction): DiffInfo | null {
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
  const { lines: bl, more: mb } = previewLines(old || '', 10);
  const { lines: al, more: ma } = previewLines(k === 'create' ? content : nw, 10);
  return {
    filename: p ? fname(p) : 'file', fullPath: p,
    mode: k === 'create' ? 'create' : 'edit',
    added, removed, beforeLines: bl, afterLines: al, moreB: mb, moreA: ma,
  };
}

// ─── Timeline segments ────────────────────────────────────────────────────────
// Simple approach: thinking always appears at the BOTTOM of the timeline,
// after all current tools. This way it naturally scrolls down with the flow
// and shows "what the agent is thinking right now" — not a historical dump.

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

  for (const t of tools) {
    segs.push({
      type: 'tool', tool: t,
      streamingOutput: t.id === lastRunningId ? streamingToolOutput : undefined,
    });
  }

  // Thinking goes AFTER all tools — it represents "what the agent is thinking NOW"
  const tc = (thinkingContent || '').trim();
  if (tc) {
    segs.push({ type: 'thinking', content: tc, streaming: isStreaming });
  }

  return segs;
}
// ─── UI Components ────────────────────────────────────────────────────────────

/** Inline thinking row — always expanded, real-time, never truncated */
function ThinkingRow({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
        {streaming
          ? <SpinnerGap size={11} className="animate-spin text-violet-400/60" />
          : <Brain size={11} className="text-violet-400/70" />}
      </div>
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap break-words">
        {!content && streaming && (
          <span className="text-violet-400/50">思考中…</span>
        )}
        {content}
        {streaming && content && (
          <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-sm bg-violet-400/40 align-middle" />
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

      {/* bash output — compact, right below the step */}
      {hasBashOutput && <BashBlock output={bashOutput} live={!!streamingOutput} />}

      {/* diff card — right below the edit/create step, even while running */}
      {showDiff && <DiffCard diff={diff} />}
    </div>
  );
}

/** Compact bash output */
function BashBlock({ output, live }: { output: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const { lines: ls, more } = previewLines(output, live ? 4 : 8);
  const preview = ls[0]?.slice(0, 60) || '';

  return (
    <div className="ml-[30px] mt-1 mb-1">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 rounded-md border border-border/25 bg-zinc-950/50 px-2.5 py-1.5 text-left font-mono text-[11px] text-zinc-400/70 hover:bg-zinc-950/70 transition-colors">
        <Terminal size={10} className="shrink-0 text-zinc-500/50" />
        <span className="flex-1 truncate">{preview}{output.length > 60 ? '…' : ''}</span>
        {live && <span className="inline-block h-2.5 w-1 animate-pulse rounded-sm bg-zinc-400/40" />}
        <CaretDown size={9} className={cn('shrink-0 text-zinc-500/40 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.12 }} style={{ overflow: 'hidden' }}>
            <div className="max-h-[120px] overflow-auto rounded-b-md border border-t-0 border-border/25 bg-zinc-950/50 px-2.5 py-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.6] text-zinc-400/60">
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
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/25 text-[11px]">
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

function CompletionBar({
  changedFiles, errCount, sessionId, rewindId,
}: {
  changedFiles: { tool: ToolAction; diff: DiffInfo }[];
  errCount: number;
  sessionId?: string;
  rewindId?: string;
}) {
  const [allAccepted, setAllAccepted] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const pending = changedFiles.length;

  const handleRewindAll = async () => {
    if (!sessionId || !rewindId) return;
    setRewinding(true);
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId: rewindId }),
      });
      if (!res.ok) throw new Error('failed');
      window.location.reload();
    } catch { setRewinding(false); }
  };

  if (pending === 0 && errCount === 0) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-[12px] text-emerald-600/80">
        <CheckCircle size={14} weight="fill" className="shrink-0" />
        <span>任务完成</span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {/* summary bar */}
      <div className="flex items-center gap-2.5 rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
        <CheckCircle size={14} weight="fill" className="shrink-0 text-emerald-500/70" />
        <span className="flex-1 text-[12px] text-foreground/80">
          任务完成
          {pending > 0 && <span className="ml-1.5 text-muted-foreground/60">· {pending} 个文件待审查</span>}
          {errCount > 0 && <span className="ml-1.5 text-red-500/60">· {errCount} 个错误</span>}
        </span>
      </div>

      {/* per-file review cards */}
      {pending > 0 && !allAccepted && (
        <div className="space-y-1.5">
          {changedFiles.map(({ tool: t, diff: d }, i) => (
            <FileReviewRow key={t.id || `fr-${i}`} diff={d} sessionId={sessionId} rewindId={rewindId} />
          ))}

          {/* batch actions */}
          {sessionId && rewindId && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAllAccepted(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-600/80 transition hover:bg-emerald-500/20">
                <Check size={12} weight="bold" /> 全部采纳
              </button>
              <button type="button" onClick={handleRewindAll} disabled={rewinding}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground/70 transition hover:bg-muted/30 disabled:opacity-50">
                {rewinding ? <SpinnerGap size={11} className="animate-spin" /> : <X size={12} weight="bold" />}
                全部撤销
              </button>
            </div>
          )}
        </div>
      )}

      {allAccepted && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-600/70">
          <CheckCircle size={13} weight="fill" /> 已采纳全部 {pending} 个文件变更
        </div>
      )}
    </div>
  );
}

/** Single file review row in completion section */
function FileReviewRow({ diff, sessionId, rewindId }: { diff: DiffInfo; sessionId?: string; rewindId?: string }) {
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected'>('pending');
  const [open, setOpen] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const handleRewind = async () => {
    if (!sessionId || !rewindId) return;
    setRewinding(true);
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId: rewindId }),
      });
      if (!res.ok) throw new Error('failed');
      window.location.reload();
    } catch { setRewinding(false); }
  };

  const openFile = () => {
    fetch('/api/open-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: diff.fullPath }),
    }).catch(() => {});
  };

  return (
    <div className={cn(
      'overflow-hidden rounded-lg border transition-colors',
      status === 'accepted' && 'border-emerald-500/30 bg-emerald-500/5',
      status === 'rejected' && 'border-red-500/25 bg-red-500/5 opacity-60',
      status === 'pending'  && 'border-border/30',
    )}>
      <div className="flex items-center gap-2 px-2.5 py-2 text-[11px]">
        <div className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
          diff.mode === 'create' ? 'bg-emerald-500/12' : 'bg-amber-500/12',
        )}>
          {diff.mode === 'create'
            ? <FilePlus size={11} className="text-emerald-500/70" />
            : <NotePencil size={11} className="text-amber-500/70" />}
        </div>
        <span className="flex-1 truncate font-mono text-foreground/70">{diff.filename}</span>
        {diff.added > 0 && <span className="text-emerald-500/65">+{diff.added}</span>}
        {diff.removed > 0 && <span className="text-red-400/55">-{diff.removed}</span>}

        {status === 'pending' && sessionId && rewindId && (
          <>
            <button type="button" onClick={() => setStatus('accepted')} title="采纳"
              className="flex h-5 w-5 items-center justify-center rounded-md border border-emerald-500/35 text-emerald-500/70 hover:bg-emerald-500/15 transition">
              <Check size={10} weight="bold" />
            </button>
            <button type="button" onClick={handleRewind} disabled={rewinding} title="撤销"
              className="flex h-5 w-5 items-center justify-center rounded-md border border-red-500/25 text-red-500/60 hover:bg-red-500/15 transition disabled:opacity-50">
              {rewinding ? <SpinnerGap size={9} className="animate-spin" /> : <X size={10} weight="bold" />}
            </button>
          </>
        )}
        {status === 'accepted' && <span className="text-emerald-500/60">已采纳</span>}
        {status === 'rejected' && <span className="text-red-500/50">已撤销</span>}

        <button type="button" onClick={() => { setOpen(v => !v); if (!open) stopScroll(); }}
          className="rounded px-1 text-muted-foreground/45 hover:text-muted-foreground/65 transition">
          <Eye size={10} />
        </button>
        {diff.fullPath && (
          <button type="button" onClick={openFile}
            className="rounded px-1 text-muted-foreground/45 hover:text-muted-foreground/65 transition">
            <ArrowSquareOut size={10} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/20 border-t border-border/20 text-[11px]">
              {diff.mode === 'edit' && (
                <div className="bg-red-500/[0.03] px-2.5 py-2">
                  <pre className="whitespace-pre-wrap break-all font-mono leading-[1.65] text-muted-foreground/50">
                    {diff.beforeLines.map((l, i) => <div key={i}><span className="mr-1 select-none text-red-400/30">−</span>{l}</div>)}
                    {diff.moreB > 0 && <div className="text-muted-foreground/25">… +{diff.moreB} lines</div>}
                  </pre>
                </div>
              )}
              <div className={cn('bg-emerald-500/[0.03] px-2.5 py-2', diff.mode === 'create' && 'md:col-span-2')}>
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
  flat: _flat = false,
  thinkingContent,
  statusText,
  sessionId,
  rewindUserMessageId,
}: ToolActionsGroupProps) {
  const segments = useMemo(
    () => buildSegments(tools, thinkingContent, isStreaming, streamingToolOutput),
    [tools, thinkingContent, isStreaming, streamingToolOutput],
  );

  const allDone = !isStreaming && tools.length > 0 && tools.every(t => t.result !== undefined);
  const errCount = tools.filter(t => t.isError).length;
  const changedFiles = useMemo(() => {
    return tools
      .map(t => ({ tool: t, diff: extractDiff(t) }))
      .filter((x): x is { tool: ToolAction; diff: DiffInfo } => x.diff !== null);
  }, [tools]);

  if (segments.length === 0) return null;

  return (
    <div className="py-1">
      {/* chronological timeline */}
      <div className="space-y-0">
        {segments.map((seg, i) => {
          if (seg.type === 'thinking') {
            return <ThinkingRow key={`think-${i}`} content={seg.content} streaming={seg.streaming} />;
          }
          return <ToolRow key={seg.tool.id || `tool-${i}`} tool={seg.tool} streamingOutput={seg.streamingOutput} />;
        })}
      </div>

      {/* streaming status — real-time "what's happening now" */}
      {isStreaming && (statusText || tools.some(t => t.result === undefined)) && (
        <div className="flex items-center gap-2 py-1.5 pl-[30px] text-[11px] text-muted-foreground/50">
          <SpinnerGap size={10} className="animate-spin text-blue-400/50" />
          <span className="truncate">
            {statusText || (() => {
              const running = tools.filter(t => t.result === undefined);
              if (running.length === 0) return '生成回复中…';
              return stepLabel(running[running.length - 1]) + '…';
            })()}
          </span>
        </div>
      )}

      {/* completion summary */}
      {allDone && (
        <CompletionBar
          changedFiles={changedFiles}
          errCount={errCount}
          sessionId={sessionId}
          rewindId={rewindUserMessageId}
        />
      )}
    </div>
  );
}
