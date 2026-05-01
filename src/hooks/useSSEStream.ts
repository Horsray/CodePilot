import { useRef, useCallback } from 'react';
import type { SSEEvent, TokenUsage, PermissionRequestEvent, MediaBlock, PromptInstructionSourceMeta, SubAgentSource, ClaudeInitMeta } from '@/types';

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

export interface SkillNudgeData {
  message: string;
  step: number;
  distinctToolCount: number;
  toolNames: string[];
}

export interface SSECallbacks {
  onText: (accumulated: string) => void;
  onUserMessageAck?: (data: { clientMessageId: string; serverMessageId: string; createdAt?: string }) => void;
  onToolUse: (tool: ToolUseInfo) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolOutput: (data: string) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onStatus: (text: string | undefined) => void;
  onStatusPayload?: (payload: Record<string, unknown>) => void;
  onResult: (usage: TokenUsage | null, meta?: { terminalReason?: string }) => void;
  /** SDK 0.2.111 subscription rate-limit telemetry. Fires only on
   *  claude.ai subscription paths; absent for API-key sessions. */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** SDK 0.2.111 post-turn context-usage snapshot. Used by the chat
   *  page's indicator to replace char:token estimation for ~60s after
   *  capture. */
  onContextUsage?: (snapshot: ContextUsageSnapshot) => void;
  onPermissionRequest: (data: PermissionRequestEvent) => void;
  onToolTimeout: (toolName: string, elapsedSeconds: number) => void;
  onModeChanged: (mode: string) => void;
  onTaskUpdate: (sessionId: string) => void;
  onRewindPoint: (sdkUserMessageId: string) => void;
  onThinking?: (delta: string) => void;
  /** 子Agent的思考内容增量，用于路由到子Agent卡片的进度区域 */
  onSubAgentThinking?: (parentAgentId: string, delta: string) => void;
  onKeepAlive: () => void;
  onError: (accumulated: string) => void;
  /** 中文注释：功能名称「引用上下文回调」，用法是把本轮注入的规则/文件列表同步到流式 UI。 */
  onReferencedContexts?: (files: string[]) => void;
  /** 中文注释：工具调用的文件路径列表（用于上下文统计的文件栏目） */
  onToolFiles?: (files: string[]) => void;
  onSkillNudge?: (data: SkillNudgeData) => void;
  onContextCompressed?: (data: { message: string; messagesCompressed: number; tokensSaved: number }) => void;
  /** 中文注释：功能名称「子Agent状态回调」，用法是在主Agent流中接收子Agent的生命周期事件。 */
  onSubAgentStart?: (data: { id: string; name: string; displayName: string; prompt: string; model?: string; source?: SubAgentSource }) => void;
  onSubAgentProgress?: (data: { id: string; status: string; detail?: string }) => void;
  onSubAgentComplete?: (data: { id: string; report: string; error?: string; source?: SubAgentSource }) => void;
  onInitMeta?: (meta: ClaudeInitMeta) => void;
}

/**
 * Post-turn context-usage snapshot from Query.getContextUsage()
 * (SDK 0.2.111 Phase 5). Captured on the server and forwarded verbatim.
 */
export interface ContextUsageSnapshot {
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  capturedAt: number;
}

/**
 * Subscription rate-limit info payload mirroring SDKRateLimitInfo.
 * Forwarded verbatim from the server for Phase 2 of agent-sdk-0-2-111.
 */
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
}

/**
 * Notification codes that must persist past the next setStatusText() call.
 * Scoped narrowly — only codes that represent one-shot decisions the user
 * needs to see regardless of subsequent streaming progress belong here.
 */
export const TOAST_STATUS_CODES = new Set<string>([
  'RUNTIME_EFFORT_IGNORED', // Opus 4.7 on native runtime — explicit effort dropped
]);

/**
 * Inspect a parsed status event payload and fire a toast when it carries a
 * whitelisted code. Exposed so both useSSEStream's helper and inline SSE
 * parsers in page-level components can share toast routing without
 * duplicating the whitelist. No-op when the code isn't on the whitelist
 * or when the browser toast registry hasn't initialized (tests / SSR).
 */
