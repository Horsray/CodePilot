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
import type {
  ToolUseInfo,
  ToolResultInfo,
  SessionStreamSnapshot,
  StreamEvent,
  StreamEventListener,
  TokenUsage,
  PermissionRequestEvent,
  FileAttachment,
} from '@/types';

// ==========================================
// Internal types
// ==========================================

interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  snapshot: SessionStreamSnapshot;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  lastTransportEventTime: number;
  lastMeaningfulEventTime: number;
  lastKeepAliveTime: number;
  gcTimer: ReturnType<typeof setTimeout> | null;
  /** Tracked ad-hoc timeouts — cleaned up when the stream ends. */
  pendingTimers: Set<ReturnType<typeof setTimeout>>;
  // Mutable accumulators (snapshot gets new object refs on each emit)
  accumulatedText: string;
  accumulatedThinking: string;
  /** All thinking blocks concatenated (preserved for finalMessageContent) */
  fullThinking: string;
  /** Tracks whether non-thinking content has arrived since last thinking delta */
  thinkingPhaseEnded: boolean;
  toolUsesArray: ToolUseInfo[];
  toolResultsArray: ToolResultInfo[];
  toolOutputAccumulated: string;
  toolTimeoutInfo: { toolName: string; elapsedSeconds: number } | null;
  activeToolExecution: { toolId: string; toolName: string; startedAt: number } | null;
  abortReason: 'transport_idle' | 'no_meaningful_progress' | null;
  sendMessageFn: ((content: string, files?: FileAttachment[]) => void) | null;
  rewindPoints: Array<{ userMessageId: string }>;
  referencedContexts: string[];
}

export interface StartStreamParams {
  sessionId: string;
  content: string;
  mode: string;
  model: string;
  providerId: string;
  files?: FileAttachment[];
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
  onInitMeta?: (meta: { tools?: unknown; slash_commands?: unknown; skills?: unknown }) => void;
  /** Display-only content for user message (e.g. /skillName instead of expanded prompt) */
  displayOverride?: string;
}

// ==========================================
// Singleton via globalThis
// ==========================================

const GLOBAL_KEY = '__streamSessionManager__' as const;
const LISTENERS_KEY = '__streamSessionListeners__' as const;
const STREAM_IDLE_TIMEOUT_MS = 330_000;
const STREAM_MEANINGFUL_PROGRESS_TIMEOUT_MS = 300_000; // Increased to 5 minutes to match backend
const MCP_TOOL_TIMEOUT_MS = 60_000; // Increased to 1 minute
const GC_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function isMcpTool(toolName?: string | null): boolean {
  return !!toolName && toolName.startsWith('mcp__');
}

function makeSyntheticToolErrorResult(
  toolUseId: string,
  toolName: string,
  reason: string,
): ToolResultInfo {
  return {
    tool_use_id: toolUseId,
    content: `[tool-error] ${toolName}: ${reason}`,
    is_error: true,
  };
}

function upsertToolResult(stream: ActiveStream, res: ToolResultInfo): void {
  const existingIdx = stream.toolResultsArray.findIndex((item) => item.tool_use_id === res.tool_use_id);
  if (existingIdx >= 0) {
    const next = [...stream.toolResultsArray];
    next[existingIdx] = res;
    stream.toolResultsArray = next;
  } else {
    stream.toolResultsArray = [...stream.toolResultsArray, res];
  }
}

function buildStructuredFinalContent(stream: ActiveStream, textContent: string | null): string | null {
  const allThinking = [stream.fullThinking, stream.accumulatedThinking]
    .filter((s) => s.trim())
    .join('\n\n---\n\n');

  const blocks: Array<Record<string, unknown>> = [];
  if (allThinking) {
    blocks.push({ type: 'thinking', thinking: allThinking });
  }
  if (textContent) {
    blocks.push({ type: 'text', text: textContent });
  }
  for (const tu of stream.toolUsesArray) {
    blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    const tr = stream.toolResultsArray.find((r) => r.tool_use_id === tu.id);
    if (tr) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        ...(tr.is_error ? { is_error: true } : {}),
        ...(tr.media && tr.media.length > 0 ? { media: tr.media } : {}),
      });
    }
  }

  if (blocks.length === 0) return null;
  if (blocks.length === 1 && blocks[0].type === 'text') return textContent;
  return JSON.stringify(blocks);
}

