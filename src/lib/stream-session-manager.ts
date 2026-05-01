/**
 * Stream Session Manager — client-side singleton that manages SSE streams
 * independently of React component lifecycle.
 *
 * When a user switches sessions, the old ChatView unmounts but the stream
 * continues running here. The new ChatView (or the same one re-mounted)
 * subscribes to get the current snapshot.
 *
 * Uses globalThis pattern (same as conversation-registry.ts) to survive
 * Next.js HMR without losing state.
 */

import { consumeSSEStream } from '@/hooks/useSSEStream';
import { transferPendingToMessage } from '@/lib/image-ref-store';
import { stripLeakedTransportContent } from '@/lib/message-content-sanitizer';
import type {
  ToolUseInfo,
  ToolResultInfo,
  SessionStreamSnapshot,
  StreamEvent,
  StreamEventListener,
  TokenUsage,
  PermissionRequestEvent,
  FileAttachment,
  MentionRef,
  SubAgentInfo,
  PromptInstructionSourceMeta,
} from '@/types';

// ==========================================
// Internal types
// ==========================================

interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  /** 中文注释：功能名称「中止原因标记」，用法是区分用户主动停止、会话切换/HMR 重挂载、
   * 空闲超时等预期中止，避免把正常终止误判成请求故障。 */
  abortReason: 'manual_stop' | 'stream_replaced' | null;
  snapshot: SessionStreamSnapshot;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number;
  gcTimer: ReturnType<typeof setTimeout> | null;
  /** Tracked ad-hoc timeouts — cleaned up when the stream ends. */
  pendingTimers: Set<ReturnType<typeof setTimeout>>;
  // Mutable accumulators (snapshot gets new object refs on each emit)
  accumulatedText: string;
  /** Prefix of accumulatedText produced before/during tool execution, not final answer. */
  activityTextLength: number;
  accumulatedThinking: string;
  /** All thinking blocks concatenated (preserved for finalMessageContent) */
  fullThinking: string;
  /** Tracks whether non-thinking content has arrived since last thinking delta */
  thinkingPhaseEnded: boolean;
  toolUsesArray: ToolUseInfo[];
  toolResultsArray: ToolResultInfo[];
  toolOutputAccumulated: string;
  toolTimeoutInfo: { toolName: string; elapsedSeconds: number } | null;
  isIdleTimeout: boolean;
  sendMessageFn: ((content: string, files?: FileAttachment[]) => void) | null;
  rewindPoints: Array<{ userMessageId: string }>;
  /** Active sub-agents being tracked for nested timeline display */
  subAgents: SubAgentInfo[];
  /** 中文注释：功能名称「子Agent超时定时器」，用法是跟踪每个子Agent的空闲超时定时器，
   * 收到进度更新时重置，超时未收到任何活动则自动标记为超时完成 */
  subAgentTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export interface StartStreamParams {
  sessionId: string;
  content: string;
  clientMessageId?: string;
  mode: string;
  model: string;
  providerId: string;
  files?: FileAttachment[];
  mentions?: MentionRef[];
  systemPromptAppend?: string;
  pendingImageNotices?: string[];
  /** When true, backend skips saving user message and title update (assistant auto-trigger) */
  autoTrigger?: boolean;
  /** Called when SDK mode changes (e.g. plan → code) */
  onModeChanged?: (mode: string) => void;
  /** Reference to the outer sendMessage so tool-timeout auto-retry works */
  sendMessageFn?: (content: string, files?: FileAttachment[]) => void;
  /** SDK effort level (low/medium/high/max) — only sent when model supports it */
  effort?: string;
  /** SDK thinking config */
  thinking?: { type: string; budgetTokens?: number };
  /** Enable 1M context window (beta) */
  context1m?: boolean;
  /** Called when init status event provides metadata (tools, slash_commands, skills) */
  onInitMeta?: (meta: { tools?: unknown; slash_commands?: unknown; skills?: unknown; instruction_sources?: PromptInstructionSourceMeta[] }) => void;
  /** Display-only content for user message (e.g. /skillName instead of expanded prompt) */
  displayOverride?: string;
}

// ==========================================
// Singleton via globalThis
// ==========================================

const GLOBAL_KEY = '__streamSessionManager__' as const;
const LISTENERS_KEY = '__streamSessionListeners__' as const;
const STREAM_IDLE_TIMEOUT_MS = 330_000;
const STREAM_THINKING_IDLE_TIMEOUT_MS = 600_000; // 中文注释：深度思考阶段允许更长的空闲超时（10分钟）
const GC_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function getStreamsMap(): Map<string, ActiveStream> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, ActiveStream>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, ActiveStream>;
}

/** Listener registry — persists independently of stream entries so GC doesn't orphan listeners */
function getListenersMap(): Map<string, Set<StreamEventListener>> {
  if (!(globalThis as Record<string, unknown>)[LISTENERS_KEY]) {
    (globalThis as Record<string, unknown>)[LISTENERS_KEY] = new Map<string, Set<StreamEventListener>>();
  }
  return (globalThis as Record<string, unknown>)[LISTENERS_KEY] as Map<string, Set<StreamEventListener>>;
}

// ==========================================
// Helpers
// ==========================================

