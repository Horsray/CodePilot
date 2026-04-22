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

import { streamText, type LanguageModel, type ToolSet, type ModelMessage } from 'ai';
import type { SSEEvent, TokenUsage } from '@/types';
import { createModel } from './ai-provider';
import { assembleTools, READ_ONLY_TOOLS } from './agent-tools';
import { reportNativeError } from './error-classifier';
import { pruneOldToolResults } from './context-pruner';
import { shouldSuggestSkill, buildSkillNudgeStatusEvent } from './skill-nudge';
import { emit as emitEvent } from './runtime/event-bus';
import { createCheckpoint } from './file-checkpoint';
import type { PermissionMode } from './permission-checker';
import { buildCoreMessages } from './message-builder';
import { sanitizeClaudeModelOptions } from './claude-model-options';
import { getMessages } from './db';
import { wrapController } from './safe-stream';

// ── Types ───────────────────────────────────────────────────────

export interface AgentLoopOptions {
  /** User's prompt text */
  prompt: string;
  /** Session ID (for DB persistence and SSE metadata) */
  sessionId: string;
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
  /** Referenced contexts */
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
  /** Effort level (Anthropic-specific). Opus 4.7 adds 'xhigh'. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
    providerId,
    sessionProviderId,
    model: modelOverride,
    sessionModel,
    systemPrompt,
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
    files,
  } = options;

  return new ReadableStream<string>({
    async start(controllerRaw) {
      // Wrap controller so async callbacks (onStepFinish, late tool-result
      // handlers, keep-alive timer) can call enqueue() without crashing
      // when the consumer aborts. See src/lib/safe-stream.ts.
      const controller = wrapController(controllerRaw, (kind) => {
        console.warn(`[agent-loop] late ${kind} after stream close — silently dropped`);
      });
      const keepAliveTimer = setInterval(() => {
        controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
      }, KEEPALIVE_INTERVAL_MS);

      try {
        // 0. Sync MCP servers before assembling tools (await to avoid race condition)
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          console.log(`[agent-loop] Syncing ${Object.keys(mcpServers).length} MCP servers: ${Object.keys(mcpServers).join(', ')}`);
          try {
            const { syncMcpConnections } = await import('./mcp-connection-manager');
            await syncMcpConnections(mcpServers);
          } catch (err) {
            console.warn('[agent-loop] MCP sync error:', err instanceof Error ? err.message : err);
            reportNativeError('MCP_CONNECTION_ERROR', err, { sessionId });
          }
        } else {
          console.log('[agent-loop] No MCP servers to sync');
        }

        // 0b. Initial tool assembly (so UI knows available tools on start)
        let tools: any = toolsOverride || {};
        let toolSystemPrompts: string[] = [];
        if (!toolsOverride) {
          const assembled = assembleTools({
            workingDirectory: workingDirectory || process.cwd(),
            prompt,
            mode: permissionMode,
            providerId,
            sessionProviderId,
            model: modelOverride || sessionModel,
            permissionContext: bypassPermissions ? undefined : {
              sessionId,
              permissionMode: (permissionMode || 'trust') as PermissionMode,
              emitSSE: (event) => {
                controller.enqueue(formatSSE(event as SSEEvent));
              },
              abortSignal: abortController.signal,
            },
          });
          tools = assembled.tools;
          toolSystemPrompts = assembled.systemPrompts;
        }

        // 1. Create model
        const { languageModel, modelId, config, isThirdPartyProxy } = createModel({
          providerId,
          sessionProviderId,
          model: modelOverride,
          sessionModel,
        });

        // 2. Load conversation history from DB
        const { messages: dbMessages } = getMessages(sessionId, { limit: 200, excludeHeartbeatAck: true });
        const historyMessages = buildCoreMessages(dbMessages);

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
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({
            session_id: sessionId,
            model: modelId,
            requested_model: modelOverride || sessionModel || modelId,
            tools: toolNames,
            output_style: 'native',
          }),
        }));

        // Emit referenced contexts if available
        if (options.referencedContexts && options.referencedContexts.length > 0) {
          controller.enqueue(formatSSE({
            type: 'referenced_contexts',
            data: JSON.stringify({ files: options.referencedContexts }),
          }));
        }

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
        let doomLoopCounter = 0; // tracks consecutive identical tool calls
        const distinctTools = new Set<string>(); // for skill-nudge heuristic
        const toolFilesAccumulator = new Set<string>(); // collects file paths from tool calls
        let messages = historyMessages;

        while (step < maxSteps) {
          step++;

          if (!toolsOverride) {
            const assembled = assembleTools({
              workingDirectory: workingDirectory || process.cwd(),
              prompt,
              mode: permissionMode,
              providerId,
              sessionProviderId,
              model: modelOverride || sessionModel,
              permissionContext: bypassPermissions ? undefined : {
                sessionId,
                permissionMode: (permissionMode || 'trust') as PermissionMode,
                emitSSE: (event) => {
                  controller.enqueue(formatSSE(event as SSEEvent));
                },
                abortSignal: abortController.signal,
              },
            });
            tools = assembled.tools;
            toolSystemPrompts = assembled.systemPrompts;
          }

          // Context Compression / Summarization (Hermes P2 feature)
          if (workingDirectory && messages.length > 20) {
            try {
              const { compressConversation } = await import('./context-compressor');
              // Take the oldest 10 messages (excluding the system prompt and the latest 10)
              const toCompress = messages.slice(0, 10).map(m => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
              }));
              
              const result = await compressConversation({
                sessionId,
                messages: toCompress,
                providerId: sessionProviderId,
                sessionModel,
              });
              
              if (result.summary) {
                console.log(`[agent-loop] Compressed context: ${result.messagesCompressed} messages summarized.`);
                // Replace the compressed messages with the summary
                const summaryMessage = {
                  role: 'system' as const,
                  content: `[Previous Context Summary]: ${result.summary}`
                };
                messages = [summaryMessage, ...messages.slice(10)];
                
                // Notify frontend
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    notification: true,
                    subtype: 'context_compressed',
                    message: `已自动压缩 ${result.messagesCompressed} 条早期对话记录，节省上下文空间。`,
                    stats: { messagesCompressed: result.messagesCompressed, tokensSaved: result.estimatedTokensSaved }
                  }),
                }));
              }
            } catch (e) {
              console.error('[agent-loop] Failed to compress context:', e);
            }
          }

          // Augment system prompt with tool-specific context snippets
          let effectiveSystemPrompt = toolSystemPrompts.length > 0 && systemPrompt
            ? systemPrompt + '\n\n' + toolSystemPrompts.join('\n\n')
            : systemPrompt;

          // Inject MCP discovery prompt for dormant servers (Native path).
          // Same logic as SDK path in claude-client.ts — makes the AI aware
          // of unloaded MCP servers so it can activate them via codepilot_mcp_activate.
          if (workingDirectory && step === 1) {
            try {
              const { loadAllMcpServers } = await import('@/lib/mcp-loader');
              const { buildMcpToolSet } = await import('@/lib/mcp-tool-adapter');
              const allServers = loadAllMcpServers(workingDirectory);
              if (allServers) {
                const loadedToolNames = new Set(Object.keys(tools));
                const loadedServerNames = new Set<string>();
                for (const name of Object.keys(allServers)) {
                  for (const toolName of loadedToolNames) {
                    if (toolName.startsWith(`mcp__${name}__`) || toolName.startsWith(`mcp__${name}-`)) {
                      loadedServerNames.add(name);
                      break;
                    }
                  }
                }
                const dormantServers = Object.entries(allServers)
                  .filter(([name]) => !loadedServerNames.has(name))
                  .map(([name, config]) => {
                    const target = config.command || config.url || '';
                    return `- **${name}**: ${target}`;
                  });
                if (dormantServers.length > 0) {
                  effectiveSystemPrompt = (effectiveSystemPrompt || '') + `

<available_mcp_servers>
The user has installed the following external MCP servers (global and project-level), but they are currently UNLOADED to save memory and startup time:
${dormantServers.join('\n')}

**CRITICAL RULE**: If the user's request requires any capability from an unloaded MCP server, you MUST:
1. Call the \`codepilot_mcp_activate\` tool with the exact server name (e.g., "github", "fetch", "minimax_vision")
2. Wait for the activation result
3. Then use the newly available tools to complete the request

DO NOT say "I don't have access to..." or "I cannot...". DO NOT ask the user for permission to load the server. Just activate it and proceed.
Example: If the user asks about GitHub issues, call codepilot_mcp_activate({ serverName: "github" }), then use the github tools.
</available_mcp_servers>`;
                }
              }
            } catch (e) {
              console.warn('[agent-loop] Failed to inject MCP discovery prompt:', e instanceof Error ? e.message : e);
            }
          }

          // Build provider options (Anthropic-specific).
          // Shared sanitizer applies Opus 4.7 migration guards (manual
          // thinking → adaptive, skip context-1m beta). Same function is
          // also called from the Claude Code SDK path in claude-client.ts
          // so the two runtimes can't drift on 4.7 semantics.
          //
          // Third-party proxies still get additional filtering (no adaptive
          // thinking or effort) — those are proxy compatibility concerns,
          // not Opus 4.7 migration concerns, so they stay inline here.
          //
          // Opus 4.7 effort on the native path (@ai-sdk/anthropic 3.0.70):
          //   The installed package still attaches `effort-2025-11-24` beta
          //   header whenever anthropicOpts.effort is set, while Opus 4.7's
          //   migration checklist says to remove that beta (effort is GA).
          //   To avoid sending a stale beta header, effort is dropped for
          //   Opus 4.7 on the native path until the provider emits a clean
          //   request. SDK/CLI path is unaffected — that codepath handles
          //   effort natively. Tracked as tech-debt on the adoption plan's
          //   risk table.
          const sanitized = sanitizeClaudeModelOptions({
            model: config.modelId,
            thinking,
            effort,
            context1m,
          });
          const isOpus47 = sanitized.isOpus47;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let providerOptions: any;
          if (config.sdkType === 'anthropic') {
            const anthropicOpts: Record<string, unknown> = {};

            if (isThirdPartyProxy) {
              // Proxies: only pass thinking if explicitly enabled (not adaptive),
              // skip effort (requires beta header proxies may not support).
              // UI currently still shows Effort selector for these providers
              // (supportsEffort is a model-level catalog flag, not per
              // provider-runtime), so an explicit pick silently evaporates.
              // Surface a one-shot toast on the first step so users know
              // their Low/High/XHigh/Max choice didn't reach the wire.
              if (sanitized.thinking && sanitized.thinking.type === 'enabled') {
                anthropicOpts.thinking = sanitized.thinking;
              }
              if (sanitized.effort && step === 1) {
                console.warn(
                  `[agent-loop] Third-party Anthropic proxy: dropping explicit effort='${sanitized.effort}' — effort GA beta header may not be supported by proxies. Switch to SDK runtime or the official Anthropic endpoint to control effort.`,
                );
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    notification: true,
                    code: 'RUNTIME_EFFORT_IGNORED',
                    title: 'Effort ignored on this runtime',
                    message: `Third-party Anthropic proxies may not support the effort parameter — your "${sanitized.effort}" choice wasn't sent. Switch to SDK runtime or an official Anthropic provider to control effort explicitly.`,
                  }),
                }));
              }
              // Don't pass effort or adaptive thinking for proxies
            } else {
              // Official API: pass through sanitized thinking.
              if (sanitized.thinking) {
                anthropicOpts.thinking = sanitized.thinking;
              }
              // Gate effort on Opus 4.7 to avoid the stale effort-2025-11-24
              // beta header the installed @ai-sdk/anthropic still attaches.
              // Other models keep the existing effort plumbing.
              if (sanitized.effort && !isOpus47) {
                anthropicOpts.effort = sanitized.effort;
              } else if (sanitized.effort && isOpus47 && step === 1) {
                // Tell the user the explicit effort they picked is being
                // dropped for this session. Only emit on the first step so
                // we don't spam multi-turn conversations. The UI surfaces
                // this via the status event pipeline; ChatView can treat
                // code=RUNTIME_EFFORT_IGNORED as a one-shot toast.
                console.warn(
                  `[agent-loop] Opus 4.7 on native runtime: dropping explicit effort='${sanitized.effort}' — @ai-sdk/anthropic still attaches deprecated effort-2025-11-24 beta. Switch to SDK runtime for explicit effort control on 4.7.`,
                );
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    notification: true,
                    code: 'RUNTIME_EFFORT_IGNORED',
                    title: 'Effort ignored on this runtime',
                    message: `Opus 4.7 on the native runtime can't send explicit effort yet (would ship a deprecated beta header). Using API default — switch to SDK runtime to control effort.`,
                  }),
                }));
              }
            }

            if (sanitized.applyContext1mBeta) {
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
          // Switch to budget-based pruning to enforce strict limits even for recent turns
          // to prevent context explosion if a tool returns massive output.
          const { pruneOldToolResultsByBudget } = await import('./context-pruner');
          const prunedMessages = pruneOldToolResultsByBudget(messages, {
            tokenBudget: 50000, // Hard limit for tool results in the active agent loop
            protectFirstN: 3,
            protectLastN: 2, // Protect fewer tail turns if they're massive
          });

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
            providerOptions,
            abortSignal: abortController.signal,
            // Codex API doesn't support max_output_tokens
            ...(config.useResponsesApi ? {} : { maxOutputTokens: 16384 }),

            // onStepFinish: token tracking per step
            onStepFinish: ({ usage: stepUsage, finishReason, toolCalls }) => {
              if (stepUsage) {
                const inputTokens = stepUsage.inputTokens || 0;
                totalUsage.input_tokens += inputTokens;
                totalUsage.output_tokens += stepUsage.outputTokens || 0;
                totalUsage.context_input_tokens = inputTokens;
              }
              // Emit step progress for frontend token display
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
          const stepToolCalls: string[] = [];

          // Extract file paths from tool calls
          function extractFilePaths(toolName: string, input: unknown): string[] {
            const files: string[] = [];
            if (!input || typeof input !== 'object') return files;
            const inp = input as Record<string, unknown>;

            // Read tools
            if (/^Read$|^ReadFile$|^read_file$|^read$|^ReadMultipleFiles$|^read_text_file$/i.test(toolName)) {
              if (inp.file_path && typeof inp.file_path === 'string') files.push(inp.file_path);
              if (inp.path && typeof inp.path === 'string') files.push(inp.path);
              if (inp.files && Array.isArray(inp.files)) {
                inp.files.forEach((f: unknown) => {
                  if (typeof f === 'string') files.push(f);
                  else if (f && typeof f === 'object' && (f as Record<string, unknown>).path) {
                    const p = (f as Record<string, unknown>).path;
                    if (typeof p === 'string') files.push(p);
                  }
                });
              }
            }
            // Glob/Search tools
            else if (/^Glob$|^GlobFiles$|^search_files$|^find_files$|^Find$/i.test(toolName)) {
              if (inp.pattern && typeof inp.pattern === 'string') files.push(inp.pattern);
              if (inp.glob && typeof inp.glob === 'string') files.push(inp.glob);
              if (inp.path && typeof inp.path === 'string') files.push(inp.path);
            }
            // Grep/Search tools
            else if (/^Grep$|^SearchCodebase$|^search$|^grep$/i.test(toolName)) {
              if (inp.pattern && typeof inp.pattern === 'string') files.push(inp.pattern);
              if (inp.query && typeof inp.query === 'string') files.push(inp.query);
              if (inp.path && typeof inp.path === 'string') files.push(inp.path);
            }
            // Write tools
            else if (/^Write$|^WriteFile$|^write_file$|^create_file$/i.test(toolName)) {
              if (inp.file_path && typeof inp.file_path === 'string') files.push(inp.file_path);
              if (inp.path && typeof inp.path === 'string') files.push(inp.path);
            }
            // Edit tools
            else if (/^Edit$|^Patch$|^replace_in_file$/i.test(toolName)) {
              if (inp.file_path && typeof inp.file_path === 'string') files.push(inp.file_path);
              if (inp.path && typeof inp.path === 'string') files.push(inp.path);
            }
            // Bash with cd/ls/read etc.
            else if (/^Bash$|^shell$|^Execute$|^run$/i.test(toolName)) {
              if (inp.command && typeof inp.command === 'string') {
                // Try to extract file paths from common patterns
                const cmd = inp.command;
                const filePattern = /(?:^|\s)([a-zA-Z0-9\/\-_.]+(?:\.[a-zA-Z0-9]+)?)(?:\s|$)/g;
                let match;
                while ((match = filePattern.exec(cmd)) !== null) {
                  const candidate = match[1];
                  // Skip obvious commands/keywords
                  if (!/^(cd|ls|grep|find|cat|head|tail|awk|sed|rm|mkdir|chmod|chown|pwd|mv|cp|touch)$/i.test(candidate)) {
                    files.push(candidate);
                  }
                }
              }
            }

            return files;
          }

          for await (const event of result.fullStream) {
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
                // Use tool name + serialized input for more accurate doom loop detection
                stepToolCalls.push(`${event.toolName}:${JSON.stringify(event.input)}`);
                distinctTools.add(event.toolName);
                controller.enqueue(formatSSE({
                  type: 'tool_use',
                  data: JSON.stringify({
                    id: event.toolCallId,
                    name: event.toolName,
                    input: event.input,
                  }),
                }));
                // Collect file paths for context stats
                const extracted = extractFilePaths(event.toolName, event.input);
                extracted.forEach(f => toolFilesAccumulator.add(f));
                break;

              case 'tool-result':
                // Progressive Subdirectory Hint Discovery
                let hintContent = '';
                try {
                  if (workingDirectory) {
                    const { SubdirectoryHintTracker } = await import('./subdirectory-hint-tracker');
                    // Store tracker in closure to persist across turns in the same agent loop
                    if (!(globalThis as any).__subdirTracker) {
                      (globalThis as any).__subdirTracker = new SubdirectoryHintTracker(workingDirectory);
                    }
                    const tracker = (globalThis as any).__subdirTracker as import('./subdirectory-hint-tracker').SubdirectoryHintTracker;
                    
                    // Reconstruct tool args since they are not in the tool-result event
                    // We parse them out from the stepToolCalls we saved during 'tool-call'
                    const callMatch = stepToolCalls.find(c => c.startsWith(`${(event as any).toolName}:`));
                    if (callMatch) {
                      const args = JSON.parse(callMatch.slice((event as any).toolName.length + 1));
                      const hints = tracker.checkToolCall((event as any).toolName, args);
                      if (hints) hintContent = hints;
                    }
                  }
                } catch (e) {
                  console.error('[agent-loop] Failed to discover subdirectory hints:', e);
                }

                let resultContent = typeof (event as any).output === 'string' ? (event as any).output : typeof (event as any).result === 'string' ? (event as any).result : JSON.stringify((event as any).output ?? (event as any).result);
                if (hintContent) {
                  resultContent += hintContent;
                }

                controller.enqueue(formatSSE({
                  type: 'tool_result',
                  data: JSON.stringify({
                    tool_use_id: event.toolCallId,
                    content: resultContent,
                    is_error: false,
                  }),
                }));
                break;

              case 'tool-error':
                controller.enqueue(formatSSE({
                  type: 'tool_result',
                  data: JSON.stringify({
                    tool_use_id: (event as any).toolCallId,
                    content: `Error: ${String((event as any).error)}`,
                    is_error: true,
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
              console.error(`[agent-loop] Empty response: finishReason=${finishReason}, model=${modelId}`);
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

          // Doom loop detection: exact same tool(s) with identical inputs called 3 times in a row
          const toolKey = stepToolCalls.sort().join('|');
          const lastKey = lastToolNames.sort().join('|');
          
          if (step > 1 && toolKey && toolKey === lastKey) {
            doomLoopCounter++;
            if (doomLoopCounter >= DOOM_LOOP_THRESHOLD - 1) {
              const summaryToolNames = [...distinctTools].join(', ');
              console.error(`[agent-loop] Doom loop detected: ${summaryToolNames} called ${doomLoopCounter + 1} times with identical inputs. Breaking.`);
              reportNativeError('UNKNOWN', new Error(`Doom loop detected with tools: ${summaryToolNames}`), { modelId, sessionId });
              controller.enqueue(formatSSE({
                type: 'error',
                data: JSON.stringify({
                  category: 'DOOM_LOOP_DETECTED',
                  userMessage: `检测到模型陷入死循环（连续多次调用相同的工具且参数完全一致：${summaryToolNames}），为避免浪费 Token，已自动阻断。请检查需求或重新表述。`,
                }),
              }));
              break;
            }
          } else {
            doomLoopCounter = 0;
          }
          
          lastToolNames = stepToolCalls;

          // Update messages for next iteration.
          // streamText returns the full message list including our input + model response.
          // Use response.messages which contains properly typed ModelMessage[].
          const responseData = await result.response;
          
          // Truncate massive tool results immediately to prevent OOM
          // This ensures that even if a tool returns a massive object, it won't crash
          // JSON.stringify in the next step or in the DB serialization.
          const safeResponseMessages = responseData.messages.map(msg => {
            if (msg.role === 'tool' && Array.isArray(msg.content)) {
              return {
                ...msg,
                content: msg.content.map(part => {
                  if (part.type === 'tool-result') {
                    // Handle both AI SDK 3.x/4.x formats (result vs output)
                    const dataToMeasure = ('result' in part) ? part.result : ('output' in part ? part.output : null);
                    if (dataToMeasure) {
                      try {
                        const jsonStr = JSON.stringify(dataToMeasure);
                        if (jsonStr.length > 200000) { // ~200KB limit per tool result
                          const marker = {
                            _omc_truncated: true,
                            original_length: jsonStr.length,
                            message: 'Tool result was too large (>200KB) and has been truncated to prevent memory exhaustion and context window overflow.',
                            partial_data: jsonStr.slice(0, 2000) + '... (truncated)'
                          };
                          
                          return {
                            ...part,
                            ...('result' in part ? { result: marker } : {}),
                            ...('output' in part ? { output: { type: 'json', value: marker } } : {})
                          };
                        }
                      } catch (e) {
                        // If JSON.stringify fails (e.g. circular ref), replace it entirely
                        return {
                          ...part,
                          ...('result' in part ? { result: 'Error: Could not serialize tool result (circular structure or too large).' } : {}),
                          ...('output' in part ? { output: { type: 'text', value: 'Error: Could not serialize tool result.' } } : {})
                        };
                      }
                    }
                  }
                  return part;
                })
              };
            }
            return msg;
          });
          
          messages = [...messages, ...safeResponseMessages] as ModelMessage[];
        }

        // 6a. Emit skill-nudge if the run was complex enough to warrant saving as a Skill.
        // Heuristic: >= 5 agent steps AND >= 2 distinct tools used. See skill-nudge.ts.
        if (shouldSuggestSkill({ step, distinctTools })) {
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify(buildSkillNudgeStatusEvent({ step, distinctTools })),
          }));

          // Trigger automatic skill creation via background agent instead of just a nudge
          if (workingDirectory) {
            try {
              const { generateTextFromProvider } = await import('./text-generator');
              const { resolveProvider } = await import('./provider-resolver');
              const resolved = resolveProvider({ sessionProviderId: providerId, sessionModel: modelId });
              
              if (resolved.hasCredentials) {
                console.log(`[agent-loop] Auto-creating skill for successful workflow (${step} steps, ${distinctTools.size} tools)...`);
                
                // Extract last N messages to summarize the workflow
                const recentHistory = messages.slice(-20).map(m => {
                  if (m.role === 'user') return `User: ${m.content}`;
                  if (m.role === 'assistant') {
                    if (typeof m.content === 'string') return `Assistant: ${m.content}`;
                    return `Assistant used tools: ${JSON.stringify(m.content)}`;
                  }
                  return '';
                }).filter(Boolean).join('\n\n');

                const result = await generateTextFromProvider({
                  providerId: resolved.provider?.id || '',
                  model: resolved.upstreamModel || resolved.model || 'haiku',
                  system: `You are an AI skill extraction agent. Analyze the provided chat history of a successful workflow and generate a reusable skill definition.
Format your output STRICTLY as a JSON object with these keys:
{
  "name": "lowercase-with-dashes-name",
  "description": "Short 1-sentence description",
  "whenToUse": "When the user asks to...",
  "content": "Markdown content with exact steps, commands, or code snippets"
}
DO NOT wrap in markdown \`\`\`json block, just return raw JSON.`,
                  prompt: `Chat History:\n\n${recentHistory}`,
                  maxTokens: 2000,
                });

                const rawJson = result.replace(/^```json/i, '').replace(/```$/i, '').trim();
                const skillDef = JSON.parse(rawJson);
                
                if (skillDef.name && skillDef.content) {
                  const { createSkillCreateTool } = await import('./builtin-tools/skill-create');
                  const tool = createSkillCreateTool(workingDirectory);
                  await tool.execute!(skillDef, { toolCallId: 'auto-skill', messages: [] });
                  console.log(`[agent-loop] Auto-created skill: ${skillDef.name}`);
                  
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      notification: true,
                      message: `已自动将此工作流提炼并保存为技能：${skillDef.name}`,
                      subtype: 'skill_nudge'
                    }),
                  }));
                }
              }
            } catch (err) {
              console.error('[agent-loop] Auto-skill creation failed:', err);
            }
          }
        }

        // 6. Emit tool_files event with collected file paths from tool calls
        if (toolFilesAccumulator.size > 0) {
          controller.enqueue(formatSSE({
            type: 'tool_files',
            data: JSON.stringify({ files: Array.from(toolFilesAccumulator) }),
          }));
        }

        // 7. Emit result event
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

        if (!isAbort) {
          console.error('[agent-loop] Error:', err instanceof Error ? err.message : err);
          reportNativeError('NATIVE_STREAM_ERROR', err, { sessionId });
          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({
              category: 'AGENT_ERROR',
              userMessage: err instanceof Error ? err.message : String(err),
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