function clearServerSdkSession(sessionId: string): void {
  fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdk_session_id: '' }),
  }).catch(() => {});
}

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
    streamingThinkingContent: stream.fullThinking
      ? stream.fullThinking + '\n\n---\n\n' + stream.accumulatedThinking
      : stream.accumulatedThinking,
    toolUses: [...stream.toolUsesArray],
    toolResults: [...stream.toolResultsArray],
    streamingToolOutput: stream.toolOutputAccumulated,
    statusText: stream.snapshot.statusText,
    pendingPermission: stream.snapshot.pendingPermission,
    permissionResolved: stream.snapshot.permissionResolved,
    tokenUsage: stream.snapshot.tokenUsage,
    startedAt: stream.snapshot.startedAt,
    completedAt: stream.snapshot.completedAt,
    error: stream.snapshot.error,
    referencedContexts: [...stream.referencedContexts],
    finalMessageContent: stream.snapshot.finalMessageContent,
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
    existing.abortController.abort();
    cleanupTimers(existing);
  }

  const abortController = new AbortController();

  const stream: ActiveStream = {
    sessionId: params.sessionId,
    abortController,
    snapshot: {
      sessionId: params.sessionId,
      phase: 'active',
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
      completedAt: null,
      error: null,
      finalMessageContent: null,
    },
    idleCheckTimer: null,
    lastTransportEventTime: Date.now(),
    lastMeaningfulEventTime: Date.now(),
    lastKeepAliveTime: 0,
    gcTimer: null,
    pendingTimers: new Set(),
    accumulatedText: '',
    accumulatedThinking: '',
    fullThinking: '',
    thinkingPhaseEnded: false,
    toolUsesArray: [],
    toolResultsArray: [],
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    activeToolExecution: null,
    abortReason: null,
    sendMessageFn: params.sendMessageFn ?? null,
    rewindPoints: [],
    referencedContexts: [],
  };

  map.set(params.sessionId, stream);
  emit(stream, 'phase-changed');

  // Run the stream in background (non-blocking)
  runStream(stream, params).catch(() => {});
}