function buildSnapshot(stream: ActiveStream): SessionStreamSnapshot {
  return {
    sessionId: stream.sessionId,
    phase: stream.snapshot.phase,
    streamingContent: stream.accumulatedText,
    streamingThinkingContent: stream.accumulatedThinking,
    toolUses: [...stream.toolUsesArray],
    toolResults: [...stream.toolResultsArray],
    streamingToolOutput: stream.toolOutputAccumulated,
    statusText: stream.snapshot.statusText,
    statusPayload: stream.snapshot.statusPayload,
    pendingPermission: stream.snapshot.pendingPermission,
    permissionResolved: stream.snapshot.permissionResolved,
    tokenUsage: stream.snapshot.tokenUsage,
    startedAt: stream.snapshot.startedAt,
    completedAt: stream.snapshot.completedAt,
    error: stream.snapshot.error,
    referencedContexts: stream.snapshot.referencedContexts,
    // 中文注释：功能名称「工具文件快照传递」，用法是将累积的toolFiles传递到新快照中，
    // 避免每次emit时buildSnapshot丢失toolFiles数据，导致上下文统计无法显示文件/网页信息
    toolFiles: stream.snapshot.toolFiles,
    finalMessageContent: stream.snapshot.finalMessageContent,
    terminalReason: stream.snapshot.terminalReason,
    rateLimitInfo: stream.snapshot.rateLimitInfo,
    contextUsageSnapshot: stream.snapshot.contextUsageSnapshot,
    subAgents: [...stream.subAgents],
  };
}

function emit(stream: ActiveStream, type: StreamEvent['type']) {
  const snapshot = buildSnapshot(stream);
  stream.snapshot = snapshot; // store latest
  const event: StreamEvent = { type, sessionId: stream.sessionId, snapshot };
  const listeners = getListenersMap().get(stream.sessionId);
  if (listeners) {
    for (const listener of listeners) {
      try { listener(event); } catch { /* listener error */ }
    }
  }
  // Also dispatch window event for AppShell
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stream-session-event', { detail: event }));
  }
}

function scheduleGC(stream: ActiveStream) {
  if (stream.gcTimer) clearTimeout(stream.gcTimer);
  stream.gcTimer = setTimeout(() => {
    const map = getStreamsMap();
    const current = map.get(stream.sessionId);
    if (current === stream && current.snapshot.phase !== 'active') {
      map.delete(stream.sessionId);
    }
  }, GC_DELAY_MS);
}

function cleanupTimers(stream: ActiveStream) {
  if (stream.idleCheckTimer) {
    clearInterval(stream.idleCheckTimer);
    stream.idleCheckTimer = null;
  }
  // Clear all tracked ad-hoc timeouts
  for (const t of stream.pendingTimers) {
    clearTimeout(t);
  }
  stream.pendingTimers.clear();
}

/** Schedule a tracked timeout on the stream. Auto-removes itself after firing. */
function streamTimeout(stream: ActiveStream, fn: () => void, ms: number): void {
  const id = setTimeout(() => {
    stream.pendingTimers.delete(id);
    fn();
  }, ms);
  stream.pendingTimers.add(id);
}

// ==========================================
// Public API
// ==========================================

export function startStream(params: StartStreamParams): void {
  const map = getStreamsMap();
  const existing = map.get(params.sessionId);

  // If already streaming this session, abort old stream first
  if (existing && existing.snapshot.phase === 'active') {
    existing.abortReason = 'stream_replaced';
    existing.abortController.abort();
    cleanupTimers(existing);
  }

  const abortController = new AbortController();

  const stream: ActiveStream = {
    sessionId: params.sessionId,
    abortController,
    abortReason: null,
    snapshot: {
      sessionId: params.sessionId,
      phase: 'active',
      streamingContent: '',
      streamingThinkingContent: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      statusText: undefined,
      statusPayload: undefined,
      pendingPermission: null,
      permissionResolved: null,
      tokenUsage: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      referencedContexts: [],
      // 中文注释：功能名称「工具文件初始化」，用法是初始化toolFiles为空数组，
      // 后续由onToolFiles回调累积填充AI访问的文件和网页
      toolFiles: [],
      finalMessageContent: null,
    },
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    gcTimer: null,
    pendingTimers: new Set(),
    accumulatedText: '',
    activityTextLength: 0,
    accumulatedThinking: '',
    fullThinking: '',
    thinkingPhaseEnded: false,
    toolUsesArray: [],
    toolResultsArray: [],
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    sendMessageFn: params.sendMessageFn ?? null,
    rewindPoints: [],
    subAgents: [],
    subAgentTimers: new Map(),
  };

  map.set(params.sessionId, stream);
  emit(stream, 'phase-changed');

  // Run the stream in background (non-blocking)
  runStream(stream, params).catch(() => {});
}