export function maybeShowStatusToast(statusData: { code?: string; message?: string; title?: string }): void {
  if (!statusData?.code || !TOAST_STATUS_CODES.has(statusData.code)) return;
  void import('./useToast').then(({ showToast }) => {
    showToast({
      type: statusData.code === 'RUNTIME_EFFORT_IGNORED' ? 'warning' : 'info',
      message: statusData.message || statusData.title || 'Status notification',
      duration: 8000,
    });
  }).catch(() => { /* toast system unavailable — caller falls back to status text */ });
}

/**
 * Parse a single SSE line (after stripping "data: " prefix) and dispatch
 * to the appropriate callback.  Returns the updated accumulated text.
 */
function handleSSEEvent(
  event: SSEEvent,
  accumulated: string,
  callbacks: SSECallbacks,
): string {
  switch (event.type) {
    case 'text': {
      const next = accumulated + event.data;
      callbacks.onText(next);
      return next;
    }

    case 'user_message_ack': {
      try {
        const ackData = JSON.parse(event.data) as {
          client_message_id?: string;
          server_message_id?: string;
          created_at?: string;
        };
        if (ackData.client_message_id && ackData.server_message_id) {
          callbacks.onUserMessageAck?.({
            clientMessageId: ackData.client_message_id,
            serverMessageId: ackData.server_message_id,
            createdAt: ackData.created_at,
          });
        }
      } catch {
        // skip malformed user_message_ack data
      }
      return accumulated;
    }

    case 'thinking': {
      // 中文注释：如果thinking事件带有parentAgentId，说明是子Agent的思考内容，
      // 路由到onSubAgentThinking而非onThinking，避免子Agent思考污染主时间线
      if (event.parentAgentId) {
        callbacks.onSubAgentThinking?.(event.parentAgentId, event.data);
      } else {
        callbacks.onThinking?.(event.data);
      }
      return accumulated;
    }

    case 'tool_use': {
      try {
        const toolData = JSON.parse(event.data);
        callbacks.onToolUse({
          id: toolData.id,
          name: toolData.name,
          input: toolData.input,
          ...(toolData.parentAgentId ? { parentAgentId: toolData.parentAgentId } : {}),
        });
      } catch {
        // skip malformed tool_use data
      }
      return accumulated;
    }

    case 'tool_result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onToolResult({
          tool_use_id: resultData.tool_use_id,
          content: resultData.content,
          ...(resultData.is_error ? { is_error: true } : {}),
          ...(Array.isArray(resultData.media) && resultData.media.length > 0
            ? { media: resultData.media }
            : {}),
          ...(resultData.parentAgentId ? { parentAgentId: resultData.parentAgentId } : {}),
        });
      } catch {
        // skip malformed tool_result data
      }
      return accumulated;
    }

    case 'tool_output': {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed._progress) {
          callbacks.onToolProgress(parsed.tool_name, Math.round(parsed.elapsed_time_seconds));
          // 中文注释：功能名称「工具进度触发占位卡片」，用法是在 SDK runtime 只推送 tool_progress
          // 而 tool_use 可能延迟到 tool_result 的情况下，先合成 tool_use 让前端立刻出现卡片
          if (typeof parsed.tool_use_id === 'string' && parsed.tool_use_id) {
            callbacks.onToolUse({
              id: parsed.tool_use_id,
              name: parsed.tool_name,
              input: { _synthetic: true },
            });
          }
          return accumulated;
        }
      } catch {
        // Not JSON - raw stderr output, fall through
      }
      callbacks.onToolOutput(event.data);
      return accumulated;
    }

    case 'status': {
      try {
        const statusData = JSON.parse(event.data);
        // Skip internal-only status events (e.g. resume fallback notifications)
        if (statusData._internal) {
          return accumulated;
        }
        callbacks.onStatusPayload?.(statusData);
        // Skill nudge — dedicated handler for persistent UI banner
        if (statusData.subtype === 'skill_nudge' && statusData.payload) {
          callbacks.onSkillNudge?.({
            message: statusData.message || statusData.payload.message || '',
            step: statusData.payload.reason?.step || 0,
            distinctToolCount: statusData.payload.reason?.distinctToolCount || 0,
            toolNames: statusData.payload.reason?.toolNames || [],
          });
          return accumulated;
        }
        // Context compressed — dedicated handler so stream-session-manager
        // dispatches the 'context-compressed' window event (drives hasSummary
        // state in ChatView). Before the human-readable message change,
        // onStatus received the literal string 'context_compressed' and the
        // manager matched it directly. Now the SSE payload has subtype +
        // structured stats, so we intercept here before it hits the generic
        // notification branch which would pass the full message string.
        if (statusData.subtype === 'context_compressed') {
          callbacks.onContextCompressed?.({
            message: statusData.message || '',
            messagesCompressed: statusData.stats?.messagesCompressed || 0,
            tokensSaved: statusData.stats?.tokensSaved || 0,
          });
          return accumulated;
        }
        if (statusData.session_id) {
          callbacks.onStatus(`Connected (${statusData.requested_model || statusData.model || 'claude'})`);
          callbacks.onInitMeta?.({
            tools: statusData.tools,
            slash_commands: statusData.slash_commands,
            skills: statusData.skills,
            // 中文注释：功能名称「初始化 agents 透传」，用法是把后端 status 事件里的
            // agents 能力快照写入前端状态，确保状态栏能显示当前会话真实拿到的 subagents。
            agents: statusData.agents,
            plugins: statusData.plugins,
            mcp_servers: statusData.mcp_servers,
            output_style: statusData.output_style,
            instruction_sources: Array.isArray(statusData.instruction_sources)
              ? statusData.instruction_sources.filter((item: unknown): item is PromptInstructionSourceMeta => (
                !!item && typeof item === 'object' && typeof (item as { filename?: unknown }).filename === 'string'
              ))
              : undefined,
          });
        } else if (statusData.notification) {
          // Code-driven toasts (e.g. Opus 4.7 native-runtime
          // RUNTIME_EFFORT_IGNORED): route through the shared helper so
          // the inline parser in app/chat/page.tsx can reuse the same
          // whitelist without duplicating the toast import logic.
          maybeShowStatusToast(statusData);
          callbacks.onStatus(statusData.message || statusData.title || undefined);
        } else if (typeof statusData.message === 'string' && !statusData.subtype) {
          callbacks.onStatus(statusData.message);
        } else {
          callbacks.onStatus(undefined);
        }
      } catch {
        callbacks.onStatus(event.data || undefined);
      }
      return accumulated;
    }

    case 'result': {
      try {
        const resultData = JSON.parse(event.data);
        const meta = resultData.terminal_reason ? { terminalReason: resultData.terminal_reason as string } : undefined;
        callbacks.onResult(resultData.usage || null, meta);
      } catch {
        callbacks.onResult(null);
      }
      callbacks.onStatus(undefined);
      return accumulated;
    }

    case 'rate_limit': {
      // SDK 0.2.111 subscription rate-limit event. Structured payload
      // forwarded from claude-client.ts verbatim.
      try {
        const info = JSON.parse(event.data) as RateLimitInfo;
        callbacks.onRateLimit?.(info);
      } catch {
        // skip malformed payload — better to miss a rate-limit update
        // than to crash the stream
      }
      return accumulated;
    }

    case 'context_usage': {
      // Phase 5 — post-turn context-usage snapshot. Swallow parse errors
      // silently; estimator fallback already covers the no-snapshot case.
      try {
        const snap = JSON.parse(event.data) as ContextUsageSnapshot;
        callbacks.onContextUsage?.(snap);
      } catch { /* estimator still applies */ }
      return accumulated;
    }

    case 'permission_request': {
      try {
        const permData: PermissionRequestEvent = JSON.parse(event.data);
        callbacks.onPermissionRequest(permData);
      } catch {
        // skip malformed permission_request data
      }
      return accumulated;
    }

    case 'tool_timeout': {
      try {
        const timeoutData = JSON.parse(event.data);
        callbacks.onToolTimeout(timeoutData.tool_name, timeoutData.elapsed_seconds);
      } catch {
        // skip malformed timeout data
      }
      return accumulated;
    }

    case 'referenced_contexts': {
      try {
        const payload = JSON.parse(event.data) as { files?: unknown };
        const files = Array.isArray(payload.files)
          ? payload.files.filter((item): item is string => typeof item === 'string')
          : [];
        callbacks.onReferencedContexts?.(files);
      } catch {
        // skip malformed referenced_contexts data
      }
      return accumulated;
    }

    case 'tool_files': {
      try {
        const payload = JSON.parse(event.data) as { files?: unknown };
        const files = Array.isArray(payload.files)
          ? payload.files.filter((item): item is string => typeof item === 'string')
          : [];
        callbacks.onToolFiles?.(files);
      } catch {
        // skip malformed tool_files data
      }
      return accumulated;
    }

    case 'mode_changed': {
      callbacks.onModeChanged(event.data);
      return accumulated;
    }

    case 'task_update': {
      try {
        const taskData = JSON.parse(event.data);
        callbacks.onTaskUpdate(taskData.session_id);
      } catch {
        // skip malformed task_update data
      }
      return accumulated;
    }

    case 'rewind_point': {
      try {
        const rpData = JSON.parse(event.data);
        if (rpData.userMessageId) {
          callbacks.onRewindPoint(rpData.userMessageId);
        }
      } catch {
        // skip malformed rewind_point data
      }
      return accumulated;
    }

    case 'keep_alive': {
      callbacks.onKeepAlive();
      return accumulated;
    }

    case 'error': {
      let rawErrorStr = '';
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.category && parsed.userMessage) {
          rawErrorStr = parsed.userMessage;
          if (parsed.details) rawErrorStr += `\n\nDetails: ${parsed.details}`;
        } else {
          rawErrorStr = event.data;
        }
      } catch {
        rawErrorStr = event.data;
      }
      
      let explain = '模型服务连接中断或遇到错误';
      const lowerErr = rawErrorStr.toLowerCase();
      if (lowerErr.includes('rate') && lowerErr.includes('limit')) explain = '触发了模型提供商的速率限制 (Rate Limit) 或限流，请稍后重试';
      else if (lowerErr.includes('overloaded') || lowerErr.includes('503') || lowerErr.includes('502') || lowerErr.includes('timeout')) explain = '模型提供商的服务器当前拥堵或响应超时';
      else if (lowerErr.includes('api_key') || lowerErr.includes('unauthorized') || lowerErr.includes('401')) explain = 'API 密钥无效或未授权';
      else if (lowerErr.includes('fetch') || lowerErr.includes('network') || lowerErr.includes('econnrefused')) explain = '网络连接失败，请检查网络或系统代理设置';
      
      const errPayload = JSON.stringify({ explain, raw: rawErrorStr });
      const next = accumulated + `\n\n\`\`\`chat-error\n${errPayload}\n\`\`\``;
      callbacks.onError(next);
      return next;
    }

    case 'subagent_start': {
      try {
        const data = JSON.parse(event.data);
        callbacks.onSubAgentStart?.(data);
      } catch { /* skip malformed */ }
      return accumulated;
    }

    case 'subagent_progress': {
      try {
        const data = JSON.parse(event.data);
        callbacks.onSubAgentProgress?.(data);
      } catch { /* skip malformed */ }
      return accumulated;
    }

    case 'subagent_complete': {
      try {
        const data = JSON.parse(event.data);
        callbacks.onSubAgentComplete?.(data);
      } catch { /* skip malformed */ }
      return accumulated;
    }

    case 'terminal_mirror': {
      try {
        const mirrorData = JSON.parse(event.data);
        console.log('[useSSEStream] terminal_mirror event received:', mirrorData);
        window.dispatchEvent(new CustomEvent('terminal:mirror', { detail: mirrorData }));
      } catch {
        // skip malformed terminal_mirror data
      }
      return accumulated;
    }

    case 'open-browser-panel': {
      // 中文注释：功能名称「浏览器面板打开」，用法是接收后端 SSE 事件，
      // 转换为前端 window 事件，触发 AppShell 中注册的浏览器面板打开逻辑
      try {
        const browserData = JSON.parse(event.data);
        window.dispatchEvent(new CustomEvent('action:open-browser-panel', {
          detail: { url: browserData.url, title: browserData.title || '网页预览' }
        }));
      } catch {
        // skip malformed open-browser-panel data
      }
      return accumulated;
    }

    case 'aborted': {
      // 中文注释：功能名称「异常中断事件处理」，用法是当后端因错误或取消而中断流时，
      // 不再将此视为正常完成，而是触发 onResult 以标记流结束，但附带 terminalReason='aborted'
      // 让前端可以区分正常完成和异常中断
      try {
        const abortData = JSON.parse(event.data);
        callbacks.onResult(null, { terminalReason: abortData.reason || 'aborted' });
      } catch {
        callbacks.onResult(null, { terminalReason: 'aborted' });
      }
      return accumulated;
    }

    case 'done': {
      return accumulated;
    }

    default:
      return accumulated;
  }
}

