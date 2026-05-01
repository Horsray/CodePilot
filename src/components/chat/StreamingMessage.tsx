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
import { AgentTimeline } from './AgentTimeline';
import { SubAgentStatusBar } from './SubAgentStatusBar';
import { parseAllShowWidgets, computePartialWidgetKey } from './MessageItem';
import {
  appendTimelineReasoning,
  appendTimelineOutput,
  appendTimelineToolResult,
  appendTimelineToolUse,
  cloneTimelineSteps,
  completeTimelineStep,
  updateTimelineStatus,
  createTimelineAccumulator,
} from '@/lib/agent-timeline';
import { stripLeakedTransportContent } from '@/lib/message-content-sanitizer';
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
  parentAgentId?: string;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
  parentAgentId?: string;
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
  // 中文注释：功能名称「子Agent快照数据」，用法是从streamSnapshot传入子Agent数据，
  // 使SubAgentStatusBar在切换会话后能恢复渲染
  subAgents?: any[];
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
  subAgents: streamingSubAgents,
}: StreamingMessageProps) {
  const { t } = useTranslation();
  const [liveTimelineSteps, setLiveTimelineSteps] = useState<TimelineStep[]>([]);

  // 中文注释：功能名称「子Agent工具调用路由」，用法是将带有parentAgentId的工具调用
  // 从主时间线中过滤出来，路由到对应的SubAgentInfo中，避免子Agent的工具调用污染主时间线。
  // 主时间线只保留没有parentAgentId的工具调用（即主Agent自己的工具调用）。
  const timelineTools = useMemo(
    () => toolUses.filter(t => !t.parentAgentId),
    [toolUses],
  );
  const timelineToolResults = useMemo(
    () => toolResults.filter(r => !r.parentAgentId),
    [toolResults],
  );

  // Preserve the last known sub-agents so the SubAgentStatusBar stays visible
  // after streaming ends and the snapshot is cleared.
  // Also listen to window events as a fallback in case streaming snapshot doesn't carry subAgents.
  const lastSubAgentsRef = useRef<any[]>([]);
  if (Array.isArray(streamingSubAgents) && streamingSubAgents.length > 0) {
    lastSubAgentsRef.current = streamingSubAgents;
  }

  // Fallback: listen to subagents-sync window events from stream-session-manager
  const [fallbackSubAgents, setFallbackSubAgents] = useState<any[]>([]);
  useEffect(() => {
    if (!sessionId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId && Array.isArray(detail.subAgents)) {
        setFallbackSubAgents(detail.subAgents);
      }
    };
    window.addEventListener('subagents-sync', handler);
    return () => window.removeEventListener('subagents-sync', handler);
  }, [sessionId]);

  // Merge: prefer streaming snapshot, fallback to window events
  if (fallbackSubAgents.length > 0 && lastSubAgentsRef.current.length === 0) {
    lastSubAgentsRef.current = fallbackSubAgents;
  }
  const hasStreamingSubAgents = lastSubAgentsRef.current.length > 0;

  // 中文注释：将子Agent的工具调用和结果按parentAgentId分组，合并到streamingSubAgents中，
  // 使SubAgentStatusBar能渲染子Agent的独立状态。
  // 依赖 fallbackSubAgents 以确保窗口事件触发时也能重新计算。
  const enrichedSubAgents = useMemo(() => {
    const baseAgents = streamingSubAgents && streamingSubAgents.length > 0
      ? streamingSubAgents
      : lastSubAgentsRef.current;
    if (baseAgents.length === 0) return baseAgents;

    // 按parentAgentId分组子Agent的工具调用
    const agentToolMap = new Map<string, Array<{ id: string; name: string; input: unknown; result?: string; isError?: boolean }>>();
    for (const tool of toolUses) {
      if (tool.parentAgentId) {
        const list = agentToolMap.get(tool.parentAgentId) || [];
        list.push({ id: tool.id, name: tool.name, input: tool.input });
        agentToolMap.set(tool.parentAgentId, list);
      }
    }
    // 附加tool_result到对应工具
    for (const result of toolResults) {
      if (result.parentAgentId) {
        const list = agentToolMap.get(result.parentAgentId);
        if (list) {
          const tool = list.find(t => t.id === result.tool_use_id);
          if (tool) {
            tool.result = result.content;
            tool.isError = result.is_error;
          }
        }
      }
    }

    return baseAgents.map(agent => ({
      ...agent,
      toolCalls: agentToolMap.get(agent.id) || agent.toolCalls || [],
    }));
  }, [streamingSubAgents, toolUses, toolResults, fallbackSubAgents]);

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
    if (isStreaming || timelineTools.length === 0) return null;
    const mappedTools = timelineTools.map((tool) => {
      const result = timelineToolResults.find((r) => r.tool_use_id === tool.id);
      return {
        id: tool.id,
        name: tool.name,
        input: tool.input,
        result: result?.content,
        isError: result?.is_error,
        media: result?.media,
      };
    });
    const errCount = timelineToolResults.filter(t => t.is_error).length;
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
  }, [isStreaming, timelineTools, timelineToolResults]);

  // 中文注释：功能名称「时间线增量更新优化」，用法是追踪是否有实质变化（新工具、新思考、状态变化），
  // 纯文本流式过程中跳过 cloneTimelineSteps 深拷贝和 setLiveTimelineSteps state 更新，
  // 避免 60fps 的深拷贝导致 UI 卡顿。finalContentStart 单独更新。
  const hasStructuralChangeRef = useRef(false);

  useEffect(() => {
    const prev = prevSnapshotRef.current;
    const now = Date.now();

    if (!timelineStateRef.current) {
      timelineStateRef.current = createTimelineAccumulator(now);
    }

    // 新一轮流式：重置增量状态，避免沿用上一轮缓存。
    if (isStreaming && !prev.isStreaming) {
      hasStructuralChangeRef.current = true;
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
      hasStructuralChangeRef.current = true;
      updateTimelineStatus(currentState, statusPayload as any, now);
    }

    // thinking 增量：不再整段重建，避免卡片位置固定只刷新旧内容。
    const currentThinking = thinkingContent || '';
    if (currentThinking && currentThinking !== currentPrev.thinking) {
      hasStructuralChangeRef.current = true;
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
    // 中文注释：使用过滤后的timelineTools/timelineToolResults（排除子Agent工具调用），
    // 避免子Agent的工具调用污染主时间线
    const completedToolIds = new Set(timelineToolResults.map((result) => result.tool_use_id));
    const allToolsCompleted = timelineTools.length > 0 && timelineTools.every((tool) => completedToolIds.has(tool.id));
    const hasNewTool = timelineTools.some((tool) => !currentPrev.toolUseIds.includes(tool.id));
    if (hasNewTool || timelineToolResults.some((r) => currentPrev.toolResults[r.tool_use_id] === undefined)) {
      hasStructuralChangeRef.current = true;
    }
    let activityContentLength = currentPrev.activityContentLength;
    const consumeActivityContent = (toLength: number, timestamp: number) => {
      if (toLength <= activityContentLength) return;
      const delta = currentContent.slice(activityContentLength, toLength);
      activityContentLength = toLength;
      if (delta.trim()) {
        appendTimelineOutput(currentState, delta, timestamp);
        // 中文注释：功能名称「时间线输出实时刷新」，用法是在工具阶段或已有推理阶段时，
        // 文本增量本身就属于可见时间线内容，不能被“纯正文优化”一起吞掉，否则步骤卡片会
        // 一直等到下一个结构变化或流结束才刷新。
        if (currentPrev.toolUseIds.length > 0 || currentPrev.thinking.length > 0) {
          hasStructuralChangeRef.current = true;
        }
      }
    };

    // 文本如果发生在工具阶段之前或期间，属于过程说明，不属于最终结论。
    if (hasNewTool) {
      consumeActivityContent(currentContent.length, now);
    }

    // tool_use 增量：新工具直接接在当前事件后，不强行把思考和工具拆成两坨。
    // 中文注释：使用过滤后的timelineTools，只渲染主Agent自己的工具调用
    timelineTools.forEach((tool, index) => {
      if (!currentPrev.toolUseIds.includes(tool.id)) {
        appendTimelineToolUse(currentState, tool, now + index);
      }
    });

    // tool_result 增量更新
    // 中文注释：使用过滤后的timelineToolResults，只渲染主Agent自己的工具结果
    timelineToolResults.forEach((result, index) => {
      const key = result.tool_use_id;
      const marker = `${result.content}::${result.is_error ? '1' : '0'}`;
      if (currentPrev.toolResults[key] !== marker) {
        appendTimelineToolResult(currentState, result, now + index);
      }
    });

    if (timelineTools.length > 0 && !allToolsCompleted) {
      consumeActivityContent(currentContent.length, now + timelineTools.length + timelineToolResults.length + 1);
    }

    if (!isStreaming && currentPrev.isStreaming) {
      const latest = cloneTimelineSteps(currentState).at(-1);
      if (hasStepPayload(latest)) {
        completeTimelineStep(currentState, undefined, now + 3);
      }
    }

    // 中文注释：功能名称「时间线跳过深拷贝」，用法是在纯文本流式更新时（无新工具/思考/状态变化），
    // 跳过 cloneTimelineSteps 深拷贝和 setLiveTimelineSteps state 更新，减少 60fps 下的 GC 压力和 re-render。
    setFinalContentStart(activityContentLength);
    if (hasStructuralChangeRef.current || !isStreaming) {
      hasStructuralChangeRef.current = false;
      const nextSteps = toVisibleSteps(cloneTimelineSteps(currentState));
      setLiveTimelineSteps(nextSteps);
    }

    prevSnapshotRef.current = {
      isStreaming,
      thinking: currentThinking,
      content: currentContent,
      activityContentLength,
      toolUseIds: timelineTools.map((t) => t.id),
      toolResults: Object.fromEntries(
        timelineToolResults.map((r) => [r.tool_use_id, `${r.content}::${r.is_error ? '1' : '0'}`]),
      ),
      lastStatusPayload: statusPayload,
    };
  }, [content, isStreaming, thinkingContent, timelineToolResults, timelineTools, statusPayload]);

  // Filter out leaked SSE raw data that wasn't properly parsed
  const cleanContent = useMemo(() => {
    if (!content) return '';
    const finalContent = content.slice(finalContentStart);
    return stripLeakedTransportContent(finalContent);
  }, [content, finalContentStart]);

  const renderedContent = useMemo(() => {
    if (!cleanContent) return null;

    // 中文注释：功能名称「防止thinking内容双重渲染」，用法是当时间线已包含thinking步骤时，
    // 跳过MessageContent区域的渲染，避免thinking文本在时间线（12px约束容器）和消息区域
    // （text-sm/14px Streamdown）同时渲染导致的字体闪现bug。
    if (liveTimelineSteps.some(step => step.reasoning.trim())) return null;

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
        .replace(/```chat-error[\s\S]*$/, '')
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
      .replace(/```chat-error[\s\S]*?(```|$)/g, '')
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
        {(timelineTools.length > 0 || liveTimelineSteps.length > 0 || hasStreamingSubAgents) && (
          <ToolActionsGroup
            tools={timelineTools.map((tool) => {
              const result = timelineToolResults.find((r) => r.tool_use_id === tool.id);
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
            flat={true}
            hideSubAgents={hasStreamingSubAgents}
          />
        )}

        {/* Media from tool results — rendered outside tool group so images stay visible */}
        {mediaPreview}

        {/* Streaming text content rendered via Streamdown — rendered before SubAgentStatusBar
            so the parent agent's own work flows naturally above the status bar. */}
        {renderedContent}

        {/* 中文注释：功能名称「子Agent内联状态条」，用法是替代原 SubAgentTimeline 卡片，
            用一行紧凑状态条显示所有子Agent的执行状态和进度。
            只要有子Agent就一直显示，直到流式结束由MessageItem接管。 */}
        {enrichedSubAgents.length > 0 && (
          <SubAgentStatusBar subAgents={enrichedSubAgents} />
        )}

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
        {isStreaming && liveTimelineSteps.length === 0 && !content && timelineTools.length === 0 && !thinkingContent && !hasStreamingSubAgents && (
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