async function runStream(stream: ActiveStream, params: StartStreamParams): Promise<void> {
  const markActive = () => { stream.lastEventTime = Date.now(); };

  // 中文注释：空闲超时检测器 — 深度思考阶段使用更长的超时值
  stream.idleCheckTimer = setInterval(() => {
    const isThinking = !stream.thinkingPhaseEnded && stream.accumulatedThinking.length > 0;
    const timeoutMs = isThinking ? STREAM_THINKING_IDLE_TIMEOUT_MS : STREAM_IDLE_TIMEOUT_MS;
    if (Date.now() - stream.lastEventTime >= timeoutMs) {
      cleanupTimers(stream);
      stream.isIdleTimeout = true;
      stream.abortController.abort();
    }
  }, 10_000);

  // Flush pending image notices
  let effectiveContent = params.content;
  if (params.pendingImageNotices && params.pendingImageNotices.length > 0) {
    const notices = params.pendingImageNotices.join('\n\n');
    effectiveContent = `${notices}\n\n---\n\n${params.content}`;
  }

  // Adaptive text emit throttle — avoids excessive React re-renders during fast streaming.
  // Defined before try/catch so flushTextThrottle is accessible in the error path.
  // 中文注释：功能名称「流式文本节流」，用法是将文本更新控制在接近 60fps，
  // 既减少 React 抖动，又避免让用户觉得首轮输出“一卡一卡地跳”。
  const TEXT_THROTTLE_MS = 16;
  let textEmitTimer: ReturnType<typeof setTimeout> | null = null;
  let textDirty = false;
  // 中文注释：思考内容通常比正文更长，节流稍微放宽，减少大段 reasoning 导致的频繁重绘。
  const THINKING_THROTTLE_MS = 48;
  let thinkingEmitTimer: ReturnType<typeof setTimeout> | null = null;
  let thinkingDirty = false;

  const emitTextUpdate = () => {
    textDirty = false;
    emit(stream, 'snapshot-updated');
  };

  const emitThinkingUpdate = () => {
    thinkingDirty = false;
    emit(stream, 'snapshot-updated');
  };

  const throttledTextEmit = () => {
    textDirty = true;
    if (!textEmitTimer) {
      textEmitTimer = setTimeout(() => {
        textEmitTimer = null;
        if (textDirty) emitTextUpdate();
      }, TEXT_THROTTLE_MS);
    }
  };

  const throttledThinkingEmit = () => {
    thinkingDirty = true;
    if (!thinkingEmitTimer) {
      thinkingEmitTimer = setTimeout(() => {
        thinkingEmitTimer = null;
        if (thinkingDirty) emitThinkingUpdate();
      }, THINKING_THROTTLE_MS);
    }
  };

  const flushTextThrottle = () => {
    if (textEmitTimer) {
      clearTimeout(textEmitTimer);
      textEmitTimer = null;
    }
    if (textDirty) emitTextUpdate();
    if (thinkingEmitTimer) {
      clearTimeout(thinkingEmitTimer);
      thinkingEmitTimer = null;
    }
    if (thinkingDirty) emitThinkingUpdate();
  };

  try {
    const allToolsCompleted = () => (
      stream.toolUsesArray.length > 0
      && stream.toolUsesArray.every((tool) => stream.toolResultsArray.some((result) => result.tool_use_id === tool.id))
    );
    const consumeActivityText = () => {
      if (stream.toolUsesArray.length > 0 && !allToolsCompleted()) {
        stream.activityTextLength = stream.accumulatedText.length;
      }
    };

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        content: effectiveContent,
        ...(params.clientMessageId ? { client_message_id: params.clientMessageId } : {}),
        mode: params.mode,
        model: params.model,
        provider_id: params.providerId,
        ...(params.files && params.files.length > 0 ? { files: params.files } : {}),
        ...(params.mentions && params.mentions.length > 0 ? { mentions: params.mentions } : {}),
        ...(params.systemPromptAppend ? { systemPromptAppend: params.systemPromptAppend } : {}),
        ...(params.autoTrigger ? { autoTrigger: true } : {}),
        ...(params.effort ? { effort: params.effort } : {}),
        ...(params.thinking ? { thinking: params.thinking } : {}),
        ...(params.context1m ? { context_1m: true } : {}),
        ...(params.displayOverride ? { displayOverride: params.displayOverride } : {}),
      }),
      signal: stream.abortController.signal,
    });

    if (!response.ok) {
      let err: any = {};
      let rawText = '';
      try {
        rawText = await response.text();
        err = JSON.parse(rawText);
      } catch (e) {
        err = { raw: rawText };
      }

      if (err?.code === 'NEEDS_PROVIDER_SETUP' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('open-setup-center', {
          detail: { initialCard: err.initialCard ?? 'provider' },
        }));
      }
      
      // 特殊处理 413 Payload Too Large，这是由于 Electron Standalone Server 的内置大小限制导致的
      if (response.status === 413) {
        throw new Error('请求体积过大：发送的消息、附件或提及的文件过多。请减少内容后重试。');
      }
      
      const fallbackMsg = `Failed to send message (HTTP ${response.status}). ${err.raw ? 'Raw response: ' + err.raw.slice(0, 200) : ''}`;
      throw new Error(err?.error || err?.message || fallbackMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const result = await consumeSSEStream(reader, {
      onText: (acc) => {
        markActive();
        // Clear "正在处理结果..." status when parent starts producing text
        if (stream.snapshot.statusText === '正在处理子任务结果…') {
          stream.snapshot = { ...stream.snapshot, statusText: undefined };
          emit(stream, 'snapshot-updated');
        }
        stream.accumulatedText = acc;
        consumeActivityText();
        stream.thinkingPhaseEnded = true;
        throttledTextEmit();
      },
      onUserMessageAck: (data) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('chat:user-message-acked', {
            detail: {
              sessionId: params.sessionId,
              clientMessageId: data.clientMessageId,
              serverMessageId: data.serverMessageId,
              createdAt: data.createdAt,
            },
          }));
        }
      },
      onThinking: (delta) => {
        markActive();
        // Clear "正在处理结果..." status when parent starts producing content
        if (stream.snapshot.statusText === '正在处理子任务结果…') {
          stream.snapshot = { ...stream.snapshot, statusText: undefined };
          emit(stream, 'snapshot-updated');
        }
        // If non-thinking content has arrived since last thinking delta,
        // this is a new thinking phase (e.g. after a tool_use round-trip).
        // Reset the live accumulator so the UI shows only the current phase.
        if (stream.thinkingPhaseEnded) {
          // Save previous thinking to full history before resetting
          if (stream.accumulatedThinking) {
            stream.fullThinking += (stream.fullThinking ? '\n\n---\n\n' : '') + stream.accumulatedThinking;
          }
          stream.accumulatedThinking = '';
          stream.thinkingPhaseEnded = false;
        }
        stream.accumulatedThinking += delta;
        throttledThinkingEmit();
      },
      // 中文注释：功能名称「子Agent思考路由」，用法是将子Agent的思考内容增量路由到
      // 对应子Agent的progress字段，而非主Agent的accumulatedThinking，
      // 解决子Agent思考内容出现在主时间线思考卡片中的问题。
      onSubAgentThinking: (parentAgentId, delta) => {
        markActive();
        const idx = stream.subAgents.findIndex(a => a.id === parentAgentId);
        if (idx >= 0) {
          const updated = [...stream.subAgents];
          const oldProgress = updated[idx].progress || '';
          // 保留最近的思考内容，避免无限增长
          const newProgress = oldProgress + delta;
          updated[idx] = {
            ...updated[idx],
            progress: newProgress.length > 10000 ? '...' + newProgress.slice(-10000) : newProgress,
          };
          stream.subAgents = updated;
          emit(stream, 'snapshot-updated');
        }
      },
      onToolUse: (tool) => {
        markActive();
        flushTextThrottle(); // Ensure text is up-to-date before tool events
        stream.thinkingPhaseEnded = true;
        stream.toolOutputAccumulated = '';
        const existingIdx = stream.toolUsesArray.findIndex(t => t.id === tool.id);
        if (existingIdx >= 0) {
          const existing = stream.toolUsesArray[existingIdx] as typeof tool;
          const existingInput = existing?.input as Record<string, unknown> | undefined;
          const incomingInput = tool?.input as Record<string, unknown> | undefined;
          const shouldReplace =
            !existingInput
            || existingInput._synthetic === true
            || (typeof existingInput === 'object' && Object.keys(existingInput).length === 0)
            || (incomingInput && typeof incomingInput === 'object' && Object.keys(incomingInput).length > Object.keys(existingInput || {}).length);
          if (shouldReplace) {
            const next = [...stream.toolUsesArray];
            next[existingIdx] = tool;
            stream.toolUsesArray = next;
          }
        } else {
          stream.activityTextLength = stream.accumulatedText.length;
          stream.toolUsesArray = [...stream.toolUsesArray, tool];
        }
        emit(stream, 'snapshot-updated');
      },
      onToolResult: (res) => {
        markActive();
        stream.toolOutputAccumulated = '';
        const existingIdx = stream.toolResultsArray.findIndex(r => r.tool_use_id === res.tool_use_id);
        if (existingIdx >= 0) {
          const next = [...stream.toolResultsArray];
          next[existingIdx] = res;
          stream.toolResultsArray = next;
        } else {
          stream.toolResultsArray = [...stream.toolResultsArray, res];
        }
        emit(stream, 'snapshot-updated');
        // Refresh file tree after each tool completes
        window.dispatchEvent(new Event('refresh-file-tree'));
      },
      onToolOutput: (data) => {
        markActive();
        const next = stream.toolOutputAccumulated + data;
        stream.toolOutputAccumulated = next.length > 5000 ? next.slice(-5000) : next;
        emit(stream, 'snapshot-updated');
      },
      onToolProgress: (toolName, elapsed) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, statusText: `Running ${toolName}... (${elapsed}s)` };
        emit(stream, 'snapshot-updated');
      },
      onSkillNudge: (data) => {
        // Broadcast as window event — ChatView listens and renders a
        // persistent banner. We don't use the snapshot because the nudge
        // should persist after the stream completes (snapshot gets cleared).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('skill-nudge', {
            detail: { sessionId: params.sessionId, ...data },
          }));
        }
      },
      onContextCompressed: (data) => {
        markActive();
        // Dispatch the 'context-compressed' window event that ChatView
        // uses to flip hasSummary state and show the context indicator.
        // Also show a brief human-readable status line so the user knows
        // compression happened.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('context-compressed', {
            detail: { sessionId: params.sessionId, ...data },
          }));
        }
        // Show the compression message briefly in the status bar
        if (data.message) {
          stream.snapshot = { ...stream.snapshot, statusText: data.message };
          emit(stream, 'snapshot-updated');
          streamTimeout(stream, () => {
            if (stream.snapshot.statusText === data.message) {
              stream.snapshot = { ...stream.snapshot, statusText: undefined };
              emit(stream, 'snapshot-updated');
            }
          }, 5000); // Show for 5s so user can read it
        }
      },
      onReferencedContexts: (files) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, referencedContexts: files };
        emit(stream, 'snapshot-updated');
      },
      onToolFiles: (files) => {
        markActive();
        // Merge tool files with existing toolFiles, avoiding duplicates
        const existing = stream.snapshot.toolFiles || [];
        const merged = [...existing];
        files.forEach(f => {
          if (!merged.includes(f)) merged.push(f);
        });
        stream.snapshot = { ...stream.snapshot, toolFiles: merged };
        emit(stream, 'snapshot-updated');
      },
      onStatusPayload: (payload) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, statusPayload: payload };
        emit(stream, 'snapshot-updated');
      },
      onStatus: (text) => {
        markActive();
        if (text === 'context_compressing_retry') {
          // Show a brief status while PTL auto-retry is in progress
          stream.snapshot = { ...stream.snapshot, statusText: 'Compressing context...' };
          emit(stream, 'snapshot-updated');
          return;
        }
        if (text?.startsWith('Connected (')) {
          stream.snapshot = { ...stream.snapshot, statusText: text };
          emit(stream, 'snapshot-updated');
          streamTimeout(stream, () => {
            // Only clear if still the same status
            if (stream.snapshot.statusText === text) {
              stream.snapshot = { ...stream.snapshot, statusText: undefined };
              emit(stream, 'snapshot-updated');
            }
          }, 2000);
        } else {
          stream.snapshot = { ...stream.snapshot, statusText: text };
          emit(stream, 'snapshot-updated');
        }
      },
      onResult: (usage, meta) => {
        markActive();
        stream.snapshot = {
          ...stream.snapshot,
          tokenUsage: usage,
          ...(meta?.terminalReason ? { terminalReason: meta.terminalReason } : {}),
        };
      },
      onRateLimit: (info) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, rateLimitInfo: info };
        emit(stream, 'snapshot-updated');
      },
      onContextUsage: (snap) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, contextUsageSnapshot: snap };
        emit(stream, 'snapshot-updated');
      },
      onPermissionRequest: (permData) => {
        markActive();
        stream.snapshot = {
          ...stream.snapshot,
          pendingPermission: permData,
          permissionResolved: null,
        };
        emit(stream, 'permission-request');
      },
      onToolTimeout: (toolName, elapsedSeconds) => {
        markActive();
        stream.toolTimeoutInfo = { toolName, elapsedSeconds };
      },
      onModeChanged: (sdkMode) => {
        markActive();
        if (params.onModeChanged) {
          params.onModeChanged(sdkMode);
        }
      },
      onTaskUpdate: () => {
        markActive();
        window.dispatchEvent(new CustomEvent('tasks-updated'));
      },
      onRewindPoint: (sdkUserMessageId) => {
        markActive();
        stream.rewindPoints = [...stream.rewindPoints, { userMessageId: sdkUserMessageId }];
      },
      onKeepAlive: () => {
        markActive();
      },
      onError: (acc) => {
        markActive();
        stream.accumulatedText = acc;
        emit(stream, 'snapshot-updated');
      },
      onInitMeta: (meta) => {
        markActive();
        params.onInitMeta?.(meta);
      },
      onSubAgentStart: (data) => {
        markActive();
        const agent: SubAgentInfo = {
          id: data.id,
          name: data.name,
          displayName: data.displayName,
          prompt: data.prompt,
          status: 'running',
          startedAt: Date.now(),
          model: data.model,
          source: data.source,
        };
        const updated = [...stream.subAgents, agent];
        stream.subAgents = updated;
        emit(stream, 'snapshot-updated');
        window.dispatchEvent(new CustomEvent('subagents-sync', { detail: { sessionId: params.sessionId, subAgents: updated } }));
        // Dispatch window event for sub-agent timeline UI
        window.dispatchEvent(new CustomEvent('subagent-start', { detail: { sessionId: params.sessionId, ...data } }));
        // 中文注释：功能名称「子Agent超时清理」，用法是为每个子Agent设置空闲超时定时器，
        // 如果5分钟内没有收到任何进度更新或完成事件，自动标记为超时完成，
        // 避免空智能体或卡死的子Agent导致主Agent无限等待
        const SUBAGENT_IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes — 60s was too aggressive for slow providers
        const startTimer = () => {
          const existing = stream.subAgentTimers.get(data.id);
          if (existing) {
            clearTimeout(existing);
            stream.pendingTimers.delete(existing);
          }
          const timer = setTimeout(() => {
            const idx = stream.subAgents.findIndex(a => a.id === data.id);
            if (idx >= 0 && stream.subAgents[idx].status === 'running') {
              const updatedAgents = [...stream.subAgents];
              updatedAgents[idx] = {
                ...updatedAgents[idx],
                status: 'error',
                error: '超时：5分钟内无活动，已自动清理',
                completedAt: Date.now(),
              };
              stream.subAgents = updatedAgents;
              emit(stream, 'snapshot-updated');
              window.dispatchEvent(new CustomEvent('subagents-sync', { detail: { sessionId: params.sessionId, subAgents: updatedAgents } }));
              window.dispatchEvent(new CustomEvent('subagent-complete', {
                detail: { sessionId: params.sessionId, id: data.id, error: '超时：60秒内无活动，已自动清理' },
              }));
            }
            stream.subAgentTimers.delete(data.id);
            stream.pendingTimers.delete(timer);
          }, SUBAGENT_IDLE_TIMEOUT_MS);
          stream.subAgentTimers.set(data.id, timer);
          stream.pendingTimers.add(timer);
        };
        startTimer();
      },
      onSubAgentProgress: (data: { id: string; status: string; detail?: string; append?: boolean }) => {
        markActive();
        // 中文注释：功能名称「子Agent进度超时重置」，用法是收到进度更新时重置空闲超时定时器，
        // 确保正常工作的子Agent不会被误清理
        const existingTimer = stream.subAgentTimers.get(data.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
          stream.pendingTimers.delete(existingTimer);
          const SUBAGENT_IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes
          const timer = setTimeout(() => {
            const idx = stream.subAgents.findIndex(a => a.id === data.id);
            if (idx >= 0 && stream.subAgents[idx].status === 'running') {
              const updatedAgents = [...stream.subAgents];
              updatedAgents[idx] = {
                ...updatedAgents[idx],
                status: 'error',
                error: '超时：5分钟内无活动，已自动清理',
                completedAt: Date.now(),
              };
              stream.subAgents = updatedAgents;
              emit(stream, 'snapshot-updated');
              window.dispatchEvent(new CustomEvent('subagents-sync', { detail: { sessionId: params.sessionId, subAgents: updatedAgents } }));
              window.dispatchEvent(new CustomEvent('subagent-complete', {
                detail: { sessionId: params.sessionId, id: data.id, error: '超时：60秒内无活动，已自动清理' },
              }));
            }
            stream.subAgentTimers.delete(data.id);
            stream.pendingTimers.delete(timer);
          }, SUBAGENT_IDLE_TIMEOUT_MS);
          stream.subAgentTimers.set(data.id, timer);
          stream.pendingTimers.add(timer);
        }
        const idx = stream.subAgents.findIndex(a => a.id === data.id);
        if (idx >= 0) {
          const updated = [...stream.subAgents];
          const oldProgress = updated[idx].progress || '';
          const newProgress = data.append ? oldProgress + (data.detail || '') : (data.detail || '');
          updated[idx] = { 
            ...updated[idx], 
            progress: newProgress.length > 10000 ? '...' + newProgress.slice(-10000) : newProgress 
          };
          stream.subAgents = updated;
          emit(stream, 'snapshot-updated');
          window.dispatchEvent(new CustomEvent('subagents-sync', { detail: { sessionId: params.sessionId, subAgents: updated } }));
        }
        window.dispatchEvent(new CustomEvent('subagent-progress', { detail: { sessionId: params.sessionId, ...data } }));
      },
    onSubAgentComplete: (data) => {
      markActive();
      // 中文注释：功能名称「子Agent完成清理定时器」，用法是子Agent完成时清除其空闲超时定时器
      const existingTimer = stream.subAgentTimers.get(data.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        stream.pendingTimers.delete(existingTimer);
        stream.subAgentTimers.delete(data.id);
      }
      const idx = stream.subAgents.findIndex(a => a.id === data.id);
      if (idx >= 0) {
        const updated = [...stream.subAgents];
        updated[idx] = {
          ...updated[idx],
          status: data.error ? 'error' : 'completed',
          report: data.report,
          error: data.error,
          completedAt: Date.now(),
        };
        stream.subAgents = updated;
        emit(stream, 'snapshot-updated');
        window.dispatchEvent(new CustomEvent('subagents-sync', { detail: { sessionId: params.sessionId, subAgents: updated } }));
      }
      // 中文注释：功能名称「子Agent全部完成后状态提示」，用法是所有子Agent完成后
      // 设置statusText为"正在处理结果..."，让用户知道父Agent仍在工作。
      // 当父Agent产生新的thinking/text时，onThinking/onText会清除该状态。
      const allDone = stream.subAgents.length > 0 && stream.subAgents.every(
        a => a.status === 'completed' || a.status === 'error'
      );
      if (allDone) {
        stream.snapshot = {
          ...stream.snapshot,
          statusText: '正在处理子任务结果…',
        };
        emit(stream, 'snapshot-updated');
      }
        window.dispatchEvent(new CustomEvent('subagent-complete', { detail: { sessionId: params.sessionId, ...data } }));
      },
    });

    // Flush any pending throttled text update before building final content
    flushTextThrottle();

    // Stream completed successfully — build final message content
    const accumulated = result.accumulated;
    const finalToolUses = stream.toolUsesArray;
    const finalToolResults = stream.toolResultsArray;
    const hasTools = finalToolUses.length > 0 || finalToolResults.length > 0;

    const rawFinalAnswerText = hasTools
      ? accumulated.slice(stream.activityTextLength).trim()
      : accumulated.trim();
    const finalAnswerText = stripLeakedTransportContent(rawFinalAnswerText);
    let messageContent = finalAnswerText;
    // Combine all thinking phases for persistence
    const allThinking = [stream.fullThinking, stream.accumulatedThinking]
      .filter(s => s.trim()).join('\n\n---\n\n');
    const hasThinking = allThinking.length > 0;
    const hasSubAgents = stream.subAgents && stream.subAgents.length > 0;

    if (hasTools || hasThinking || hasSubAgents) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      // Include thinking block if present — rendered as collapsed Reasoning in MessageItem
      if (hasThinking) {
        contentBlocks.push({ type: 'thinking', thinking: allThinking });
      }
      for (const tu of finalToolUses) {
        contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        const tr = finalToolResults.find(r => r.tool_use_id === tu.id);
        if (tr) {
          contentBlocks.push({
            type: 'tool_result',
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            ...(tr.is_error ? { is_error: true } : {}),
            ...(tr.media && tr.media.length > 0 ? { media: tr.media } : {}),
          });
        }
      }
      if (finalAnswerText) {
        contentBlocks.push({ type: 'text', text: finalAnswerText });
      }
      if (hasSubAgents) {
        contentBlocks.push({ type: 'sub_agents', subAgents: stream.subAgents });
      }
      messageContent = JSON.stringify(contentBlocks);
    } else if (hasSubAgents) {
      // Handles case where there are no tools and no thinking, but there are subagents
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (finalAnswerText) {
        contentBlocks.push({ type: 'text', text: finalAnswerText });
      }
      contentBlocks.push({ type: 'sub_agents', subAgents: stream.subAgents });
      messageContent = JSON.stringify(contentBlocks);
    }

    // Update snapshot with completion info
    const isAborted = stream.snapshot.terminalReason === 'aborted' ||
      stream.snapshot.terminalReason === 'user_cancel' ||
      stream.snapshot.terminalReason === 'error';
    const finalPhase = isAborted ? 'aborted' : 'completed';
    stream.snapshot = {
      ...buildSnapshot(stream),
      phase: finalPhase,
      completedAt: Date.now(),
      tokenUsage: result.tokenUsage,
      finalMessageContent: messageContent || null,
      statusText: undefined,
      statusPayload: undefined,
      pendingPermission: null,
      permissionResolved: null,
    };
    stream.accumulatedText = '';
    stream.activityTextLength = 0;
    stream.accumulatedThinking = '';
    stream.fullThinking = '';
    stream.thinkingPhaseEnded = false;
    stream.toolUsesArray = [];
    stream.toolResultsArray = [];
    stream.toolOutputAccumulated = '';

    cleanupTimers(stream);
    emit(stream, 'completed');
    scheduleGC(stream);

    // Refresh file tree after completion
    window.dispatchEvent(new CustomEvent('refresh-file-tree'));

  } catch (error) {
    flushTextThrottle();
    cleanupTimers(stream);

    // Helper: build finalMessageContent preserving any accumulated thinking.
    // On error/stop branches we previously only serialized accumulatedText,
    // silently dropping reasoning blocks that the user had already seen.
    const buildFinalContent = (textContent: string | null): string | null => {
      const allThinking = [stream.fullThinking, stream.accumulatedThinking]
        .filter(s => s.trim()).join('\n\n---\n\n');
      const hasSubAgents = stream.subAgents && stream.subAgents.length > 0;
      if (!allThinking && !hasSubAgents) return textContent;
      // Wrap as content-block JSON so MessageItem can render the thinking block
      const blocks: Array<Record<string, unknown>> = [];
      if (allThinking) {
        blocks.push({ type: 'thinking', thinking: allThinking });
      }
      if (textContent) blocks.push({ type: 'text', text: textContent });
      if (hasSubAgents) {
        blocks.push({ type: 'sub_agents', subAgents: stream.subAgents });
      }
      return JSON.stringify(blocks);
    };

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (stream.isIdleTimeout) {
        const isThinking = !stream.thinkingPhaseEnded && stream.accumulatedThinking.length > 0;
        const timeoutMs = isThinking ? STREAM_THINKING_IDLE_TIMEOUT_MS : STREAM_IDLE_TIMEOUT_MS;
        const idleSecs = Math.round(timeoutMs / 1000);
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n**Error:** Stream idle timeout — no response for ${idleSecs}s${isThinking ? ' (extended thinking mode)' : ''}. The connection may have dropped.`
          : `**Error:** Stream idle timeout — no response for ${idleSecs}s${isThinking ? ' (extended thinking mode)' : ''}. The connection may have dropped.`;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'error',
          completedAt: Date.now(),
          error: `Stream idle timeout (${idleSecs}s)`,
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          statusPayload: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.activityTextLength = 0;
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        emit(stream, 'completed');
        // Clear stale SDK session so next message starts fresh
        fetch(`/api/chat/sessions/${encodeURIComponent(stream.sessionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdk_session_id: '' }),
        }).catch(() => {});
        scheduleGC(stream);
      } else if (stream.toolTimeoutInfo) {
        // Tool timeout — auto-retry
        const timeoutInfo = stream.toolTimeoutInfo;
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n*(tool ${timeoutInfo.toolName} timed out after ${timeoutInfo.elapsedSeconds}s)*`
          : null;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'stopped',
          completedAt: Date.now(),
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          statusPayload: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.activityTextLength = 0;
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.toolTimeoutInfo = null;
        emit(stream, 'completed');
        scheduleGC(stream);

        // Auto-retry via sendMessageFn
        if (stream.sendMessageFn) {
          const fn = stream.sendMessageFn;
          streamTimeout(stream, () => {
            fn(
              `The previous tool "${timeoutInfo.toolName}" timed out after ${timeoutInfo.elapsedSeconds} seconds. Please try a different approach to accomplish the task. Avoid repeating the same operation that got stuck.`
            );
          }, 500);
        }
      } else if (stream.abortReason === 'stream_replaced') {
        // 中文注释：功能名称「流替换静默结束」，用法是在会话切换、页面热更新或重新发起
        // 同会话请求时静默终止旧流，不把它显示成“生成停止”或异常，避免制造假失败体感。
        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'completed',
          completedAt: Date.now(),
          statusText: undefined,
          statusPayload: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.activityTextLength = 0;
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        emit(stream, 'completed');
        scheduleGC(stream);
      } else {
        // User manually stopped — add partial content with "(generation stopped)"
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + '\n\n*(generation stopped)*'
          : null;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'stopped',
          completedAt: Date.now(),
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          statusPayload: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.activityTextLength = 0;
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        emit(stream, 'completed');
        scheduleGC(stream);
      }
    } else {
      // Non-abort error
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      stream.snapshot = {
        ...buildSnapshot(stream),
        phase: 'error',
        completedAt: Date.now(),
        error: errMsg,
        finalMessageContent: buildFinalContent(`**Error:** ${errMsg}`),
        statusText: undefined,
        statusPayload: undefined,
        pendingPermission: null,
        permissionResolved: null,
      };
      stream.accumulatedText = '';
      stream.activityTextLength = 0;
      stream.accumulatedThinking = '';
      stream.fullThinking = '';
      stream.toolUsesArray = [];
      stream.toolResultsArray = [];
      stream.toolOutputAccumulated = '';
      emit(stream, 'completed');
      scheduleGC(stream);
    }
  }
}

// ==========================================
// Stop
// ==========================================

export function stopStream(sessionId: string, warmupModel?: string, warmupProviderId?: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase === 'active') {
    stream.abortReason = 'manual_stop';
    // Abort the stream immediately so the UI stops showing output
    stream.abortController.abort();
    // Clean up the server-side process in the background
    fetch('/api/chat/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Interrupt failed, best effort
    });
    // 中文注释：中断后触发预热，避免下一条消息走冷启动。
    // 使用 1.5 秒延迟确保障服务端 interrupt 已完成清理、旧 persistent session 已销毁，
    // 然后再创建新的预热进程。
    if (warmupModel) {
      setTimeout(() => {
        fetch('/api/chat/warmup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, model: warmupModel, provider_id: warmupProviderId || '' }),
        }).catch(() => {});
      }, 1500);
    }
  }
}

// ==========================================
// Subscribe
// ==========================================

export function subscribe(sessionId: string, listener: StreamEventListener): () => void {
  const listenersMap = getListenersMap();
  let listeners = listenersMap.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    listenersMap.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      listenersMap.delete(sessionId);
    }
  };
}

// ==========================================
// Snapshot access
// ==========================================

export function getSnapshot(sessionId: string): SessionStreamSnapshot | null {
  const stream = getStreamsMap().get(sessionId);
  if (!stream) return null;
  // Don't return stale placeholder entries
  if (stream.snapshot.startedAt === 0) return null;
  return stream.snapshot;
}

export function isStreamActive(sessionId: string): boolean {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot.phase === 'active' || false;
}

export function getRewindPoints(sessionId: string): Array<{ userMessageId: string }> {
  const stream = getStreamsMap().get(sessionId);
  return stream?.rewindPoints ?? [];
}

export function getActiveSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, stream] of getStreamsMap()) {
    if (stream.snapshot.phase === 'active') {
      ids.push(id);
    }
  }
  return ids;
}

// ==========================================
// Permission response
// ==========================================

export async function respondToPermission(
  sessionId: string,
  decision: 'allow' | 'allow_session' | 'deny',
  updatedInput?: Record<string, unknown>,
  denyMessage?: string,
): Promise<void> {
  const stream = getStreamsMap().get(sessionId);
  if (!stream || !stream.snapshot.pendingPermission) return;

  const perm = stream.snapshot.pendingPermission;

  const body = {
    permissionRequestId: perm.permissionRequestId,
    decision: decision === 'deny'
      ? { behavior: 'deny' as const, message: denyMessage || 'User denied permission' }
      : {
          behavior: 'allow' as const,
          ...(decision === 'allow_session' && perm.suggestions
            ? { updatedPermissions: perm.suggestions }
            : {}),
          ...(updatedInput ? { updatedInput } : {}),
        },
  };

  // Update snapshot immediately
  stream.snapshot = {
    ...stream.snapshot,
    permissionResolved: decision === 'deny' ? 'deny' : 'allow',
  };
  emit(stream, 'snapshot-updated');

  try {
    const response = await fetch('/api/chat/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 409) {
        console.warn(`[permission] Request already resolved or aborted: ${perm.permissionRequestId}`);
        return; // Harmless, skip throwing error to avoid console spam
      }
      console.error('[permission] POST /api/chat/permission failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errBody,
        permissionRequestId: perm.permissionRequestId,
        hasUpdatedInput: !!updatedInput,
        answerKeys: updatedInput ? Object.keys(updatedInput) : [],
      });
      throw new Error(`Permission server error: ${errBody.error || response.statusText} (status ${response.status})`);
    }
  } catch (e) {
    console.error('[permission] respondToPermission error:', e);
  }

  // Clear permission state after delay (only if no new request arrived)
  const answeredId = perm.permissionRequestId;
  streamTimeout(stream, () => {
    if (stream.snapshot.pendingPermission?.permissionRequestId === answeredId) {
      stream.snapshot = {
        ...stream.snapshot,
        pendingPermission: null,
        permissionResolved: null,
      };
      emit(stream, 'snapshot-updated');
    }
  }, 1000);
}

// ==========================================
// Cleanup
// ==========================================

export function clearSnapshot(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase !== 'active') {
    if (stream.gcTimer) clearTimeout(stream.gcTimer);
    // Reset the snapshot (listeners are in a separate registry)
    stream.snapshot = {
      ...stream.snapshot,
      startedAt: 0,
      finalMessageContent: null,
    };
  }
}

/**
 * Seed a snapshot with initial patch for paths that don't go through
 * startStream() — currently only the first-message flow in
 * `app/chat/page.tsx`, which hand-parses SSE, creates a session row, and
 * redirects to /chat/[id]. Without this seed, the snapshot the redirected
 * ChatView reads is null and first-turn signals (terminal_reason,
 * rate_limit_info) never reach the chip/banner UI.
 *
 * Registers a minimal ActiveStream with phase='completed' if none exists.
 * If a full stream is already registered (shouldn't normally happen on
 * first turn), just merges the patch into the existing snapshot.
 */
export function seedSnapshotPatch(
  sessionId: string,
  patch: Partial<SessionStreamSnapshot>,
): void {
  const map = getStreamsMap();
  const existing = map.get(sessionId);
  if (existing) {
    existing.snapshot = { ...existing.snapshot, ...patch };
    emit(existing, 'snapshot-updated');
    return;
  }
  // Register a placeholder stream. It's not 'active' so the ChatView will
  // treat it as post-stream state; no subscription wiring needed because
  // the ChatView that reads it will re-subscribe on mount (its own useEffect).
  const placeholder: ActiveStream = {
    sessionId,
    abortController: new AbortController(),
    abortReason: null,
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    gcTimer: null,
    pendingTimers: new Set(),
    accumulatedText: '',
    activityTextLength: 0,
    accumulatedThinking: '',
    fullThinking: '',
    thinkingPhaseEnded: false,
    toolUsesArray: [],
    toolResultsArray: [],
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    sendMessageFn: null,
    rewindPoints: [],
    subAgents: [],
    subAgentTimers: new Map(),
    snapshot: {
      sessionId,
      phase: 'completed',
      streamingContent: '',
      streamingThinkingContent: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
      tokenUsage: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      error: null,
      // 中文注释：功能名称「工具文件占位初始化」，用法是占位快照中初始化toolFiles为空数组
      toolFiles: [],
      finalMessageContent: null,
      ...patch,
    },
  };
  map.set(sessionId, placeholder);
}
