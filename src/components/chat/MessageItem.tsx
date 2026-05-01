'use client';

import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import type { Message, TokenUsage, FileAttachment, MediaBlock, SubAgentInfo } from '@/types';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup, CompletionBar, extractDiff } from '@/components/ai-elements/tool-actions-group';
import { MediaPreview } from './MediaPreview';
import { SubAgentStatusBar } from './SubAgentStatusBar';
import { Button } from "@/components/ui/button";
import { Copy, Check, CheckCircle, CaretDown, CaretUp, CaretRight, NotePencil, PushPin, DownloadSimple, ArrowsCounterClockwise, XCircle, PauseCircle } from "@/components/ui/icon";
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { ImageGenConfirmation } from './ImageGenConfirmation';
import { ImageGenCard } from './ImageGenCard';
import { BatchPlanInlinePreview } from './batch-image-gen/BatchPlanInlinePreview';
import { WidgetRenderer } from './WidgetRenderer';
import { buildReferenceImages } from '@/lib/image-ref-store';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, RARITY_BG_GRADIENT, type Species, type Rarity } from '@/lib/buddy';
import { parseDBDate } from '@/lib/utils';
import { usePanel } from '@/hooks/usePanel';
import { extractTimelineStepsFromBlocks } from '@/lib/agent-timeline';
import { ReferencedContexts } from '@/components/chat/ReferencedContexts';
import type { PlannerOutput, MessageContentBlock } from '@/types';

interface ImageGenRequest {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  model?: string;
  referenceImages?: string[];
  useLastGenerated?: boolean;
}

function parseImageGenRequest(text: string): { beforeText: string; request: ImageGenRequest; afterText: string; rawBlock: string } | null {
  const regex = /```image-gen-request\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    let raw = match[1].trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      // Attempt to fix common model output issues: unescaped quotes in values
      raw = raw.replace(/"prompt"\s*:\s*"([\s\S]*?)"\s*([,}])/g, (_m, val, tail) => {
        const escaped = val.replace(/(?<!\\)"/g, '\\"');
        return `"prompt": "${escaped}"${tail}`;
      });
      json = JSON.parse(raw);
    }
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      request: {
        prompt: String(json.prompt || ''),
        aspectRatio: String(json.aspectRatio || '1:1'),
        resolution: String(json.resolution || '1K'),
        model: json.model ? String(json.model) : undefined,
        referenceImages: Array.isArray(json.referenceImages) ? json.referenceImages : undefined,
        useLastGenerated: json.useLastGenerated === true,
      },
      afterText,
      rawBlock: match[0],
    };
  } catch {
    return null;
  }
}

interface ImageGenResultData {
  status: 'generating' | 'completed' | 'error';
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  images?: Array<{ mimeType: string; localPath?: string; data?: string }>;
  error?: string;
}

function parseImageGenResult(text: string): { beforeText: string; result: ImageGenResultData; afterText: string } | null {
  const regex = /```image-gen-result\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      result: {
        status: json.status || 'completed',
        prompt: String(json.prompt || ''),
        aspectRatio: json.aspectRatio,
        resolution: json.resolution,
        model: json.model,
        images: Array.isArray(json.images) ? json.images : undefined,
        error: json.error,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

function parseBatchPlan(text: string): { beforeText: string; plan: PlannerOutput; afterText: string } | null {
  const regex = /```batch-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      plan: {
        summary: json.summary || '',
        items: Array.isArray(json.items) ? json.items.map((item: Record<string, unknown>) => ({
          prompt: String(item.prompt || ''),
          aspectRatio: String(item.aspectRatio || '1:1'),
          resolution: String(item.resolution || '1K'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        })) : [],
      },
      afterText,
    };
  } catch {
    return null;
  }
}

interface ShowWidgetData {
  title?: string;
  widget_code: string;
}

export function parseShowWidget(text: string): { beforeText: string; widget: ShowWidgetData; afterText: string } | null {
  const segments = parseAllShowWidgets(text);
  if (segments.length === 0) return null;
  // Legacy compat: return first widget match
  let beforeText = '';
  let widget: ShowWidgetData | null = null;
  const afterParts: string[] = [];
  let foundWidget = false;
  for (const seg of segments) {
    if (!foundWidget) {
      if (seg.type === 'text') { beforeText = seg.content; }
      else { widget = seg.data; foundWidget = true; }
    } else {
      if (seg.type === 'text') afterParts.push(seg.content);
      else afterParts.push(''); // subsequent widgets handled by parseAllShowWidgets
    }
  }
  if (!widget) return null;
  return { beforeText, widget, afterText: afterParts.join('\n') };
}

export type WidgetSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; data: ShowWidgetData };

/**
 * Fence-format-agnostic widget parser.
 *
 * Models produce many fence variants (```show-widget, `show-widget`, `show-widget\n...\n`, etc.).
 * Instead of normalizing each variant, we directly scan for "show-widget" markers followed by
 * JSON containing "widget_code", regardless of surrounding backtick syntax.
 */

/** Find the end of a JSON object starting at `{`, accounting for nested braces and strings. */
function findJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1; // unclosed
}

/** Parse ALL show-widget blocks in text, returning alternating text/widget segments. */
export function parseAllShowWidgets(text: string): WidgetSegment[] {
  const segments: WidgetSegment[] = [];
  // Match any backtick(s) + show-widget, capturing the full marker to strip it
  const markerRegex = /`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let foundAny = false;

  while ((match = markerRegex.exec(text)) !== null) {
    const afterMarker = match.index + match[0].length;
    // Find the JSON object start
    const jsonStart = text.indexOf('{', afterMarker);
    if (jsonStart === -1 || jsonStart > afterMarker + 20) {
      // No JSON nearby — skip this malformed marker, advance past any fence block
      const fenceClose = text.indexOf('```', afterMarker);
      if (fenceClose !== -1 && fenceClose < afterMarker + 200) {
        lastIndex = fenceClose + 3;
        markerRegex.lastIndex = fenceClose + 3;
        foundAny = true; // so trailing text is captured
      }
      continue;
    }

    const jsonEnd = findJsonEnd(text, jsonStart);
    if (jsonEnd === -1) {
      // Truncated JSON — try extracting partial widget
      const partialBody = text.slice(jsonStart);
      const widget = extractTruncatedWidget(partialBody);
      if (widget) {
        foundAny = true;
        const before = text.slice(lastIndex, match.index).trim();
        if (before) segments.push({ type: 'text', content: before });
        segments.push({ type: 'widget', data: widget });
        lastIndex = text.length;
      }
      break;
    }

    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      const json = JSON.parse(jsonStr);
      if (json.widget_code) {
        foundAny = true;
        const before = text.slice(lastIndex, match.index).trim();
        if (before) segments.push({ type: 'text', content: before });
        segments.push({ type: 'widget', data: { title: json.title || undefined, widget_code: String(json.widget_code) } });
        // Skip past the JSON and any trailing fence/backticks
        let endPos = jsonEnd + 1;
        const trailing = text.slice(endPos, endPos + 10);
        const trailingFence = trailing.match(/^\s*\n?`{1,3}\s*/);
        if (trailingFence) endPos += trailingFence[0].length;
        lastIndex = endPos;
        markerRegex.lastIndex = endPos;
      }
    } catch {
      // Malformed JSON — skip past the fence block
      const fenceClose = text.indexOf('```', jsonStart);
      if (fenceClose !== -1) {
        markerRegex.lastIndex = fenceClose + 3;
        lastIndex = fenceClose + 3;
        foundAny = true; // Mark as found so trailing text is captured
      }
    }
  }

  if (!foundAny) return [];

  // Remaining text after last widget
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    segments.push({ type: 'text', content: remaining });
  }

  return segments;
}

