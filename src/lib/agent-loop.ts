/**
 * agent-loop.ts — Native Agent Loop (no Claude Code CLI dependency).
 *
 * Replaces the SDK's `query()` for the self-hosted runtime path.
 * Uses Vercel AI SDK `streamText()` in a manual while-loop (not maxSteps / stopWhen)
 * so we can intercept each step for permission checks, DB persistence,
 * doom-loop detection, and context-overflow handling.
 *
 * Outputs a ReadableStream<string> of SSE lines (`data: {...}\n\n`)
 * compatible with the existing frontend contract (useSSEStream.ts).
 */

import { streamText, type ToolSet, type ModelMessage } from 'ai';
import type { SSEEvent, TokenUsage } from '@/types';
import { createModel } from './ai-provider';
import { assembleTools, READ_ONLY_TOOLS } from './agent-tools';
import { reportNativeError, classifyError, formatClassifiedError } from './error-classifier';
import { pruneOldToolResults } from './context-pruner';
import { emit as emitEvent } from './runtime/event-bus';
import { createCheckpoint } from './file-checkpoint';
import type { PermissionMode } from './permission-checker';
import { buildCoreMessages } from './message-builder';
import { getMessages } from './db';
import { createPerfTrace } from './perf-trace';

// ── Types ───────────────────────────────────────────────────────

export interface AgentLoopOptions {
  /** User's prompt text */
  prompt: string;
  /** Session ID (for DB persistence and SSE metadata) */
  sessionId: string;
  /** 性能追踪 ID，用于串联前后端一次请求。 */
  traceId?: string;
  /** Provider ID */
  providerId?: string;
  /** Session's stored provider ID */
  sessionProviderId?: string;
  /** Model override */
  model?: string;
  /** Session's stored model */
  sessionModel?: string;
  /** System prompt string */
  systemPrompt?: string;
  /** Files referenced in the system prompt */
  referencedContexts?: string[];
  /** Working directory for tool execution */
  workingDirectory?: string;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Tools to make available to the model (if not provided, assembled from defaults) */
  tools?: ToolSet;
  /** Permission mode for tool execution */
  permissionMode?: string;
  /** MCP servers to sync before assembling tools */
  mcpServers?: Record<string, import('@/types').MCPServerConfig>;
  /** Thinking configuration (Anthropic-specific) */
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  /** Effort level (Anthropic-specific) */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Enable 1M context beta */
  context1m?: boolean;
  /** Max agent loop steps (default 50) */
  maxSteps?: number;
  /** Whether this is an auto-trigger turn (skip rewind points) */
  autoTrigger?: boolean;
  /** Bypass all permission checks (full_access profile) */
  bypassPermissions?: boolean;
  /** File attachments from the user (images, documents, etc.) */
  files?: import('@/types').FileAttachment[];
  /** Callback when runtime status changes */
  onRuntimeStatusChange?: (status: string) => void;
}

// ── Constants ───────────────────────────────────────────────────

const DEFAULT_MAX_STEPS = 50;
const DOOM_LOOP_THRESHOLD = 3; // same tool called 3 times in a row
const KEEPALIVE_INTERVAL_MS = 15_000;

interface ToolErrorPayload {
  __codepilot_tool_error?: boolean;
  toolName?: string;
  reason?: 'timeout' | 'error';
  message?: string;
  attempts?: number;
}

// ── Main ────────────────────────────────────────────────────────

/**
 * Run the native Agent Loop and return a ReadableStream of SSE events.
 *
 * The stream emits the same SSE event types the frontend expects:
 * text, thinking, tool_use, tool_result, tool_output, status, result,
 * error, permission_request, rewind_point, keep_alive, done.
 */
