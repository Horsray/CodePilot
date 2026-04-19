'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup, CompletionBar, extractDiff } from '@/components/ai-elements/tool-actions-group';
import { MediaPreview } from './MediaPreview';
import { Button } from '@/components/ui/button';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ImageGenConfirmation } from './ImageGenConfirmation';
import { BatchPlanInlinePreview } from './batch-image-gen/BatchPlanInlinePreview';
import { WidgetRenderer } from './WidgetRenderer';
import { ReferencedContexts } from './ReferencedContexts';
import { parseAllShowWidgets, computePartialWidgetKey } from './MessageItem';
import {
  appendTimelineReasoning,
  appendTimelineToolResult,
  appendTimelineToolUse,
  cloneTimelineSteps,
  completeTimelineStep,
  updateTimelineStatus,
  createTimelineAccumulator,
} from '@/lib/agent-timeline';
import { PENDING_KEY, buildReferenceImages } from '@/lib/image-ref-store';
import type { PlannerOutput, MediaBlock, TimelineStep } from '@/types';

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
      rawBlock: match[0], // full ```image-gen-request...``` block for exact matching
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

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  sessionId?: string;
  rewindUserMessageId?: string;
  startedAt: number;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  referencedFiles?: string[];
  thinkingContent?: string;
  statusText?: string;
  statusPayload?: Record<string, any>;
  onForceStop?: () => void;
}