/**
 * Reads an SSE response body and dispatches parsed events through callbacks.
 * Returns the final accumulated text and token usage.
 */
export async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks,
): Promise<{ accumulated: string; tokenUsage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let tokenUsage: TokenUsage | null = null;

  const wrappedCallbacks: SSECallbacks = {
    ...callbacks,
    onResult: (usage, meta) => {
      tokenUsage = usage;
      callbacks.onResult(usage, meta);
    },
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        accumulated = handleSSEEvent(event, accumulated, wrappedCallbacks);
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return { accumulated, tokenUsage };
}

/**
 * Hook that provides a stable consumeSSEStream function bound to the latest
 * callbacks via a ref, avoiding stale closures.
 */
export function useSSEStream() {
  const callbacksRef = useRef<SSECallbacks | null>(null);

  const processStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: SSECallbacks,
    ) => {
      callbacksRef.current = callbacks;

      // Proxy through ref so callers always hit the latest callbacks
      const proxied: SSECallbacks = {
        onText: (a) => callbacksRef.current?.onText(a),
        onToolUse: (t) => callbacksRef.current?.onToolUse(t),
        onToolResult: (r) => callbacksRef.current?.onToolResult(r),
        onToolOutput: (d) => callbacksRef.current?.onToolOutput(d),
        onToolProgress: (n, s) => callbacksRef.current?.onToolProgress(n, s),
        onStatus: (t) => callbacksRef.current?.onStatus(t),
        onStatusPayload: (p) => callbacksRef.current?.onStatusPayload?.(p),
        onResult: (u, meta) => callbacksRef.current?.onResult(u, meta),
        onPermissionRequest: (d) => callbacksRef.current?.onPermissionRequest(d),
        onToolTimeout: (n, s) => callbacksRef.current?.onToolTimeout(n, s),
        onModeChanged: (m) => callbacksRef.current?.onModeChanged(m),
        onTaskUpdate: (s) => callbacksRef.current?.onTaskUpdate(s),
        onRewindPoint: (id) => callbacksRef.current?.onRewindPoint(id),
        onThinking: (d) => callbacksRef.current?.onThinking?.(d),
        onSubAgentStart: (d) => callbacksRef.current?.onSubAgentStart?.(d),
        onSubAgentProgress: (d) => callbacksRef.current?.onSubAgentProgress?.(d),
        onSubAgentComplete: (d) => callbacksRef.current?.onSubAgentComplete?.(d),
        onKeepAlive: () => callbacksRef.current?.onKeepAlive(),
        onError: (a) => callbacksRef.current?.onError(a),
        onReferencedContexts: (f) => callbacksRef.current?.onReferencedContexts?.(f),
        onSkillNudge: (d) => callbacksRef.current?.onSkillNudge?.(d),
        onToolFiles: (f) => callbacksRef.current?.onToolFiles?.(f),
        onContextCompressed: (d) => callbacksRef.current?.onContextCompressed?.(d),
        onInitMeta: (m) => callbacksRef.current?.onInitMeta?.(m),
        onRateLimit: (info) => callbacksRef.current?.onRateLimit?.(info),
        onContextUsage: (snap) => callbacksRef.current?.onContextUsage?.(snap),
      };

      return consumeSSEStream(reader, proxied);
    },
    [],
  );

  return { processStream };
}
