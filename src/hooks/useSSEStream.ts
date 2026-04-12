import { useRef, useCallback } from 'react';
import type { SSEEvent, TokenUsage, PermissionRequestEvent, MediaBlock } from '@/types';

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

interface SkillNudgeData {
  message: string;
  step: number;
  distinctToolCount: number;
  toolNames: string[];
}

export interface SSECallbacks {
  onText: (accumulated: string, model?: string) => void;
  onToolUse: (tool: ToolUseInfo, model?: string) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolOutput: (data: string) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onStatus: (text: string | undefined) => void;
  onResult: (usage: TokenUsage | null) => void;
  onPermissionRequest: (data: PermissionRequestEvent) => void;
  onToolTimeout: (toolName: string, elapsedSeconds: number) => void;
  onModeChanged: (mode: string) => void;
  onTaskUpdate: (sessionId: string) => void;
  onRewindPoint: (sdkUserMessageId: string) => void;
  onReferencedContexts?: (files: string[]) => void;
  onUiAction?: (action: { action: string; url?: string; tab?: string; terminalId?: string; newTab?: boolean }) => void;
  onThinking?: (delta: string, model?: string) => void;
  onKeepAlive: () => void;
  onError: (accumulated: string) => void;
  onSkillNudge?: (data: SkillNudgeData) => void;
  onContextCompressed?: (data: { message: string; messagesCompressed: number; tokensSaved: number }) => void;
  onStatusPayload?: (payload: Record<string, unknown>) => void;
  onInitMeta?: (meta: {
    tools?: unknown;
    slash_commands?: unknown;
    skills?: unknown;
    plugins?: Array<{ name: string; path: string }>;
    mcp_servers?: unknown;
    output_style?: string;
  }) => void;
}

// 中文注释：功能名称「SSE 非正常断流识别」，用法是在流没有收到 done 终止事件就结束时抛出，
// 让上层能够区分“正常完成”和“传输被静默掐断”，从而触发自动恢复而不是误判成功。
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
      callbacks.onText(next, event.model);
      return next;
    }

    case 'thinking': {
      callbacks.onThinking?.(event.data, event.model);
      return accumulated;
    }

    case 'tool_use': {
      try {
        const toolData = JSON.parse(event.data);
        callbacks.onToolUse({
          id: toolData.id,
          name: toolData.name,
          input: toolData.input,
        }, event.model);
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
        callbacks.onStatusPayload?.(statusData);
        // Skip internal-only status events (e.g. resume fallback notifications, perf)
        if (statusData._internal || statusData.subtype === 'perf' || statusData.subtype === 'step_complete') {
          return accumulated;
        }
        if (statusData.subtype === 'ui_action' && statusData.action) {
          callbacks.onUiAction?.({
            action: statusData.action,
            url: statusData.url,
            tab: statusData.tab,
            terminalId: statusData.terminalId,
            newTab: statusData.newTab,
          });
          return accumulated;
        }
        if (statusData.subtype === 'skill_nudge' && statusData.payload) {
          callbacks.onSkillNudge?.({
            message: statusData.message || statusData.payload.message || '',
            step: statusData.payload.reason?.step || 0,
            distinctToolCount: statusData.payload.reason?.distinctToolCount || 0,
            toolNames: statusData.payload.reason?.toolNames || [],
          });
          return accumulated;
        }
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
            plugins: statusData.plugins,
            mcp_servers: statusData.mcp_servers,
            output_style: statusData.output_style,
          });
        } else if (statusData.notification) {
          callbacks.onStatus(statusData.message || statusData.title || undefined);
        } else {
          callbacks.onStatus(typeof event.data === 'string' ? event.data : undefined);
        }
      } catch {
        callbacks.onStatus(event.data || undefined);
      }
      return accumulated;
    }

    case 'result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onResult(resultData.usage || null);
      } catch {
        callbacks.onResult(null);
      }
      callbacks.onStatus(undefined);
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

    case 'referenced_contexts': {
      try {
        const refData = JSON.parse(event.data);
        if (Array.isArray(refData.files)) {
          callbacks.onReferencedContexts?.(refData.files);
        }
      } catch {
        // skip malformed referenced_contexts data
      }
      return accumulated;
    }

    case 'keep_alive': {
      callbacks.onKeepAlive();
      return accumulated;
    }

    case 'error': {
      // Try to parse structured error JSON from error-classifier
      let errorDisplay: string;
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.category && parsed.userMessage) {
          // Structured error from classifier
          errorDisplay = parsed.userMessage;
          if (parsed.actionHint) {
            errorDisplay += `\n\n**What to do:** ${parsed.actionHint}`;
          }
          if (parsed.details) {
            errorDisplay += `\n\nDetails: ${parsed.details}`;
          }
          // Render recovery actions as markdown links
          if (parsed.recoveryActions && parsed.recoveryActions.length > 0) {
            const links: string[] = [];
            for (const a of parsed.recoveryActions as Array<{ label: string; url?: string; action?: string }>) {
              if (a.url) {
                links.push(`[${a.label}](${a.url})`);
              } else if (a.action === 'open_settings') {
                links.push(`[${a.label}](/settings#providers)`);
              } else if (a.action === 'new_conversation') {
                links.push(`[${a.label}](/chat)`);
              }
              // 'retry' is handled by the retryable flag, not as a link
            }
            if (links.length > 0) {
              errorDisplay += '\n\n' + links.join(' · ');
            }
          }
        } else {
          errorDisplay = event.data;
        }
      } catch {
        // Plain text error (backward compatible)
        errorDisplay = event.data;
      }
      const next = accumulated + '\n\n**Error:** ' + errorDisplay;
      callbacks.onError(next);
      return next;
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
    onResult: (usage) => {
      tokenUsage = usage;
      callbacks.onResult(usage);
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
        onText: (a, m) => callbacksRef.current?.onText(a, m),
        onToolUse: (t, m) => callbacksRef.current?.onToolUse(t, m),
        onToolResult: (r) => callbacksRef.current?.onToolResult(r),
        onToolOutput: (d) => callbacksRef.current?.onToolOutput(d),
        onToolProgress: (n, s) => callbacksRef.current?.onToolProgress(n, s),
        onStatus: (t) => callbacksRef.current?.onStatus(t),
        onResult: (u) => callbacksRef.current?.onResult(u),
        onPermissionRequest: (d) => callbacksRef.current?.onPermissionRequest(d),
        onToolTimeout: (n, s) => callbacksRef.current?.onToolTimeout(n, s),
        onModeChanged: (m) => callbacksRef.current?.onModeChanged(m),
        onTaskUpdate: (s) => callbacksRef.current?.onTaskUpdate(s),
        onRewindPoint: (id) => callbacksRef.current?.onRewindPoint(id),
        onReferencedContexts: (f) => callbacksRef.current?.onReferencedContexts?.(f),
        onUiAction: (action) => callbacksRef.current?.onUiAction?.(action),
        onThinking: (d, m) => callbacksRef.current?.onThinking?.(d, m),
        onKeepAlive: () => callbacksRef.current?.onKeepAlive(),
        onError: (a) => callbacksRef.current?.onError(a),
        onStatusPayload: (payload) => callbacksRef.current?.onStatusPayload?.(payload),
        onInitMeta: (m) => callbacksRef.current?.onInitMeta?.(m),
      };

      return consumeSSEStream(reader, proxied);
    },
    [],
  );

  return { processStream };
}