function splitThinkingPhases(raw?: string): string[] {
  if (!raw) return [];
  // 中文注释：功能名称「思考分段器」，用法是把流式思考按阶段分段，
  // 再与工具调用按顺序配对，避免整段思考被塞进同一个 Step。
  return raw
    .split('\n\n---\n\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasStepPayload(step?: TimelineStep): boolean {
  if (!step) return false;
  return Boolean(
    step.reasoning.trim()
      || step.output.trim()
      || step.toolCalls.length > 0
      || step.fileChanges.length > 0
      || step.error,
  );
}

function toVisibleSteps(steps: TimelineStep[]): TimelineStep[] {
  return steps.filter((step) => (
    step.reasoning.trim()
    || step.output.trim()
    || step.toolCalls.length > 0
    || step.fileChanges.length > 0
    || step.error
  ));
}

/**
 * Smart content buffering — holds initial text until meaningful, but bypasses
 * for structured blocks (show-widget, batch-plan, image-gen-request).
 */
const BUFFER_WORD_THRESHOLD = 40;
const BUFFER_MAX_MS = 2500;
const STRUCTURED_BLOCK_RE = /```(show-widget|batch-plan|image-gen-request)/;

function useBufferedContent(rawContent: string, isStreaming: boolean): string {
  const [bypassed, setBypassed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive whether bypass conditions are met (pure computation, no side effects)
  const shouldBypass = !isStreaming
    || bypassed
    || (!!rawContent && STRUCTURED_BLOCK_RE.test(rawContent))
    || (!!rawContent && rawContent.split(/\s+/).filter(Boolean).length >= BUFFER_WORD_THRESHOLD);

  // Effect: sync bypass state when conditions are met (one-way latch, safe)
  useEffect(() => {
    if (shouldBypass && !bypassed && isStreaming && rawContent) {
      setBypassed(true);
    }
  }, [shouldBypass, bypassed, isStreaming, rawContent]);

  // Effect: reset on new turn (content emptied)
  useEffect(() => {
    if (!rawContent && !isStreaming) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [rawContent, isStreaming]);

  // Effect: max timeout — starts once when content first arrives during streaming.
  // Uses a boolean gate (hasContent) so the timer is created exactly once, not on every delta.
  const hasContent = !!rawContent;
  useEffect(() => {
    if (!isStreaming || bypassed || !hasContent) return;
    // Only start the timer if one isn't already running
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      setBypassed(true);
      timerRef.current = null;
    }, BUFFER_MAX_MS);
    // No cleanup — timer must survive rawContent changes.
    // It is cleaned up by the reset effect (when content empties) or when bypassed is set.
  }, [isStreaming, bypassed, hasContent]);

  // Pure render: no side effects
  if (!isStreaming) return rawContent;
  if (shouldBypass) return rawContent;
  return '';
}

/**
 * Thinking phase label that evolves over time to reduce perceived wait.
 * 0-5s: "思考中..." / "Thinking..."
 * 5-15s: "深度思考中..." / "Thinking deeply..."
 * 15s+: "组织回复中..." / "Preparing response..."
 */
function ThinkingPhaseLabel() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 5000);
    const t2 = setTimeout(() => setPhase(2), 15000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const text = phase === 0
    ? t('streaming.thinking')
    : phase === 1
      ? t('streaming.thinkingDeep')
      : t('streaming.preparing');

  return <Shimmer>{text}</Shimmer>;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  // Reset elapsed when the stream start time changes (e.g. new turn or session switch)
  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
  }, [startedAt]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <span className="tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

function StreamingStatusBar({ statusText, onForceStop, startedAt }: { statusText?: string; onForceStop?: () => void; startedAt: number }) {
  const displayText = statusText || 'Thinking';

  // Parse elapsed seconds from statusText like "Running bash... (45s)"
  const elapsedMatch = statusText?.match(/\((\d+)s\)/);
  const toolElapsed = elapsedMatch ? parseInt(elapsedMatch[1], 10) : 0;
  const isWarning = toolElapsed >= 60;
  const isCritical = toolElapsed >= 90;

  return (
    <div className="flex items-center gap-3 py-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className={isCritical ? 'text-status-error-foreground' : isWarning ? 'text-status-warning-foreground' : undefined}>
          <Shimmer duration={1.5}>{displayText}</Shimmer>
        </span>
        {isWarning && !isCritical && (
          <span className="text-status-warning-foreground text-[10px]">Running longer than usual</span>
        )}
        {isCritical && (
          <span className="text-status-error-foreground text-[10px]">Tool may be stuck</span>
        )}
      </div>
      <span className="text-muted-foreground/50">|</span>
      <ElapsedTimer startedAt={startedAt} />
      {isCritical && onForceStop && (
        <Button
          variant="outline"
          size="xs"
          onClick={onForceStop}
          className="ml-auto border-status-error-border bg-status-error-muted text-[10px] font-medium text-status-error-foreground hover:bg-status-error-muted"
        >
          Force stop
        </Button>
      )}
    </div>
  );
}

export function StreamingMessage({
  content,
  isStreaming,
  sessionId,
  rewindUserMessageId,
  startedAt,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  referencedFiles,
  thinkingContent,
  statusText,
  statusPayload,
  onForceStop,
}: StreamingMessageProps) {
  const { t } = useTranslation();
  const [liveTimelineSteps, setLiveTimelineSteps] = useState<TimelineStep[]>([]);
  const [finalContentStart, setFinalContentStart] = useState(0);
  const timelineStateRef = useRef<ReturnType<typeof createTimelineAccumulator> | null>(null);
  const prevSnapshotRef = useRef<{
    isStreaming: boolean;
    thinking: string;
    content: string;
    activityContentLength: number;
    toolUseIds: string[];
    toolResults: Record<string, string>;
    lastStatusPayload: any;
  }>({
    isStreaming: false,
    thinking: '',
    content: '',
    activityContentLength: 0,
    toolUseIds: [],
    toolResults: {},
    lastStatusPayload: null,
  });
  const bufferedContent = useBufferedContent(content, isStreaming);
  const mediaPreview = useMemo(() => {
    const allMedia = toolResults.flatMap((result) => result.media || []);
    return allMedia.length > 0 ? <MediaPreview media={allMedia} /> : null;
  }, [toolResults]);

  const completionInfo = useMemo(() => {
    if (isStreaming || toolUses.length === 0) return null;
    const mappedTools = toolUses.map((tool) => {
      const result = toolResults.find((r) => r.tool_use_id === tool.id);
      return {
        id: tool.id,
        name: tool.name,
        input: tool.input,
        result: result?.content,
        isError: result?.is_error,
        media: result?.media,
      };
    });
    const errCount = toolResults.filter(t => t.is_error).length;
    const changedFiles = mappedTools
      .map(t => ({ tool: t as any, diff: extractDiff(t as any) }))
      .filter((x): x is { tool: any; diff: any } => x.diff !== null);

    return { errCount, changedFiles };
  }, [isStreaming, toolUses, toolResults]);

  useEffect(() => {
    const prev = prevSnapshotRef.current;
    const now = Date.now();

    if (!timelineStateRef.current) {
      timelineStateRef.current = createTimelineAccumulator(now);
    }

    // 新一轮流式：重置增量状态，避免沿用上一轮缓存。
    if (isStreaming && !prev.isStreaming) {
      timelineStateRef.current = createTimelineAccumulator(now);
      // 中文注释：功能名称「重置流式时间线快照」，用法是在新一轮消息开始时同步清空状态与模型上下文。
      prevSnapshotRef.current = {
        isStreaming: true,
        thinking: '',
        content: '',
        activityContentLength: 0,
        toolUseIds: [],
        toolResults: {},
        lastStatusPayload: null,
      };
      setFinalContentStart(0);
    }

    const currentState = timelineStateRef.current!;
    const currentPrev = prevSnapshotRef.current;

    // status payload 增量：更新模型勋章和状态
    if (statusPayload && statusPayload !== currentPrev.lastStatusPayload && statusPayload.subtype !== 'step_complete') {
      updateTimelineStatus(currentState, statusPayload as any, now);
    }

    // thinking 增量：不再整段重建，避免卡片位置固定只刷新旧内容。
    const currentThinking = thinkingContent || '';
    if (currentThinking && currentThinking !== currentPrev.thinking) {
      if (currentThinking.startsWith(currentPrev.thinking)) {
        const delta = currentThinking.slice(currentPrev.thinking.length);
        if (delta.trim()) {
          appendTimelineReasoning(currentState, delta, now);
        }
      } else {
        const phases = splitThinkingPhases(currentThinking);
        const fallback = phases[phases.length - 1] || currentThinking;
        appendTimelineReasoning(currentState, `\n${fallback}`, now);
      }
    }

    const currentContent = content || '';
    const completedToolIds = new Set(toolResults.map((result) => result.tool_use_id));
    const allToolsCompleted = toolUses.length > 0 && toolUses.every((tool) => completedToolIds.has(tool.id));
    const hasNewTool = toolUses.some((tool) => !currentPrev.toolUseIds.includes(tool.id));
    let activityContentLength = currentPrev.activityContentLength;
    const consumeActivityContent = (toLength: number, timestamp: number) => {
      if (toLength <= activityContentLength) return;
      const delta = currentContent.slice(activityContentLength, toLength);
      activityContentLength = toLength;
      if (delta.trim()) {
        appendTimelineReasoning(currentState, delta, timestamp);
      }
    };

    // 文本如果发生在工具阶段之前或期间，属于过程说明，不属于最终结论。
    if (hasNewTool) {
      consumeActivityContent(currentContent.length, now);
    }

    // tool_use 增量：新工具直接接在当前事件后，不强行把思考和工具拆成两坨。
    toolUses.forEach((tool, index) => {
      if (!currentPrev.toolUseIds.includes(tool.id)) {
        appendTimelineToolUse(currentState, tool, now + index);
      }
    });

    // tool_result 增量更新
    toolResults.forEach((result, index) => {
      const key = result.tool_use_id;
      const marker = `${result.content}::${result.is_error ? '1' : '0'}`;
      if (currentPrev.toolResults[key] !== marker) {
        appendTimelineToolResult(currentState, result, now + index);
      }
    });

    if (toolUses.length > 0 && !allToolsCompleted) {
      consumeActivityContent(currentContent.length, now + toolUses.length + toolResults.length + 1);
    }

    if (!isStreaming && currentPrev.isStreaming) {
      const latest = cloneTimelineSteps(currentState).at(-1);
      if (hasStepPayload(latest)) {
        completeTimelineStep(currentState, undefined, now + 3);
      }
    }

    const nextSteps = toVisibleSteps(cloneTimelineSteps(currentState));
    setLiveTimelineSteps(nextSteps);
    setFinalContentStart(activityContentLength);

    prevSnapshotRef.current = {
      isStreaming,
      thinking: currentThinking,
      content: currentContent,
      activityContentLength,
      toolUseIds: toolUses.map((t) => t.id),
      toolResults: Object.fromEntries(
        toolResults.map((r) => [r.tool_use_id, `${r.content}::${r.is_error ? '1' : '0'}`]),
      ),
      lastStatusPayload: statusPayload,
    };
  }, [content, isStreaming, thinkingContent, toolResults, toolUses, statusPayload]);

  // Filter out leaked SSE raw data that wasn't properly parsed
  const cleanContent = useMemo(() => {
    if (!content) return '';
    const finalContent = content.slice(finalContentStart);
    const leakedEventType = /"type"\s*:\s*"(tool_result|tool_use|tool_output|status|text|thinking|result|done|error|keep_alive|referenced_contexts)"/;
    // Line-by-line filter for leaked transport frames only. Do not strip
    // arbitrary JSON from the actual final answer.
    let cleaned = finalContent;
    cleaned = cleaned.split('\n').filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      // Remove lines starting with $data or data: followed by JSON
      if (/^\$?data\s*:?\s*\{/.test(trimmed)) return false;
      // Remove standalone SSE-style JSON objects with a known transport type
      if (/^\{.*\}$/.test(trimmed) && leakedEventType.test(trimmed)) return false;
      return true;
    }).join('\n').trim();
    return cleaned;
  }, [content, finalContentStart]);

  const renderedContent = useMemo(() => {
    if (!cleanContent) return null;

    const contentToRender = cleanContent;

    const hasWidgetFence = /`{1,3}show-widget/.test(contentToRender);

    if (hasWidgetFence && isStreaming) {
      const lastMarkerMatch = [...contentToRender.matchAll(/`{1,3}show-widget/g)].pop();
      if (!lastMarkerMatch) return <MessageResponse>{contentToRender}</MessageResponse>;

      const lastFenceStart = lastMarkerMatch.index!;
      const afterLastFence = contentToRender.slice(lastFenceStart);
      const jsonStart = afterLastFence.indexOf('{');
      let lastFenceClosed = false;
      if (jsonStart !== -1) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let i = jsonStart; i < afterLastFence.length; i++) {
          const ch = afterLastFence[i];
          if (esc) { esc = false; continue; }
          if (ch === '\\' && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { lastFenceClosed = true; break; } }
        }
      }

      if (lastFenceClosed) {
        const allSegments = parseAllShowWidgets(cleanContent);
        return (
          <>
            {allSegments.map((seg, i) =>
              seg.type === 'text'
                ? <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
                : <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />
            )}
          </>
        );
      }

      const beforePart = cleanContent.slice(0, lastFenceStart).trim();
      const hasCompletedFences = !!beforePart && /`{1,3}show-widget/.test(beforePart);
      const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
      const markerEnd = afterLastFence.match(/^`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/);
      const fenceBody = markerEnd ? afterLastFence.slice(markerEnd[0].length).trim() : afterLastFence.trim();
      let partialCode: string | null = null;
      const keyIdx = fenceBody.indexOf('"widget_code"');
      if (keyIdx !== -1) {
        const colonIdx = fenceBody.indexOf(':', keyIdx + 13);
        if (colonIdx !== -1) {
          const quoteIdx = fenceBody.indexOf('"', colonIdx + 1);
          if (quoteIdx !== -1) {
            let raw = fenceBody.slice(quoteIdx + 1);
            raw = raw.replace(/"\s*\}\s*$/, '');
            if (raw.endsWith('\\')) raw = raw.slice(0, -1);
            try {
              partialCode = raw
                .replace(/\\\\/g, '\x00BACKSLASH\x00')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\r/g, '\r')
                .replace(/\\"/g, '"')
                .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/\x00BACKSLASH\x00/g, '\\');
            } catch {
              partialCode = null;
            }
          }
        }
      }

      let scriptsTruncated = false;
      if (partialCode) {
        const lastScript = partialCode.lastIndexOf('<script');
        if (lastScript !== -1) {
          const afterScript = partialCode.slice(lastScript);
          if (!/<script[\s\S]*?<\/script>/i.test(afterScript)) {
            partialCode = partialCode.slice(0, lastScript).trim() || null;
            scriptsTruncated = true;
          }
        }
      }

      const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
      const partialTitle = titleMatch ? titleMatch[1] : undefined;
      const partialWidgetKey = computePartialWidgetKey(cleanContent);

      return (
        <>
          {!hasCompletedFences && beforePart && <MessageResponse key="pre-text">{beforePart}</MessageResponse>}
          {completedSegments.map((seg, i) =>
            seg.type === 'text'
              ? <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
              : <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />
          )}
          {partialCode && partialCode.length > 10 ? (
            <WidgetRenderer key={partialWidgetKey} widgetCode={partialCode} isStreaming={true} title={partialTitle} showOverlay={scriptsTruncated} />
          ) : (
            <Shimmer>{t('widget.loading')}</Shimmer>
          )}
        </>
      );
    }

    if (hasWidgetFence && !isStreaming) {
      const widgetSegments = parseAllShowWidgets(contentToRender);
      if (widgetSegments.length > 0) {
        return (
          <>
            {widgetSegments.map((seg, i) =>
              seg.type === 'text'
                ? <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
                : <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />
            )}
          </>
        );
      }
    }

    const batchPlanResult = parseBatchPlan(contentToRender);
    if (batchPlanResult) {
      return (
        <>
          {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
          <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId="streaming-preview" />
          {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
        </>
      );
    }

    const parsed = parseImageGenRequest(contentToRender);
    if (parsed) {
      const refs = buildReferenceImages(
        PENDING_KEY,
        sessionId || '',
        parsed.request.useLastGenerated || false,
        parsed.request.referenceImages,
      );
      return (
        <>
          {parsed.beforeText && <MessageResponse>{parsed.beforeText}</MessageResponse>}
          <ImageGenConfirmation
            messageId="streaming"
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

    if (isStreaming) {
      const hasImageGenBlock = /```image-gen-request/.test(contentToRender);
      const hasBatchPlanBlock = /```batch-plan/.test(contentToRender);
      const textToRender = bufferedContent || '';
      const stripped = textToRender
        .replace(/```image-gen-request[\s\S]*$/, '')
        .replace(/```batch-plan[\s\S]*$/, '')
        .replace(/```show-widget[\s\S]*$/, '')
        .replace(/\s*<!--\s*heartbeat-done\s*-->\s*/g, '')
        .trim();
        
      if (stripped) return <MessageResponse key="pre-text">{stripped}</MessageResponse>;
      if ((hasImageGenBlock || hasBatchPlanBlock) && liveTimelineSteps.length === 0) {
         return <Shimmer>{t('streaming.thinking')}</Shimmer>;
      }
      return null;
    }

    const stripped = contentToRender
      .replace(/```image-gen-request[\s\S]*?```/g, '')
      .replace(/```batch-plan[\s\S]*?```/g, '')
      .replace(/```show-widget[\s\S]*?(```|$)/g, '')
      .replace(/\s*<!--\s*heartbeat-done\s*-->\s*/g, '')
      .trim();

    return stripped ? <MessageResponse>{stripped}</MessageResponse> : null;
  }, [bufferedContent, cleanContent, isStreaming, sessionId, t, liveTimelineSteps]);

  return (
    <AIMessage from="assistant">
      <MessageContent>
        {referencedFiles && referencedFiles.length > 0 && (
          <ReferencedContexts files={referencedFiles} />
        )}

        {/* Render the timeline (tools and thoughts interleaved) */}
        {(toolUses.length > 0 || liveTimelineSteps.length > 0) && (
          <ToolActionsGroup
            tools={toolUses.map((tool) => {
              const result = toolResults.find((r) => r.tool_use_id === tool.id);
              return {
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result: result?.content,
                isError: result?.is_error,
                media: result?.media,
              };
            })}
            steps={liveTimelineSteps}
            isStreaming={isStreaming}
            streamingToolOutput={streamingToolOutput}
            statusText={statusText}
            sessionId={sessionId}
            rewindUserMessageId={rewindUserMessageId}
          />
        )}

        {/* Media from tool results — rendered outside tool group so images stay visible */}
        {mediaPreview}

        {/* Streaming text content rendered via Streamdown */}
        {renderedContent}

        {/* Completion Bar rendered only once at the end of the message when done */}
        {completionInfo && completionInfo.changedFiles.length > 0 && (
          <CompletionBar
            changedFiles={completionInfo.changedFiles}
            errCount={completionInfo.errCount}
            sessionId={sessionId}
            rewindId={rewindUserMessageId}
          />
        )}

        {/* Loading indicator when no content yet and no thinking content — evolves over time */}
        {isStreaming && liveTimelineSteps.length === 0 && !content && toolUses.length === 0 && !thinkingContent && (
          <div className="py-2">
            <ThinkingPhaseLabel />
          </div>
        )}

        {/* Status bar during streaming */}
        {isStreaming && <StreamingStatusBar statusText={
          statusText
          || (content && /```show-widget/.test(content) ? (() => {
            // Detect if scripts are being streamed (unclosed <script> in the last open fence)
            const lastFence = content.lastIndexOf('```show-widget');
            if (lastFence !== -1) {
              const after = content.slice(lastFence);
              const fenceClosed = /```show-widget\s*\n?[\s\S]*?\n?\s*```/.test(after);
              if (!fenceClosed && /<script\b/i.test(after)) {
                return t('widget.addingInteractivity');
              }
            }
            return t('widget.streaming');
          })() : undefined)
          || (content && content.length > 0 ? t('streaming.generating') : undefined)
        } onForceStop={onForceStop} startedAt={startedAt} />}
      </MessageContent>
    </AIMessage>
  );
}