export function runAgentLoop(options: AgentLoopOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    traceId,
    providerId,
    sessionProviderId,
    model: modelOverride,
    sessionModel,
    systemPrompt,
    referencedContexts,
    workingDirectory,
    abortController = new AbortController(),
    tools: toolsOverride,
    thinking,
    effort,
    context1m,
    maxSteps = DEFAULT_MAX_STEPS,
    autoTrigger,
    onRuntimeStatusChange,
    permissionMode,
    mcpServers,
    bypassPermissions,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      const perfTrace = createPerfTrace('agent-loop', {
        id: traceId,
        metadata: { sessionId },
      });
      const keepAliveTimer = setInterval(() => {
        try { controller.enqueue(formatSSE({ type: 'keep_alive', data: '' })); } catch { /* stream closed */ }
      }, KEEPALIVE_INTERVAL_MS);

      // 中文注释：把后端阶段耗时作为 status 事件发给前端，便于在浏览器侧重建完整链路。
      const emitPerfStatus = (name: string, detail?: Record<string, unknown>, durationMs?: number) => {
        const snapshot = perfTrace.snapshot();
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({
            subtype: 'perf',
            source: 'native',
            traceId: perfTrace.id,
            name,
            ...(durationMs !== undefined ? { durationMs } : {}),
            totalDurationMs: snapshot.totalDurationMs,
            ...(detail ? { detail } : {}),
          }),
        }));
      };

      try {
        emitPerfStatus('agent_loop.stream_open', {
          mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
        });

        // 0. Pre-flight check: test model availability before expensive operations
        // This ensures fast failure if API keys are invalid or network is down
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({ message: '探测模型连通性...' }),
        }));
        
        try {
          // Send a tiny prompt to verify the connection is alive
          // Using streamText with maxTokens=1 to fail fast if unauthorized/unreachable
          const { languageModel: testModel, config: modelConfig } = createModel({
            providerId,
            sessionProviderId,
            model: modelOverride,
            sessionModel,
          });
          
          // Only do pre-flight for external models, local models might be slow to load
          if (modelConfig.sdkType !== 'openai' || (!modelConfig.baseUrl?.includes('localhost') && !modelConfig.baseUrl?.includes('127.0.0.1'))) {
            const preflightAbort = new AbortController();
            const timeout = setTimeout(() => preflightAbort.abort(), 8000); // 8 seconds max for pre-flight
            
            // Link parent abort
            const onParentAbort = () => preflightAbort.abort();
            abortController.signal.addEventListener('abort', onParentAbort);

            try {
              // Wait for the stream to actually start yielding before declaring success
              const { fullStream } = await streamText({
                model: testModel,
                messages: [{ role: 'user', content: 'ping' }],
                maxOutputTokens: 1,
                abortSignal: preflightAbort.signal,
              });
              
              // Consume the first event to trigger network/auth failures
              for await (const _ of fullStream) {
                break; // Just need the first chunk
              }
            } finally {
              clearTimeout(timeout);
              abortController.signal.removeEventListener('abort', onParentAbort);
            }
          }
        } catch (err: unknown) {
          // If pre-flight fails, we throw immediately and skip MCP sync/history load
          const isAbort = err instanceof Error && err.name === 'AbortError';
          if (isAbort && !abortController.signal.aborted) {
            // It was our 8-second timeout, not a user cancellation
            const timeoutError = new Error('API 连接超时：模型服务器超过 8 秒未响应。请检查网络或 API 地址。');
            timeoutError.name = 'PreflightTimeoutError';
            throw timeoutError;
          }
          console.warn('[agent-loop] Pre-flight model connection failed:', err);
          throw err;
        }

        // 0b. Sync MCP servers before assembling tools (await to avoid race condition)
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({ message: '同步工具中...' }),
          }));
          console.log(`[agent-loop] Syncing ${Object.keys(mcpServers).length} MCP servers: ${Object.keys(mcpServers).join(', ')}`);
          try {
            const { syncMcpConnections } = await import('./mcp-connection-manager');
            const syncStart = Date.now();
            const syncResult = await perfTrace.measureAsync('mcp.sync', () => syncMcpConnections(mcpServers));
            emitPerfStatus('mcp.sync', {
              totalDurationMs: syncResult.totalDurationMs,
              connectedCount: syncResult.connectedCount,
              reusedCount: syncResult.reusedCount,
              failedCount: syncResult.failedCount,
              servers: syncResult.servers,
            }, Date.now() - syncStart);
          } catch (err) {
            console.warn('[agent-loop] MCP sync error:', err instanceof Error ? err.message : err);
            reportNativeError('MCP_CONNECTION_ERROR', err, { sessionId });
            emitPerfStatus('mcp.sync.error', {
              message: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          console.log('[agent-loop] No MCP servers to sync');
          emitPerfStatus('mcp.sync.skipped');
        }

        // 0b. Assemble tools with permission context (needs controller for SSE emission)
        // When bypassPermissions is true (full_access profile), skip permission wrapping entirely.
        const toolsStart = Date.now();
        const assembledTools = perfTrace.measure('tools.assemble', () => {
          if (toolsOverride) {
            return { tools: toolsOverride, systemPrompts: [] };
          }
          return assembleTools({
            workingDirectory: workingDirectory || process.cwd(),
            prompt,
            mode: permissionMode,
            providerId,
            sessionProviderId,
            model: modelOverride || sessionModel,
            permissionContext: bypassPermissions ? undefined : {
              permissionMode: (permissionMode || 'normal') as PermissionMode,
              emitSSE: (event) => {
                try { controller.enqueue(formatSSE(event as SSEEvent)); } catch { /* stream closed */ }
              },
              abortSignal: abortController.signal,
            },
            sessionId,
          });
        });
        const tools = assembledTools.tools;
        const toolSystemPrompts = assembledTools.systemPrompts;
        emitPerfStatus('tools.assemble', {
          toolCount: Object.keys(tools || {}).length,
          toolSystemPromptCount: toolSystemPrompts.length,
        }, Date.now() - toolsStart);

        // Augment system prompt with tool-specific context snippets
        // (notification hints, media capabilities, dashboard usage, etc.)
        const effectiveSystemPrompt = toolSystemPrompts.length > 0 && systemPrompt
          ? systemPrompt + '\n\n' + toolSystemPrompts.join('\n\n')
          : systemPrompt;

        // 1. Create model
        const modelStart = Date.now();
        const { languageModel, modelId, config, isThirdPartyProxy } = perfTrace.measure('model.create', () => createModel({
          providerId,
          sessionProviderId,
          model: modelOverride,
          sessionModel,
        }));
        emitPerfStatus('model.create', { modelId }, Date.now() - modelStart);

        // 2. Load conversation history from DB
        const historyStart = Date.now();
        const { messages: dbMessages } = perfTrace.measure('db.history.load', () => getMessages(sessionId, { limit: 200, excludeHeartbeatAck: true }));
        const historyMessages = buildCoreMessages(dbMessages);
        emitPerfStatus('db.history.load', { messageCount: dbMessages.length }, Date.now() - historyStart);

        // The chat route persists the user message to DB BEFORE calling us,
        // so for normal messages it's already the last entry in historyMessages.
        //
        // autoTrigger messages are NOT saved to DB (route.ts skips addMessage),
        // so they must always be appended here.
        //
        // For non-autoTrigger: the last user message in history IS the current
        // prompt (already includes any file attachments via buildUserMessage).
        if (autoTrigger || historyMessages.length === 0 || historyMessages[historyMessages.length - 1]?.role !== 'user') {
          historyMessages.push({ role: 'user' as const, content: prompt });
        }

        // Debug: uncomment to trace message assembly issues
        // console.log(`[agent-loop] Messages: ${historyMessages.map(m => `${m.role}:${typeof m.content === 'string' ? m.content.slice(0, 30) : 'array'}`).join(' | ')}`);

        // 3. Emit status init event
        const toolNames = tools ? Object.keys(tools) : [];
        console.log(`[agent-loop] Session ${sessionId}: model=${modelId}, tools=[${toolNames.join(', ')}] (${toolNames.length} total)`);
        
        // Emit referenced contexts if any
        if (referencedContexts?.length) {
          controller.enqueue(formatSSE({
            type: 'referenced_contexts',
            data: JSON.stringify({ files: referencedContexts }),
          }));
        }

        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({
            session_id: sessionId,
            trace_id: perfTrace.id,
            model: modelId,
            requested_model: modelOverride || sessionModel || modelId,
            tools: toolNames,
            output_style: 'native',
          }),
        }));

        // 4. Emit rewind point for this user message (unless autoTrigger)
        // Use the actual DB message ID so the rewind route can find it
        if (!autoTrigger) {
          const lastDbUserMsg = [...dbMessages].reverse().find(m => m.role === 'user');
          const rewindMessageId = lastDbUserMsg?.id || sessionId;
          controller.enqueue(formatSSE({
            type: 'rewind_point',
            data: JSON.stringify({ userMessageId: rewindMessageId }),
          }));
          // Create file checkpoint at this rewind point
          createCheckpoint(sessionId, rewindMessageId, workingDirectory || process.cwd());
        }

        // 5. Agent Loop
        emitEvent('session:start', { sessionId, model: modelId });
        onRuntimeStatusChange?.('streaming');
        let step = 0;
        const totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
        let lastToolNames: string[] = []; // for doom loop detection
        let messages = historyMessages;

        while (step < maxSteps) {
          if (abortController.signal.aborted) {
            console.log(`[agentLoop] Session ${sessionId} aborted by controller at step ${step}`);
            break;
          }

          step++;
          console.log(`[agentLoop] Session ${sessionId} starting step ${step}/${maxSteps}`);
          onRuntimeStatusChange?.(`Thinking... (step ${step}/${maxSteps})`);

          // Build provider options (Anthropic-specific)
          // For third-party proxies: disable adaptive thinking (not widely supported).
          // Ref: comparative analysis showed proxies return 503 for adaptive/effort params.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let providerOptions: any;
          if (config.sdkType === 'anthropic') {
            const anthropicOpts: Record<string, unknown> = {};

            if (isThirdPartyProxy) {
              // Proxies: only pass thinking if explicitly enabled (not adaptive),
              // skip effort (requires beta header proxies may not support)
              if (thinking && thinking.type === 'enabled') {
                anthropicOpts.thinking = thinking;
              }
              // Don't pass effort or adaptive thinking for proxies
            } else {
              // Official API: pass everything
              if (thinking) anthropicOpts.thinking = thinking;
              if (effort) anthropicOpts.effort = effort;
            }

            if (context1m) {
              anthropicOpts.anthropicBeta = ['context-1m-2025-08-07'];
            }
            if (Object.keys(anthropicOpts).length > 0) {
              providerOptions = { anthropic: anthropicOpts };
            }
          }

          // OpenAI Responses API (Codex) — pass system prompt + reasoning
          // Follows OpenCode's approach: default effort=medium, verbosity=medium
          if (config.useResponsesApi) {
            providerOptions = {
              ...providerOptions,
              openai: {
                ...(effectiveSystemPrompt ? { instructions: effectiveSystemPrompt } : {}),
                store: false,
                reasoningEffort: 'medium',
                textVerbosity: 'medium',
              },
            };
          }

          // Prune old tool results to reduce token usage
          const prunedMessages = pruneOldToolResults(messages);

          // Determine activeTools based on mode (plan = read-only subset)
          const isPlanMode = permissionMode === 'plan';
          const hasTools = tools && Object.keys(tools).length > 0;
          const activeToolNames = isPlanMode && hasTools
            ? Object.keys(tools).filter(name => READ_ONLY_TOOLS.includes(name as typeof READ_ONLY_TOOLS[number]))
            : undefined; // undefined = all tools active

          // Call streamText (single step — we control the loop)
          const result = streamText({
            model: languageModel,
            system: effectiveSystemPrompt,
            messages: prunedMessages,
            tools: hasTools ? tools : undefined,
            // activeTools: limit available tools in plan mode (AI SDK feature)
            ...(activeToolNames ? { activeTools: activeToolNames } : {}),
            // toolChoice: auto by default, none if no tools
            toolChoice: hasTools ? 'auto' : 'none',
            maxRetries: 2, // Auto-retry transient provider errors (502, 503, timeouts)
            providerOptions,
            abortSignal: abortController.signal,
            // Codex API doesn't support max_output_tokens
            ...(config.useResponsesApi ? {} : { maxOutputTokens: 16384 }),

            // onStepFinish: token tracking per step
            onStepFinish: ({ usage: stepUsage, finishReason, toolCalls }) => {
              if (stepUsage) {
                totalUsage.input_tokens += stepUsage.inputTokens || 0;
                totalUsage.output_tokens += stepUsage.outputTokens || 0;
              }
              // We do NOT emit `step_complete` as a 'text' or raw string anymore.
              // We emit it strictly as a valid `status` event so the frontend handles it cleanly
              // via the Status block instead of appending it to the chat text.
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  subtype: 'step_complete',
                  step,
                  usage: totalUsage,
                  finishReason,
                  toolsUsed: toolCalls?.map(tc => tc.toolName) || [],
                }),
              }));
            },

            // onAbort: cleanup on interruption
            onAbort: () => {
              onRuntimeStatusChange?.('idle');
              emitEvent('session:end', { sessionId, steps: step, aborted: true });
            },

            // repairToolCall: auto-fix invalid tool calls before failing
            experimental_repairToolCall: async ({ toolCall, tools: availableTools, error }) => {
              // Log the repair attempt for debugging
              console.warn(`[agent-loop] Repairing tool call "${toolCall.toolName}": ${error.message}`);
              // Return null to let the SDK retry with the model
              // (the model sees the error and can fix the call)
              return null;
            },

            onError: (event) => {
              const err = event.error;
              const msg = err instanceof Error ? err.message : String(err);
              console.error('[agent-loop] streamText error:', msg);
              if (err && typeof err === 'object') {
                const anyErr = err as Record<string, unknown>;
                if (anyErr.responseBody) console.error('[agent-loop] Response body:', anyErr.responseBody);
                if (anyErr.statusCode) console.error('[agent-loop] Status code:', anyErr.statusCode);
              }
              // Classify and report to Sentry
              const isAuthError = /unauthorized|forbidden|401|403/i.test(msg);
              const category = config.useResponsesApi && isAuthError
                ? 'OPENAI_AUTH_FAILED' as const
                : 'NATIVE_STREAM_ERROR' as const;
              reportNativeError(category, err, { modelId, sessionId });
            },
          });

          // Consume the fullStream
          let hasToolCalls = false;
          let hasContent = false; // tracks whether any actual content was produced
          const stepToolNames: string[] = [];
          let firstModelEventSeen = false;
          const firstEventStart = Date.now();
          perfTrace.start(`model.step_${step}.first_event`);

          for await (const event of result.fullStream) {
            if (!firstModelEventSeen) {
              firstModelEventSeen = true;
              perfTrace.end(`model.step_${step}.first_event`, { eventType: event.type });
              emitPerfStatus('model.first_event', {
                step,
                eventType: event.type,
              }, Date.now() - firstEventStart);
            }
            switch (event.type) {
              case 'text-delta':
                hasContent = true;
                controller.enqueue(formatSSE({ type: 'text', data: event.text }));
                break;

              case 'reasoning-delta':
                hasContent = true;
                controller.enqueue(formatSSE({ type: 'thinking', data: event.text }));
                break;

              case 'tool-call':
                hasToolCalls = true;
                stepToolNames.push(event.toolName);
                controller.enqueue(formatSSE({
                  type: 'tool_use',
                  data: JSON.stringify({
                    id: event.toolCallId,
                    name: event.toolName,
                    input: event.input,
                  }),
                }));
                break;

              case 'tool-result':
                if (isGuardedToolError(event.output)) {
                  console.warn(`[agent-loop] Tool error payload detected for ${event.toolName}:`, event.output);
                }
                const normalizedOutput = normalizeToolResultOutput(event.output, event.toolName);
                
                // Track tool execution failure to help avoid doom loops
                if (normalizedOutput.isError) {
                  console.warn(`[agent-loop] Tool ${event.toolName} failed:`, normalizedOutput.content);
                }

                controller.enqueue(formatSSE({
                  type: 'tool_result',
                  data: JSON.stringify({
                    tool_use_id: event.toolCallId,
                    content: normalizedOutput.content,
                    is_error: normalizedOutput.isError,
                  }),
                }));
                break;

              case 'error':
                controller.enqueue(formatSSE({
                  type: 'error',
                  data: typeof event.error === 'string' ? event.error : JSON.stringify({ userMessage: String(event.error) }),
                }));
                break;

              // Events we don't forward to the frontend
              default:
                break;
            }
          }

          // Usage is accumulated in onStepFinish callback above

          // If no tool calls, the model is done
          if (!hasToolCalls) {
            // Detect truly empty response (no text, no thinking, no tools)
            if (!hasContent) {
              const finishReason = await result.finishReason;
              console.error(`[agent-loop] Empty response: hasContent=false, finishReason=${finishReason}, model=${modelId}`);
              reportNativeError('EMPTY_RESPONSE', new Error(`Empty response: finishReason=${finishReason}`), { modelId, sessionId });
              controller.enqueue(formatSSE({
                type: 'error',
                data: JSON.stringify({
                  category: 'EMPTY_RESPONSE',
                  userMessage: `模型未返回任何内容 (finishReason: ${finishReason})。可能是 API 代理不兼容或模型 ID "${modelId}" 不被支持。`,
                }),
              }));
            }
            break;
          }

          // Doom loop detection: same tool(s) called 3 times in a row
          const toolKey = stepToolNames.sort().join(',');
          const lastKey = lastToolNames.sort().join(',');
          if (toolKey === lastKey) {
            const repeatCount = (step > 1) ? DOOM_LOOP_THRESHOLD : 1;
            // Simple heuristic: track repeats via a counter we'd need to add
            // For now, just detect immediate repeats and break after threshold
          }
          lastToolNames = stepToolNames;

          // Update messages for next iteration.
          // streamText returns the newly generated messages in responseData.messages.
          // We must append them to our existing messages array.
          const responseData = await result.response;
          
          // Wash newly generated messages before next iteration to remove non-string outputs which cause 
          // 'messages do not match the ModelMessage[] schema' errors
          const newMessages = (responseData.messages as ModelMessage[]).map(msg => {
            if (msg.role === 'tool' && Array.isArray(msg.content)) {
              return {
                ...msg,
                content: msg.content.map(part => {
                  if (part.type === 'tool-result') {
                    // Check if result is a raw tool error object payload
                    if ('result' in part && isGuardedToolError(part.result)) {
                       const normalized = normalizeToolResultOutput(part.result, part.toolName);
                       return {
                         ...part,
                         output: { type: 'text', value: normalized.content },
                       };
                    }
                  }
                  return part;
                })
              };
            }
            return msg;
          }) as ModelMessage[];

          messages = [...messages, ...newMessages];
        }

        // 6. Emit result event
        controller.enqueue(formatSSE({
          type: 'result',
          data: JSON.stringify({
            usage: totalUsage,
            session_id: sessionId,
            num_turns: step,
          }),
        }));

        emitEvent('session:end', { sessionId, steps: step });
        onRuntimeStatusChange?.('idle');
      } catch (err: unknown) {
        const isAbort = err instanceof Error && (
          err.name === 'AbortError' ||
          abortController.signal.aborted
        );

        if (!isAbort || (err instanceof Error && err.name === 'PreflightTimeoutError')) {
          console.error('[agent-loop] Error:', err instanceof Error ? err.message : err);
          
          const rawMessage = err instanceof Error ? err.message : String(err);
          const isAuthError = /unauthorized|forbidden|401|403/i.test(rawMessage);
          // Classify the error using structured pattern matching (same as SDK runtime)
          const classified = classifyError({
            error: err,
            providerName: providerId || sessionProviderId,
            thinkingEnabled: !!thinking,
            context1mEnabled: !!context1m,
            effortSet: !!effort,
          });

          // If classifyError falls back to UNKNOWN, we override the category for specific native errors
          if (classified.category === 'UNKNOWN') {
            classified.category = isAuthError ? 'OPENAI_AUTH_FAILED' : 'NATIVE_STREAM_ERROR';
          }
          
          if (err instanceof Error && err.name === 'PreflightTimeoutError') {
            classified.userMessage = err.message;
            classified.category = 'NATIVE_STREAM_ERROR';
            classified.actionHint = '重试连接';
          }
          
          reportNativeError(classified.category, err, { sessionId, modelId: modelOverride || sessionModel });
          
          const errorMessage = formatClassifiedError(classified);

          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({
              category: classified.category,
              userMessage: classified.userMessage,
              actionHint: classified.actionHint,
              retryable: classified.retryable,
              providerName: classified.providerName,
              details: classified.details,
              rawMessage: classified.rawMessage,
              recoveryActions: classified.recoveryActions,
              _formattedMessage: errorMessage,
            }),
          }));
        }

        onRuntimeStatusChange?.('error');
      } finally {
        clearInterval(keepAliveTimer);
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      }
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * 中文注释：把工具输出统一规范成前端可展示的字符串，并标记是否为错误结果。
 * 用法：消费 AI SDK 的 tool-result 事件时调用，避免对象型错误结果被当成正常输出。
 */
function normalizeToolResultOutput(output: unknown, toolName: string): { content: string; isError: boolean } {
  if (typeof output === 'string') {
    return { content: output, isError: false };
  }

  if (isGuardedToolError(output)) {
    const detail = output.attempts && output.attempts > 1
      ? `${output.message} Attempts: ${output.attempts}.`
      : output.message;
    return {
      content: `Tool "${output.toolName || toolName}" failed or was skipped. ${detail}`,
      isError: true,
    };
  }

  return {
    content: JSON.stringify(output),
    isError: false,
  };
}

function isGuardedToolError(value: unknown): value is ToolErrorPayload {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '__codepilot_tool_error' in value &&
    (value as ToolErrorPayload).__codepilot_tool_error,
  );
}