async function runStream(stream: ActiveStream, params: StartStreamParams): Promise<void> {
  // 中文注释：功能名称「传输活跃心跳」，用法是在收到任意 SSE 事件时刷新链路时间，
  // 仅用于判断连接是否断开，不代表模型真的还在推进。
  const markTransportActive = () => { stream.lastTransportEventTime = Date.now(); };
  // 中文注释：功能名称「有效进展打点」，用法是在收到文本、思维、工具开始/结束、工具进度等真实推进事件时刷新，
  // 避免 keep_alive 心跳把“假活跃”误判成正常推理。
  const markMeaningfulProgress = () => {
    const now = Date.now();
    stream.lastTransportEventTime = now;
    stream.lastMeaningfulEventTime = now;
  };

  // 中文注释：功能名称「双层 watchdog」，用法是区分“连接断开”和“有心跳但无有效进展”两类卡死。
  stream.idleCheckTimer = setInterval(() => {
    const now = Date.now();
    const activeToolTimeoutMs = isMcpTool(stream.activeToolExecution?.toolName)
      ? MCP_TOOL_TIMEOUT_MS
      : STREAM_MEANINGFUL_PROGRESS_TIMEOUT_MS;

    if (now - stream.lastMeaningfulEventTime >= activeToolTimeoutMs) {
      cleanupTimers(stream);
      // 中文注释：功能名称「工具卡死转工具超时」，用法是在某个工具运行中长时间无进展时，
      // 优先走 tool-timeout 分支，把错误反馈给 AI 继续修复，而不是直接落成全局 90s 中止。
      if (stream.activeToolExecution) {
        stream.toolTimeoutInfo = {
          toolName: stream.activeToolExecution.toolName,
          elapsedSeconds: Math.max(1, Math.round((now - stream.activeToolExecution.startedAt) / 1000)),
        };
        upsertToolResult(
          stream,
          makeSyntheticToolErrorResult(
            stream.activeToolExecution.toolId,
            stream.activeToolExecution.toolName,
            `timed out after ${Math.max(1, Math.round((now - stream.activeToolExecution.startedAt) / 1000))}s`,
          ),
        );
        stream.abortReason = null;
      } else {
        stream.abortReason = 'no_meaningful_progress';
      }
      stream.abortController.abort();
      return;
    }
    if (now - stream.lastTransportEventTime >= STREAM_IDLE_TIMEOUT_MS) {
      cleanupTimers(stream);
      stream.abortReason = 'transport_idle';
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
  const TEXT_THROTTLE_MS = 100;
  let textEmitTimer: ReturnType<typeof setTimeout> | null = null;
  let textDirty = false;

  const emitTextUpdate = () => {
    textDirty = false;
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

  const flushTextThrottle = () => {
    if (textEmitTimer) {
      clearTimeout(textEmitTimer);
      textEmitTimer = null;
    }
    if (textDirty) emitTextUpdate();
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        content: effectiveContent,
        mode: params.mode,
        model: params.model,
        provider_id: params.providerId,
        ...(params.files && params.files.length > 0 ? { files: params.files } : {}),
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
      const err = await response.json();
      throw new Error(err.error || 'Failed to send message');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const result = await consumeSSEStream(reader, {
      onText: (acc) => {
        markMeaningfulProgress();
        stream.accumulatedText = acc;
        stream.thinkingPhaseEnded = true;
        throttledTextEmit();
      },
      onThinking: (delta) => {
        markMeaningfulProgress();
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
        emit(stream, 'snapshot-updated');
      },
      onToolUse: (tool) => {
        markMeaningfulProgress();
        flushTextThrottle(); // Ensure text is up-to-date before tool events
        stream.thinkingPhaseEnded = true;
        stream.toolOutputAccumulated = '';
        stream.activeToolExecution = {
          toolId: tool.id,
          toolName: tool.name,
          startedAt: Date.now(),
        };
        if (!stream.toolUsesArray.some(t => t.id === tool.id)) {
          stream.toolUsesArray = [...stream.toolUsesArray, tool];
        }
        emit(stream, 'snapshot-updated');
      },
      onToolResult: (res) => {
        markMeaningfulProgress();
        stream.toolOutputAccumulated = '';
        if (stream.activeToolExecution?.toolId === res.tool_use_id) {
          stream.activeToolExecution = null;
        }
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
        markMeaningfulProgress();
        const next = stream.toolOutputAccumulated + (stream.toolOutputAccumulated ? '\n' : '') + data;
        stream.toolOutputAccumulated = next.length > 2000 ? next.slice(-2000) : next;
        emit(stream, 'snapshot-updated');
      },
      onToolProgress: (toolName, elapsed) => {
        markMeaningfulProgress();
        stream.snapshot = { ...stream.snapshot, statusText: `Running ${toolName}... (${elapsed}s)` };
        emit(stream, 'snapshot-updated');
      },
      onStatus: (text) => {
        markMeaningfulProgress();
        // Detect compression notifications and broadcast window events
        if (text === 'context_compressed') {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('context-compressed', { detail: { sessionId: params.sessionId } }));
          }
          return; // Don't show this as a status line — it's a metadata signal
        }
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
      onResult: (usage) => {
        markMeaningfulProgress();
        stream.snapshot = { ...stream.snapshot, tokenUsage: usage };
      },
      onPermissionRequest: (permData) => {
        markMeaningfulProgress();
        stream.snapshot = {
          ...stream.snapshot,
          pendingPermission: permData,
          permissionResolved: null,
        };
        emit(stream, 'permission-request');
      },
      onToolTimeout: (toolName, elapsedSeconds) => {
        markMeaningfulProgress();
        stream.toolTimeoutInfo = { toolName, elapsedSeconds };
        if (stream.activeToolExecution) {
          upsertToolResult(
            stream,
            makeSyntheticToolErrorResult(
              stream.activeToolExecution.toolId,
              stream.activeToolExecution.toolName,
              `timed out after ${elapsedSeconds}s`,
            ),
          );
        }
      },
      onModeChanged: (sdkMode) => {
        markMeaningfulProgress();
        if (params.onModeChanged) {
          params.onModeChanged(sdkMode);
        }
      },
      onTaskUpdate: () => {
        markMeaningfulProgress();
        window.dispatchEvent(new CustomEvent('tasks-updated'));
      },
      onRewindPoint: (sdkUserMessageId) => {
        markMeaningfulProgress();
        stream.rewindPoints = [...stream.rewindPoints, { userMessageId: sdkUserMessageId }];
      },
      onReferencedContexts: (files) => {
        markMeaningfulProgress();
        stream.referencedContexts = files;
        emit(stream, 'snapshot-updated');
      },
      onUiAction: (action) => {
        markMeaningfulProgress();
        if (action.action === 'open_browser' && action.url) {
          window.dispatchEvent(new CustomEvent('browser-navigate', {
            detail: {
              url: action.url,
              newTab: action.newTab !== false,
            },
          }));
        }
        if (action.action === 'open_terminal') {
          window.dispatchEvent(new CustomEvent('terminal-ensure-visible', {
            detail: {
              tab: action.tab || 'terminal',
              terminalId: action.terminalId,
            },
          }));
        }
      },
      onKeepAlive: () => {
        markTransportActive();
        stream.lastKeepAliveTime = Date.now();
      },
      onError: (acc) => {
        markMeaningfulProgress();
        stream.accumulatedText = acc;
        emit(stream, 'snapshot-updated');
      },
      onInitMeta: (meta) => {
        markMeaningfulProgress();
        params.onInitMeta?.(meta);
      },
    });

    // Flush any pending throttled text update before building final content
    flushTextThrottle();

    // Stream completed successfully — build final message content
    const accumulated = result.accumulated;
    const finalToolUses = stream.toolUsesArray;
    const finalToolResults = stream.toolResultsArray;
    const hasTools = finalToolUses.length > 0 || finalToolResults.length > 0;

    let messageContent: string | null = accumulated.trim();
    // Combine all thinking phases for persistence
    const allThinking = [stream.fullThinking, stream.accumulatedThinking]
      .filter(s => s.trim()).join('\n\n---\n\n');
    const hasThinking = allThinking.length > 0;
    if ((hasTools || hasThinking) && (messageContent || hasThinking)) {
      messageContent = buildStructuredFinalContent(stream, accumulated.trim());
    }

    // Update snapshot with completion info
    stream.snapshot = {
      ...buildSnapshot(stream),
      phase: 'completed',
      completedAt: Date.now(),
      tokenUsage: result.tokenUsage,
      finalMessageContent: messageContent || null,
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
    };
    stream.accumulatedText = '';
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

    const buildFinalContent = (textContent: string | null): string | null => buildStructuredFinalContent(stream, textContent);

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (stream.abortReason === 'no_meaningful_progress') {
        const stalledSecs = Math.round(STREAM_MEANINGFUL_PROGRESS_TIMEOUT_MS / 1000);
        const heartbeatStillAlive = stream.lastKeepAliveTime > stream.lastMeaningfulEventTime;
        const detail = heartbeatStillAlive
          ? `推理在 ${stalledSecs}s 内没有新的有效进展，系统已自动中止。本次连接心跳仍在持续到达，所以更像是模型或工具内部卡住，而不是网络直接断开。`
          : `推理在 ${stalledSecs}s 内没有新的有效进展，系统已自动中止。这段时间里没有新的文本、思维、工具更新或权限事件。`;
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n**错误:** ${detail}\n\n建议重试本轮；如果反复出现，请改用不同方案，或检查当前工具调用与 provider 稳定性。`
          : `**错误:** ${detail}\n\n建议重试本轮；如果反复出现，请改用不同方案，或检查当前工具调用与 provider 稳定性。`;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'error',
          completedAt: Date.now(),
          error: `No meaningful progress timeout (${stalledSecs}s)`,
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.abortReason = null;
        emit(stream, 'completed');
        clearServerSdkSession(stream.sessionId);
        scheduleGC(stream);
      } else if (stream.abortReason === 'transport_idle') {
        // Idle timeout
        const idleSecs = Math.round(STREAM_IDLE_TIMEOUT_MS / 1000);
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n**Error:** Stream idle timeout — no response for ${idleSecs}s. The connection may have dropped.`
          : `**Error:** Stream idle timeout — no response for ${idleSecs}s. The connection may have dropped.`;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'error',
          completedAt: Date.now(),
          error: `Stream idle timeout (${idleSecs}s)`,
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.abortReason = null;
        emit(stream, 'completed');
        clearServerSdkSession(stream.sessionId);
        scheduleGC(stream);
      } else if (stream.toolTimeoutInfo) {
        // Tool timeout — auto-retry
        const timeoutInfo = stream.toolTimeoutInfo;
        if (stream.activeToolExecution) {
          upsertToolResult(
            stream,
            makeSyntheticToolErrorResult(
              stream.activeToolExecution.toolId,
              stream.activeToolExecution.toolName,
              `timed out after ${timeoutInfo.elapsedSeconds}s`,
            ),
          );
        }
        const textPart = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n*(tool ${timeoutInfo.toolName} timed out after ${timeoutInfo.elapsedSeconds}s)*`
          : null;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'stopped',
          completedAt: Date.now(),
          finalMessageContent: buildFinalContent(textPart),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.toolTimeoutInfo = null;
        stream.activeToolExecution = null;
        stream.abortReason = null;
        emit(stream, 'completed');
        clearServerSdkSession(stream.sessionId);
        scheduleGC(stream);

        // Auto-retry via sendMessageFn
        if (stream.sendMessageFn) {
          const fn = stream.sendMessageFn;
          streamTimeout(stream, () => {
            fn(
              `上一个工具 "${timeoutInfo.toolName}" 在运行 ${timeoutInfo.elapsedSeconds} 秒后超时了。请检查当前执行状态，尝试改用不同的指令或优化方案，避免再次执行可能导致卡住的操作。`
            );
          }, 500);
        }
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
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.activeToolExecution = null;
        stream.abortReason = null;
        emit(stream, 'completed');
        clearServerSdkSession(stream.sessionId);
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
        pendingPermission: null,
        permissionResolved: null,
      };
      stream.accumulatedText = '';
      stream.accumulatedThinking = '';
      stream.fullThinking = '';
      stream.toolUsesArray = [];
      stream.toolResultsArray = [];
      stream.toolOutputAccumulated = '';
      stream.activeToolExecution = null;
      stream.abortReason = null;
      emit(stream, 'completed');
      clearServerSdkSession(stream.sessionId);
      scheduleGC(stream);
    }
  }
}

// ==========================================
// Stop
// ==========================================

export function stopStream(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase === 'active') {
    // Try graceful interrupt first, fallback to abort
    fetch('/api/chat/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Interrupt failed, force abort
    }).finally(() => {
      // Always abort after a short delay to ensure cleanup
      streamTimeout(stream, () => {
        if (stream.snapshot.phase === 'active') {
          stream.abortController.abort();
        }
      }, 2000);
    });
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
    await fetch('/api/chat/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Best effort
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