/**
 * Compute the React key for a partial (still-streaming) widget so that it
 * matches the key it will receive once its fence closes and the full content
 * is parsed by parseAllShowWidgets → `.map((seg, i) => key={`w-${i}`})`.
 *
 * If these keys ever diverge, React will unmount + remount the WidgetRenderer
 * → iframe destroyed → height collapse → scroll jump (P2 regression).
 */
export function computePartialWidgetKey(content: string): string {
  const markers = [...content.matchAll(/`{1,3}show-widget/g)];
  if (markers.length === 0) return 'w-0';
  const lastMarker = markers[markers.length - 1];
  const beforePart = content.slice(0, lastMarker.index).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
  return `w-${hasCompletedFences ? completedSegments.length : (beforePart ? 1 : 0)}`;
}

/** Extract widget_code from truncated/incomplete JSON (no closing fence). */
function extractTruncatedWidget(fenceBody: string): ShowWidgetData | null {
  // Try full JSON parse first
  try {
    const json = JSON.parse(fenceBody);
    if (json.widget_code) return { title: json.title || undefined, widget_code: String(json.widget_code) };
  } catch { /* expected — JSON is truncated */ }

  // String-search extraction
  const keyIdx = fenceBody.indexOf('"widget_code"');
  if (keyIdx === -1) return null;
  const colonIdx = fenceBody.indexOf(':', keyIdx + 13);
  if (colonIdx === -1) return null;
  const quoteIdx = fenceBody.indexOf('"', colonIdx + 1);
  if (quoteIdx === -1) return null;

  let raw = fenceBody.slice(quoteIdx + 1);
  raw = raw.replace(/"\s*\}\s*$/, '');
  if (raw.endsWith('\\')) raw = raw.slice(0, -1);
  try {
    const widgetCode = raw
      .replace(/\\\\/g, '\x00BACKSLASH\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\x00BACKSLASH\x00/g, '\\');
    if (widgetCode.length < 10) return null;

    let title: string | undefined;
    const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
    if (titleMatch) title = titleMatch[1];
    return { title, widget_code: widgetCode };
  } catch {
    return null;
  }
}

interface MessageItemProps {
  message: Message;
  sessionId?: string;
  rewindUserMessageId?: string;
  /** Whether this is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Assistant name for avatar */
  assistantName?: string;
}

interface ToolBlock {
  type: 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

function parseToolBlocks(content: string): { text: string; tools: ToolBlock[]; thinking?: string } {
  const tools: ToolBlock[] = [];
  let text = '';
  let thinking: string | undefined;

  // Try to parse as JSON array (new format from chat API)
  if (content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content) as Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: string;
        is_error?: boolean;
      }>;

      for (const block of blocks) {
        if (block.type === 'thinking' && block.thinking) {
          thinking = block.thinking;
        } else if (block.type === 'text' && block.text) {
          text += block.text;
        } else if (block.type === 'tool_use') {
          tools.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          tools.push({
            type: 'tool_result',
            id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
            media: (block as { media?: MediaBlock[] }).media,
          });
        }
      }

      return { text: text.trim(), tools, thinking };
    } catch {
      // Not valid JSON, fall through to legacy parsing
    }
  }

  // Legacy format: HTML comments
  text = content;
  const toolUseRegex = /<!--tool_use:([\s\S]*?)-->/g;
  let match;
  while ((match = toolUseRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_use', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  const toolResultRegex = /<!--tool_result:([\s\S]*?)-->/g;
  while ((match = toolResultRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_result', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  return { text: text.trim(), tools };
}

function pairTools(tools: ToolBlock[]): Array<{
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  media?: MediaBlock[];
}> {
  const paired: Array<{
    name: string;
    input: unknown;
    result?: string;
    isError?: boolean;
    media?: MediaBlock[];
  }> = [];

  const resultMap = new Map<string, ToolBlock>();
  for (const t of tools) {
    if (t.type === 'tool_result' && t.id) {
      resultMap.set(t.id, t);
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_use' && t.name) {
      const result = t.id ? resultMap.get(t.id) : undefined;
      paired.push({
        name: t.name,
        input: t.input,
        result: result?.content,
        isError: result?.is_error,
        media: result?.media,
      });
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_result' && !tools.some(u => u.type === 'tool_use' && u.id === t.id)) {
      paired.push({
        name: 'tool_result',
        input: {},
        result: t.content,
        isError: t.is_error,
        media: t.media,
      });
    }
  }

  return paired;
}

function parseMessageFiles(content: string): { files: FileAttachment[]; text: string } {
  const match = content.match(/^<!--files:(.*?)-->\n?/);
  if (!match) return { files: [], text: content };
  try {
    const files = JSON.parse(match[1]);
    const text = content.slice(match[0].length);
    return { files, text };
  } catch {
    return { files: [], text: content };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground h-auto"
      title="Copy"
    >
      {copied ? (
        <Check size={12} className="text-status-success-foreground" />
      ) : (
        <Copy size={12} />
      )}
    </Button>
  );
}

function TokenUsageDisplay({ usage }: { usage: TokenUsage }) {
  const totalTokens = usage.input_tokens + usage.output_tokens;
  const costStr = usage.cost_usd !== undefined && usage.cost_usd !== null
    ? ` · $${usage.cost_usd.toFixed(4)}`
    : '';

  return (
    <span className="group/tokens relative cursor-default text-xs text-muted-foreground/50">
      <span>{totalTokens.toLocaleString()} tokens{costStr}</span>
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 opacity-0 group-hover/tokens:opacity-100 transition-opacity duration-150 z-50">
        In: {usage.input_tokens.toLocaleString()} · Out: {usage.output_tokens.toLocaleString()}
        {usage.cache_read_input_tokens ? ` · Cache: ${usage.cache_read_input_tokens.toLocaleString()}` : ''}
        {costStr}
      </span>
    </span>
  );
}

const COLLAPSE_HEIGHT = 300;

// ---------------------------------------------------------------------------
// Diff summary — shows modified files after assistant turn
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export const MessageItem = memo(function MessageItem({ message, sessionId, rewindUserMessageId, isAssistantProject, assistantName }: MessageItemProps) {
  const isUser = message.role === 'user';

  // Collapse/expand state for long user messages (hooks must be called unconditionally)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const referencedFiles = useMemo(() => {
    if (!message.referenced_contexts) return [];
    try {
      return JSON.parse(message.referenced_contexts) as string[];
    } catch {
      return [];
    }
  }, [message.referenced_contexts]);

  // Use blocks directly for sequential rendering instead of grouping
  const contentBlocks = useMemo<MessageContentBlock[]>(() => {
    try {
      const parsed = JSON.parse(message.content);
      if (Array.isArray(parsed)) return parsed as MessageContentBlock[];
    } catch {
      // Not JSON
    }
    // Fallback to legacy parsing if not JSON array
    const { text, tools, thinking } = parseToolBlocks(message.content);
    const blocks: MessageContentBlock[] = [];
    if (thinking) blocks.push({ type: 'thinking', thinking });
    if (text) blocks.push({ type: 'text', text });
    tools.forEach(t => {
      if (t.type === 'tool_use') {
        if (t.id && t.name) {
          blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
        }
      } else if (t.id && typeof t.content === 'string') {
        blocks.push({ type: 'tool_result', tool_use_id: t.id, content: t.content, is_error: t.is_error, media: t.media });
      }
    });
    return blocks;
  }, [message.content]);

  const timelineSteps = useMemo(() => {
    return isUser ? [] : extractTimelineStepsFromBlocks(contentBlocks);
  }, [contentBlocks, isUser]);

  const timelineCompletionInfo = useMemo(() => {
    if (isUser || timelineSteps.length === 0) return null;
    const changedFiles = timelineSteps.flatMap((step) => (step.fileChanges || []).map((change, index) => ({
      tool: {
        id: `${step.id}-${index}`,
        name: change.operation === 'create' ? 'write' : 'edit',
        input: { path: change.path },
        result: undefined,
        isError: false,
      },
      diff: {
        filename: change.fileName,
        fullPath: change.path,
        mode: change.operation,
        added: change.addedLines,
        removed: change.removedLines,
        beforeLines: change.beforeText ? change.beforeText.replace(/\r\n/g, '\n').split('\n').slice(0, 1000) : [],
        afterLines: change.afterText ? change.afterText.replace(/\r\n/g, '\n').split('\n').slice(0, 1000) : [],
        moreB: Math.max(0, (change.beforeText ? change.beforeText.replace(/\r\n/g, '\n').split('\n').length : 0) - 1000),
        moreA: Math.max(0, (change.afterText ? change.afterText.replace(/\r\n/g, '\n').split('\n').length : 0) - 1000),
      },
    })));

    // Merge duplicate file edit statistics
    const mergedFiles = new Map<string, typeof changedFiles[0]>();
    changedFiles.forEach((item) => {
      const path = item.diff.fullPath;
      if (mergedFiles.has(path)) {
        const existing = mergedFiles.get(path)!;
        existing.diff.added += item.diff.added;
        existing.diff.removed += item.diff.removed;
      } else {
        mergedFiles.set(path, { tool: item.tool, diff: { ...item.diff } });
      }
    });
    
    const finalChangedFiles = Array.from(mergedFiles.values());
    const errCount = timelineSteps.filter((step) => step.status === 'failed' || step.error).length;
    return finalChangedFiles.length > 0 ? { errCount, changedFiles: finalChangedFiles } : null;
  }, [isUser, timelineSteps]);

  const taskCompletionInfo = useMemo(() => {
    if (isUser || timelineSteps.length === 0) return null;
    try {
      // Determine task status by checking for chat-error text blocks in message content
      let status: 'completed' | 'interrupted' | 'failed' = 'completed';
      try {
        const blocks = JSON.parse(message.content) as MessageContentBlock[];
        for (const block of blocks) {
          if (block.type === 'text' && 'text' in block) {
            const chatErrorMatch = (block.text as string).match(/```chat-error\n(\{.*?\})\n```/s);
            if (chatErrorMatch) {
              try {
                const errPayload = JSON.parse(chatErrorMatch[1]);
                if (errPayload.raw === 'Task stopped by user') {
                  status = 'interrupted';
                } else {
                  status = 'failed';
                }
              } catch {
                status = 'failed';
              }
              break;
            }
          }
        }
      } catch {
        // content parse failed, assume completed
      }

      // If the backend has recorded duration_sec in token_usage, use it
      const usageStr = message.token_usage;
      if (usageStr) {
        const usageObj = JSON.parse(usageStr);
        if (typeof usageObj.duration_sec === 'number' && usageObj.duration_sec >= 0) {
          return { durationSec: usageObj.duration_sec, status };
        }
      }

      // Fallback for older messages
      const endStr = (message as any).updated_at || message.created_at;
      const start = parseDBDate(message.created_at).getTime();
      const end = parseDBDate(endStr).getTime();
      const durationSec = Math.max(0, Math.floor((end - start) / 1000));
      return { durationSec, status };
    } catch {
      return null;
    }
  }, [isUser, message, timelineSteps.length]);

  // Memoize expensive parsing: parseToolBlocks + pairTools
  const { pairedTools, thinking } = useMemo(() => {
    const { tools, thinking } = parseToolBlocks(message.content);
    const pairedTools = pairTools(tools);
    return { pairedTools, thinking };
  }, [message.content]);

  // Compute completion summary for assistant messages
  const completionInfo = useMemo(() => {
    if (isUser || pairedTools.length === 0) return null;
    const mappedTools = pairedTools.map((tool, i) => ({
      id: `hist-${i}`,
      name: tool.name,
      input: tool.input,
      result: tool.result,
      isError: tool.isError,
      media: tool.media,
    }));
    const errCount = mappedTools.filter(t => t.isError).length;
    const changedFiles = mappedTools
      .map(t => ({ tool: t as any, diff: extractDiff(t as any) }))
      .filter((x): x is { tool: any; diff: NonNullable<ReturnType<typeof extractDiff>> } => x.diff !== null);
    
    // Merge duplicate file edit statistics
    const mergedFiles = new Map<string, typeof changedFiles[0]>();
    changedFiles.forEach((item) => {
      const path = item.diff.fullPath;
      if (mergedFiles.has(path)) {
        const existing = mergedFiles.get(path)!;
        existing.diff.added += item.diff.added;
        existing.diff.removed += item.diff.removed;
      } else {
        mergedFiles.set(path, { tool: item.tool, diff: { ...item.diff } });
      }
    });

    const finalChangedFiles = Array.from(mergedFiles.values());
    return finalChangedFiles.length > 0 || errCount > 0 ? { errCount, changedFiles: finalChangedFiles } : null;
  }, [isUser, pairedTools]);

  // Memoize file attachment parsing for the FIRST text block of a user message
  const { files, displayText } = useMemo(() => {
    if (isUser) {
      const firstText = contentBlocks.find(b => b.type === 'text')?.text || '';
      const { files, text: textWithoutFiles } = parseMessageFiles(firstText);
      return { files, displayText: textWithoutFiles };
    }
    
    const textBlocks = contentBlocks.filter((block, i): block is Extract<MessageContentBlock, { type: 'text' }> => {
      if (block.type !== 'text') return false;
      // 仅保留后续没有工具调用（tool_use 或 tool_result）的文本作为最终结论
      const hasSubsequentTool = contentBlocks.slice(i + 1).some(b => b.type === 'tool_use' || b.type === 'tool_result');
      return !hasSubsequentTool;
    });
    let finalOutputText = textBlocks.map(b => b.text).join('\n');
    
    // Always strip soft-heartbeat marker before rendering text blocks
    finalOutputText = finalOutputText.replace(/\s*<!--\s*heartbeat-done\s*-->\s*/g, '').trim();
    
    return { files: [] as FileAttachment[], displayText: finalOutputText };
  }, [contentBlocks, isUser]);

  useEffect(() => {
    if (isUser && contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > COLLAPSE_HEIGHT);
    }
  }, [isUser, displayText]);

  // Memoize token usage JSON parsing
  const tokenUsage = useMemo<TokenUsage | null>(() => {
    if (!message.token_usage) return null;
    try {
      return JSON.parse(message.token_usage);
    } catch {
      return null;
    }
  }, [message.token_usage]);

  // Hide image-gen system notices — they exist in DB for Claude's context but shouldn't render
  if (isUser && message.content.startsWith('[__IMAGE_GEN_NOTICE__')) {
    return null;
  }

  // Handle temporary compacting message styling
  const isCompactingMsg = !isUser && message.content === '上下文压缩中...';

  const timestamp = parseDBDate(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const subAgents = useMemo(() => {
    if (isUser) return null;
    try {
      const parsed = JSON.parse(message.content);
      if (Array.isArray(parsed)) {
        const subAgentsBlock = parsed.find(b => b.type === 'sub_agents');
        if (subAgentsBlock?.subAgents?.length) return subAgentsBlock.subAgents;

        // 中文注释：功能名称「子Agent回退提取」，用法是当消息中没有sub_agents块时，
        // 从Agent/Team tool_use和tool_result对中提取子Agent信息，确保会话切换后卡片仍能渲染
        const isAgenticTool = (name: string) => {
          const lower = name.toLowerCase();
          return lower === 'agent' || lower === 'team' || lower === 'task' || lower.includes('mcp__codepilot-agent__') || lower.includes('mcp__codepilot-team__');
        };
        const toolUseBlocks = parsed.filter(b => b.type === 'tool_use' && isAgenticTool(b.name));
        if (toolUseBlocks.length > 0) {
          const toolResultMap = new Map<string, { content: string; isError?: boolean }>();
          parsed.filter(b => b.type === 'tool_result').forEach(b => {
            if (b.tool_use_id) toolResultMap.set(b.tool_use_id, { content: b.content || '', isError: b.is_error });
          });
          return toolUseBlocks.map((block, i) => {
            const input = block.input || {};
            const result = toolResultMap.get(block.id);
            // 中文注释：功能名称「Agent输入解析」，用法是同时兼容Agent/Team与原生Task工具，
            // 优先使用agent/subagent_type/name字段，避免回退到block.id产生乱码或丢失Explore等身份
            const agentId = input.agentId || input.agent_id || input.agent || input.subagent_type || input.task_type || 'general';
            const prompt = input.prompt || input.task || input.description || '';
            const displayName = input.displayName || input.display_name || input.name || agentId;
            // 中文注释：功能名称「空智能体过滤」，用法是跳过没有prompt的Agent工具调用，
            // 避免产生无任务的空智能体卡片
            if (!prompt.trim()) return null;
            const report = result && !result.isError
              ? (typeof result.content === 'string' ? result.content.slice(0, 500) : String(result.content).slice(0, 500))
              : undefined;
            const error = result?.isError
              ? (typeof result.content === 'string' ? result.content.slice(0, 500) : String(result.content).slice(0, 500))
              : undefined;
            return {
              id: `subagent-${agentId}-${i}`,
              name: agentId,
              displayName,
              prompt: prompt.length > 200 ? prompt.slice(0, 197) + '...' : prompt,
              model: input.model,
              source: 'sdk_agent_tool',
              status: result ? (result.isError ? 'error' : 'completed') : 'running' as const,
              report,
              error,
              startedAt: Date.now() - (toolUseBlocks.length - i) * 1000,
              ...(result ? { completedAt: Date.now() - (toolUseBlocks.length - i - 1) * 1000 } : {}),
            };
          }).filter(Boolean) as SubAgentInfo[];
        }
      }
    } catch {
      // not JSON
    }
    return null;
  }, [message.content, isUser]);

  // 子Agent状态条使用 SubAgentStatusBar，不再过滤 agent/team 工具，全部交给时间线渲染
  const timelineTools = pairedTools;

  const showAssistantAvatar = !isUser && isAssistantProject;
  const buddyInfo = isAssistantProject ? (globalThis as Record<string, unknown>).__codepilot_buddy_info__ as { emoji?: string; species?: string; rarity?: string } | undefined : undefined;

  if (isCompactingMsg) {
    return (
      <div className="flex items-center gap-3 py-2 px-1 text-[13px] text-violet-500 font-medium justify-center border-y border-border/40 my-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
        </span>
        上下文压缩中...
      </div>
    );
  }

  return (
    <div className={showAssistantAvatar ? 'flex gap-2.5 items-start' : ''}>
      {showAssistantAvatar && (
        buddyInfo?.species
          ? <img
              src={SPECIES_IMAGE_URL[buddyInfo.species as Species] || ''}
              alt="" width={28} height={28}
              className="mt-0.5 shrink-0 rounded-lg"
              style={{ background: RARITY_BG_GRADIENT[buddyInfo.rarity as Rarity] || '' }}
            />
          : <img src={EGG_IMAGE_URL} alt="egg" width={28} height={28} className="mt-0.5 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
    <div className="flex flex-col gap-2 relative group w-full">
      {/* File attachments for user messages (outside the bubble) */}
      {isUser && files.length > 0 && (
        <div className="flex justify-end pr-2.5">
          <FileAttachmentDisplay files={files} />
        </div>
      )}
      <AIMessage from={isUser ? 'user' : 'assistant'}>
        <MessageContent>
          {/* Referenced Contexts (Rule tags) */}
          {!isUser && referencedFiles.length > 0 && (
            <ReferencedContexts files={referencedFiles} isStreaming={false} />
          )}

        {/* Render the timeline (tools and thoughts interleaved) */}
        {!isUser && (timelineTools.length > 0 || timelineSteps.length > 0) && (
          <>
            <ToolActionsGroup
              tools={timelineTools.map((tool, i) => ({
                id: `hist-${i}`,
                name: tool.name,
                input: tool.input,
                result: tool.result,
                isError: tool.isError,
                media: tool.media,
              }))}
              steps={timelineSteps}
              sessionId={sessionId}
              rewindUserMessageId={rewindUserMessageId}
              flat={true}
              hideSubAgents={false}
            />
          </>
        )}

        {/* Media from tool results — rendered outside tool group so images stay visible */}
        {!isUser && (() => {
          const allMedia = pairedTools.flatMap(t => t.media || []);
          return allMedia.length > 0 ? <MediaPreview media={allMedia} /> : null;
        })()}

        {/* 子Agent状态条 - 会话切换后从消息内容中恢复 */}
        {!isUser && subAgents && subAgents.length > 0 && (
          <SubAgentStatusBar subAgents={subAgents} />
        )}

        {/* Text content */}
        {displayText && (
          isUser ? (
            <div className="relative">
              <div
                ref={contentRef}
                className="text-sm whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-in-out overflow-hidden"
                style={
                  isOverflowing && !isExpanded
                    ? { maxHeight: `${COLLAPSE_HEIGHT}px` }
                    : undefined
                }
              >
                {displayText}
              </div>
              {isOverflowing && !isExpanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-secondary to-transparent pointer-events-none" />
              )}
              {isOverflowing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="relative z-10 flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground h-auto px-1 py-0.5"
                >
                  {isExpanded ? (
                    <>
                      <CaretUp size={12} />
                      <span>收起</span>
                    </>
                  ) : (
                    <>
                      <CaretDown size={12} />
                      <span>展开</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <AssistantContent displayText={displayText} messageId={message.id} sessionId={sessionId} />
          )
        )}



        {!isUser && taskCompletionInfo && (
          <div className="flex items-center gap-2 mt-3 mb-2 text-[12px] text-muted-foreground">
            {taskCompletionInfo.status === 'completed' && (
              <div className="flex items-center gap-1.5 text-emerald-500 font-medium">
                <CheckCircle size={14} weight="fill" />
                <span>任务完成</span>
              </div>
            )}
            {taskCompletionInfo.status === 'interrupted' && (
              <div className="flex items-center gap-1.5 text-amber-500 font-medium">
                <PauseCircle size={14} weight="fill" />
                <span>任务中断</span>
              </div>
            )}
            {taskCompletionInfo.status === 'failed' && (
              <div className="flex items-center gap-1.5 text-red-500 font-medium">
                <XCircle size={14} weight="fill" />
                <span>任务异常</span>
              </div>
            )}
            <span className="text-border">|</span>
            <span>任务耗时 {formatDuration(taskCompletionInfo.durationSec)}</span>
          </div>
        )}

        {/* Completion Bar rendered only once at the end of the message */}
        {!isUser && timelineSteps.length === 0 && completionInfo && completionInfo.changedFiles.length > 0 && (
          <CompletionBar
            changedFiles={completionInfo.changedFiles}
            errCount={completionInfo.errCount}
            sessionId={sessionId}
            rewindId={rewindUserMessageId}
          />
        )}
        {!isUser && timelineSteps.length > 0 && timelineCompletionInfo && (
          <CompletionBar
            changedFiles={timelineCompletionInfo.changedFiles}
            errCount={timelineCompletionInfo.errCount}
            sessionId={sessionId}
            rewindId={rewindUserMessageId}
          />
        )}
      </MessageContent>

      {/* Footer with copy, timestamp and token usage */}
      <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}>
        {!isUser && <span className="text-xs text-muted-foreground/50">{timestamp}</span>}
        {!isUser && tokenUsage && <TokenUsageDisplay usage={tokenUsage} />}
        {displayText && <CopyButton text={displayText} />}
      </div>
    </AIMessage>
      </div>
      </div>
    </div>
  );
});

/** Widget wrapper with "Pin to Dashboard" button.
 * Pin triggers a chat message → AI uses codepilot_dashboard_pin MCP tool.
 * Button is a pure trigger — no local pin/unpin state tracking.
 * Brief cooldown prevents double-click. */
function PinnableWidget({ widgetCode, title }: {
  widgetCode: string; title?: string; messageId: string; sessionId?: string;
}) {
  const [cooldown, setCooldown] = useState(false);
  const { workingDirectory } = usePanel();

  const handlePin = useCallback(() => {
    if (cooldown || !workingDirectory) return;
    setCooldown(true);
    window.dispatchEvent(new CustomEvent('widget-pin-request', {
      detail: { widgetCode, title: title || 'Untitled Widget' },
    }));
    // 5s cooldown to prevent rapid duplicate pins
    setTimeout(() => setCooldown(false), 5000);
  }, [cooldown, workingDirectory, widgetCode, title]);

  const handleExport = useCallback(async () => {
    try {
      const { exportWidgetAsImage, downloadBlob } = await import('@/lib/dashboard-export');
      const blob = await exportWidgetAsImage(widgetCode);
      downloadBlob(blob, `${(title || 'widget').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.png`);
    } catch (e) {
      console.error('[PinnableWidget] Export failed:', e);
    }
  }, [widgetCode, title]);

  const buttons = (
    <>
      {workingDirectory && (
        <button
          className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 disabled:opacity-30 flex items-center gap-0.5"
          onClick={handlePin}
          disabled={cooldown}
        >
          <PushPin size={12} />
          Pin
        </button>
      )}
      <button
        className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 flex items-center gap-0.5"
        onClick={handleExport}
      >
        <DownloadSimple size={12} />
      </button>
    </>
  );

  return (
    <WidgetRenderer widgetCode={widgetCode} isStreaming={false} title={title} extraButtons={buttons} />
  );
}

function parseChatError(text: string): { beforeText: string; error: { explain: string; raw: string }; afterText: string } | null {
  const regex = /```chat-error\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return { beforeText, error: json, afterText };
  } catch {
    return null;
  }
}

/**
 * Memoized assistant message content — avoids re-running parseBatchPlan / parseImageGenResult /
 * parseImageGenRequest on every render when only unrelated props change.
 */
const AssistantContent = memo(function AssistantContent({ displayText, messageId, sessionId }: { displayText: string; messageId: string; sessionId?: string }) {
  return useMemo(() => {
    // Try show-widget first (Generative UI) — supports multiple widgets interleaved with text
    const widgetSegments = parseAllShowWidgets(displayText);
    if (widgetSegments.length > 0) {
      return (
        <>
          {widgetSegments.map((seg, i) =>
            seg.type === 'text'
              ? <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
              : <PinnableWidget key={`w-${i}`} widgetCode={seg.data.widget_code} title={seg.data.title} messageId={messageId} sessionId={sessionId} />
          )}
        </>
      );
    }

    // Try batch-plan (Image Agent batch mode)
    const batchPlanResult = parseBatchPlan(displayText);
    if (batchPlanResult) {
      return (
        <>
          {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
          <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId={messageId} />
          {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
        </>
      );
    }

    const chatErrorResult = parseChatError(displayText);
    if (chatErrorResult) {
      const handleRetry = () => {
        window.dispatchEvent(new CustomEvent('chat-retry', { detail: { messageId } }));
      };
      return (
        <>
          {chatErrorResult.beforeText && <MessageResponse>{chatErrorResult.beforeText}</MessageResponse>}
          <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3 mt-2 mb-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-status-error-foreground">{chatErrorResult.error.explain}</p>
                <button
                  onClick={handleRetry}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:underline flex items-center gap-1"
                >
                  <ArrowsCounterClockwise size={12} />
                  重新发起请求
                </button>
              </div>
              <div className="text-xs text-muted-foreground bg-black/5 dark:bg-white/5 p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                {chatErrorResult.error.raw}
              </div>
            </div>
          </div>
          {chatErrorResult.afterText && <MessageResponse>{chatErrorResult.afterText}</MessageResponse>}
        </>
      );
    }

    // Try image-gen-result first (new direct-call format)
    const genResult = parseImageGenResult(displayText);
    if (genResult) {
      const { result } = genResult;
      const handleRetry = () => {
        window.dispatchEvent(new CustomEvent('chat-retry', { detail: { messageId } }));
      };

      if (result.status === 'generating') {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <div className="flex items-center gap-2 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm text-muted-foreground">Generating image...</span>
            </div>
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
      if (result.status === 'error') {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-status-error-foreground flex-1">{result.error || 'Image generation failed'}</p>
                <button
                  onClick={handleRetry}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:underline flex items-center gap-1"
                >
                  <ArrowsCounterClockwise size={12} />
                  点击重试
                </button>
              </div>
            </div>
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
      if (result.status === 'completed' && result.images && result.images.length > 0) {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <ImageGenCard
              images={result.images.map(img => ({
                data: img.data || '',
                mimeType: img.mimeType,
                localPath: img.localPath,
              }))}
              prompt={result.prompt}
              aspectRatio={result.aspectRatio}
              imageSize={result.resolution}
              model={result.model}
            />
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
    }

    // Legacy: image-gen-request (model-dependent format, for old messages)
    const parsed = parseImageGenRequest(displayText);
    if (parsed) {
      const refs = buildReferenceImages(
        messageId,
        sessionId || '',
        parsed.request.useLastGenerated || false,
        parsed.request.referenceImages,
      );
      return (
        <>
          {parsed.beforeText && <MessageResponse>{parsed.beforeText}</MessageResponse>}
          <ImageGenConfirmation
            messageId={messageId}
            sessionId={sessionId}
            initialPrompt={parsed.request.prompt}
            initialAspectRatio={parsed.request.aspectRatio}
            initialResolution={parsed.request.resolution}
            initialModel={parsed.request.model}
            rawRequestBlock={parsed.rawBlock}
            referenceImages={refs.length > 0 ? refs : undefined}
          />
          {parsed.afterText && <MessageResponse>{parsed.afterText}</MessageResponse>}
        </>
      );
    }
    const stripped = displayText
      .replace(/```image-gen-request[\s\S]*?```/g, '')
      .replace(/```image-gen-result[\s\S]*?```/g, '')
      .replace(/```batch-plan[\s\S]*?```/g, '')
      .replace(/```show-widget[\s\S]*?(```|$)/g, '')
      .replace(/```chat-error[\s\S]*?(```|$)/g, '')
      .trim();
    return stripped ? <MessageResponse>{stripped}</MessageResponse> : null;
  }, [displayText, messageId, sessionId]);
});
