/**
 * agent-tools.ts — Tool assembly layer for the native Agent Loop.
 *
 * Selects which tools to pass to streamText() based on session mode,
 * keyword-gating, and MCP server availability.
 * Wraps tools with permission checking when a permissionContext is provided.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SSEEvent } from '@/types';

/** Tool names that are safe in read-only (plan) mode */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'SearchHistory', 'TodoWrite'] as const;
import { createBuiltinTools } from './tools';
import { buildMcpToolSet } from './mcp-tool-adapter';
import { getBuiltinTools } from './builtin-tools';
import { checkPermission, type PermissionMode } from './permission-checker';
import { registerPendingPermission } from './permission-registry';
import { emit as emitEvent } from './runtime/event-bus';
import { createPermissionRequest } from './db';
import { backgroundJobManager } from './background-job-manager';
import crypto from 'crypto';

export interface AssembleToolsOptions {
  workingDirectory?: string;
  prompt?: string;
  mode?: string;
  /** Provider ID (passed to sub-agents for inheritance) */
  providerId?: string;
  /** Session provider ID (passed to sub-agents for inheritance) */
  sessionProviderId?: string;
  /** Model (passed to sub-agents for inheritance) */
  model?: string;
  /** Session ID — always required for tool execution */
  sessionId?: string;
  /** Tool execution timeout in seconds */
  toolTimeoutSeconds?: number;
  /** Permission context — when set, tools are wrapped with permission checks */
  permissionContext?: {
    permissionMode: PermissionMode;
    /** Callback to emit SSE events（包括子 Agent 的状态与权限请求） */
    emitSSE: (event: SSEEvent) => void;
    abortSignal?: AbortSignal;
  };
}

export interface AssembleToolsResult {
  tools: ToolSet;
  /** System prompt snippets from builtin tool groups (notification, media, etc.) */
  systemPrompts: string[];
}

/**
 * Assemble the tool set for the native Agent Loop.
 * Returns both tools and their associated system prompt snippets.
 */
export function assembleTools(options: AssembleToolsOptions = {}): AssembleToolsResult {
  const cwd = options.workingDirectory || process.cwd();

  // Built-in coding tools — pass permission context through so sub-agents
  // (Agent tool) can inherit the parent's permission mode and SSE emitter.
  const builtinTools = createBuiltinTools({
    workingDirectory: cwd,
    sessionId: options.sessionId,
    emitSSE: options.permissionContext?.emitSSE,
    abortSignal: options.permissionContext?.abortSignal,
  });

  // In 'plan' mode, restrict to read-only tools
  if (options.mode === 'plan') {
    return {
      tools: { Read: builtinTools.Read, Glob: builtinTools.Glob, Grep: builtinTools.Grep, SearchHistory: builtinTools.SearchHistory },
      systemPrompts: [],
    };
  }

  // Built-in MCP-equivalent tools (notification, memory, dashboard, etc.)
  const { tools: builtinMcpTools, systemPrompts } = getBuiltinTools({
    workspacePath: cwd,
    prompt: options.prompt,
  });

  // External MCP tools from connected servers
  const mcpTools = buildMcpToolSet();

  const allTools = guardToolExecution(
    { ...builtinTools, ...builtinMcpTools, ...mcpTools },
    {
      sessionId: options.sessionId,
      emitSSE: options.permissionContext?.emitSSE,
      abortSignal: options.permissionContext?.abortSignal,
      toolTimeoutSeconds: options.toolTimeoutSeconds,
    },
  );

  // Wrap with permission checks if context provided
  if (options.permissionContext) {
    return { tools: wrapWithPermissions(allTools, options.sessionId!, options.permissionContext), systemPrompts };
  }

  return { tools: allTools, systemPrompts };
}

// ── Permission wrapper ──────────────────────────────────────────

// Session-level auto-approved rules (accumulated from "allow for session" responses)
const sessionApprovals = new Map<string, Array<{ toolName: string; pattern: string }>>();

const DEFAULT_TOOL_TIMEOUT_MS = 45_000;
const RETRYABLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Skill', 'Agent']);

interface ToolGuardOptions {
  sessionId?: string;
  emitSSE?: (event: SSEEvent) => void;
  abortSignal?: AbortSignal;
  toolTimeoutSeconds?: number;
}

interface ToolFailurePayload {
  __codepilot_tool_error: true;
  toolName: string;
  reason: 'timeout' | 'error';
  message: string;
  attempts: number;
}

/**
 * 中文注释：为所有工具增加统一的超时、重试、跳过兜底。
 * 用法：在 assembleTools 阶段包裹一次，确保任意工具失败后仍然返回 tool_result。
 */
function guardToolExecution(tools: ToolSet, options: ToolGuardOptions): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    const original = t as { description?: string; inputSchema?: unknown; execute?: (...args: unknown[]) => unknown };
    wrapped[name] = tool({
      description: original.description || name,
      inputSchema: (original.inputSchema || z.object({})) as z.ZodType,
      execute: async (input: unknown, execOptions: unknown) => {
        if (!original.execute) {
          return `(tool "${name}" has no execute function)`;
        }

        const toolCallId = (execOptions as any)?.toolCallId;
        const sessionId = options.sessionId;

        const config = getToolGuardConfig(name);
        if (options.toolTimeoutSeconds && options.toolTimeoutSeconds > 0) {
          config.timeoutMs = options.toolTimeoutSeconds * 1000;
        }
        const totalAttempts = config.maxRetries + 1;
        let lastFailure: ToolFailurePayload | null = null;

        for (let attempt = 1; attempt <= totalAttempts; attempt++) {
          const localAbortController = new AbortController();
          const parentAbortSignal = extractAbortSignal(execOptions) || options.abortSignal;
          const handleParentAbort = () => localAbortController.abort();
          parentAbortSignal?.addEventListener('abort', handleParentAbort, { once: true });

          let didTimeout = false;
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              didTimeout = true;
              localAbortController.abort();
              reject(new Error(`Tool "${name}" timed out after ${config.timeoutMs}ms`));
            }, config.timeoutMs);
          });

          // Background signal listener
          let isBackgrounded = false;
          const backgroundPromise = new Promise<{ __bg: true }>((resolve) => {
            if (sessionId && toolCallId) {
              backgroundJobManager.once(`background:${sessionId}:${toolCallId}`, () => {
                isBackgrounded = true;
                // We DON'T abort the localAbortController here because we want the tool to keep running
                resolve({ __bg: true });
              });
            }
          });

          // Emit progress every 5 seconds for long-running tools
          const start = Date.now();
          const progressTimer = setInterval(() => {
            const elapsed = Math.round((Date.now() - start) / 1000);
            if (elapsed >= 5) {
              options.emitSSE?.({
                type: 'status',
                data: JSON.stringify({ message: `Running ${name}... (${elapsed}s)` }),
              });
            }
          }, 5000);

          try {
            const toolExecutionPromise = (async () => {
              const result = await original.execute!(input, injectAbortSignal(execOptions, localAbortController.signal));
              const finalOutput = result ?? '(tool completed with no output)';
              
              // If it was backgrounded, update the job registry when it finally finishes
              if (isBackgrounded && sessionId && toolCallId) {
                backgroundJobManager.completeJob(sessionId, toolCallId, typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput));
              }
              
              return finalOutput;
            })();

            const raceResult = await Promise.race([
              toolExecutionPromise,
              timeoutPromise,
              backgroundPromise,
            ]);

            if (typeof raceResult === 'object' && raceResult !== null && '__bg' in raceResult) {
              // Register the job and return placeholder
              backgroundJobManager.registerJob(sessionId!, toolCallId!, name, input);
              return `The task "${name}" has been moved to the background and is still running. You can continue with other tasks. Use the "codepilot_check_background_job" tool later to check its status or wait for a notification.`;
            }

            return raceResult;
          } catch (error) {
            if (parentAbortSignal?.aborted) {
              throw error;
            }

            // If it failed while backgrounded, update registry
            if (isBackgrounded && sessionId && toolCallId) {
              backgroundJobManager.failJob(sessionId, toolCallId, error instanceof Error ? error.message : String(error));
            }

            lastFailure = {
              __codepilot_tool_error: true,
              toolName: name,
              reason: didTimeout ? 'timeout' : 'error',
              message: error instanceof Error ? error.message : String(error),
              attempts: attempt,
            };

            if (didTimeout) {
              options.emitSSE?.({
                type: 'tool_timeout',
                data: JSON.stringify({
                  tool_name: name,
                  elapsed_seconds: Math.round(config.timeoutMs / 1000),
                }),
              });
              
              // If it timed out while backgrounded, update registry
              if (isBackgrounded && sessionId && toolCallId) {
                backgroundJobManager.timeoutJob(sessionId, toolCallId);
              }
            }

            if (attempt < totalAttempts) {
              continue;
            }
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            clearInterval(progressTimer);
            parentAbortSignal?.removeEventListener('abort', handleParentAbort);
            // Cleanup background listener if it didn't fire
            if (sessionId && toolCallId) {
              backgroundJobManager.removeAllListeners(`background:${sessionId}:${toolCallId}`);
            }
          }
        }

        return lastFailure || {
          __codepilot_tool_error: true,
          toolName: name,
          reason: 'error' as const,
          message: `Tool "${name}" failed without a recoverable result`,
          attempts: totalAttempts,
        };
      },
    });
  }

  return wrapped;
}

/**
 * 中文注释：给不同工具分配保守的超时和重试策略，避免对有副作用的工具重复执行。
 * 用法：读类工具允许一次重试；写类和命令类默认不重试，只在失败后跳过。
 */
function getToolGuardConfig(toolName: string): { timeoutMs: number; maxRetries: number } {
  if (toolName === 'Bash') {
    return { timeoutMs: 280_000, maxRetries: 0 };
  }
  if (toolName === 'Agent') {
    return { timeoutMs: 180_000, maxRetries: 0 };
  }
  if (toolName.startsWith('mcp__')) {
    // MCP tools are usually fast unless they are truly processing something big
    return { timeoutMs: 45_000, maxRetries: 0 };
  }
  return {
    timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    maxRetries: RETRYABLE_TOOLS.has(toolName) ? 1 : 0,
  };
}

function extractAbortSignal(execOptions: unknown): AbortSignal | undefined {
  if (!execOptions || typeof execOptions !== 'object') return undefined;
  if (!('abortSignal' in execOptions)) return undefined;
  return (execOptions as { abortSignal?: AbortSignal }).abortSignal;
}

function injectAbortSignal(execOptions: unknown, abortSignal: AbortSignal): unknown {
  if (!execOptions || typeof execOptions !== 'object') {
    return { abortSignal };
  }
  return { ...(execOptions as Record<string, unknown>), abortSignal };
}

function getSessionRules(sessionId: string): Array<{ permission: string; pattern: string; action: 'allow' | 'deny' | 'ask' }> {
  const approvals = sessionApprovals.get(sessionId) || [];
  return approvals.map(a => ({ permission: a.toolName, pattern: a.pattern, action: 'allow' as const }));
}

function wrapWithPermissions(
  tools: ToolSet,
  sessionId: string,
  permissionContext: NonNullable<AssembleToolsOptions['permissionContext']>,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    // Skip permission checks for safe tools:
    // - Read-only core tools (Read, Glob, Grep, Skill)
    // - All CodePilot built-in tools (codepilot_*) — trusted internal tools
    if (['Read', 'Glob', 'Grep', 'Skill'].includes(name) || name.startsWith('codepilot_')) {
      wrapped[name] = t;
      continue;
    }

    // Wrap execute with permission check
    const original = t as { description?: string; inputSchema?: unknown; execute?: (...args: unknown[]) => unknown };
    wrapped[name] = tool({
      description: original.description || name,
      inputSchema: (original.inputSchema || z.object({})) as z.ZodType,
      execute: async (input: unknown, execOptions: unknown) => {
        emitEvent('tool:pre-use', { sessionId, toolName: name, input });
        const result = checkPermission(name, input, permissionContext.permissionMode, getSessionRules(sessionId));

        if (result.action === 'deny') {
          return `Permission denied: ${result.reason || 'Tool not allowed in current mode'}`;
        }

        if (result.action === 'ask') {
          // Emit permission_request SSE and wait for user response
          const permId = crypto.randomBytes(8).toString('hex');

          // Persist to DB
          try {
            createPermissionRequest({
              id: permId,
              sessionId,
              toolName: name,
              toolInput: JSON.stringify(input),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });
          } catch { /* non-critical */ }

          emitEvent('permission:request', { sessionId, toolName: name, permissionId: permId });

          // Emit SSE to inform UI that we are waiting for permission
          permissionContext.emitSSE({
            type: 'status',
            data: JSON.stringify({ message: `Waiting for permission to run ${name}...` }),
          });

          // Emit SSE for actual permission dialog
          permissionContext.emitSSE({
            type: 'permission_request',
            data: JSON.stringify({
              permissionRequestId: permId,
              toolName: name,
              toolInput: input,
              description: result.reason,
            }),
          });

          // Wait for user response
          const permResult = await registerPendingPermission(
            permId,
            (input || {}) as Record<string, unknown>,
            permissionContext.abortSignal,
          );

          emitEvent('permission:resolved', { sessionId, toolName: name, behavior: permResult.behavior });

          if (permResult.behavior === 'deny') {
            return `Permission denied by user: ${permResult.message || 'Denied'}`;
          }

          // Apply user-modified input if provided (e.g. user edited the command)
          if (permResult.updatedInput) {
            input = permResult.updatedInput;
          }

          // Save session-level approval for future calls (allow_session)
          if (permResult.updatedPermissions && Array.isArray(permResult.updatedPermissions)) {
            const existing = sessionApprovals.get(sessionId) || [];
            existing.push({ toolName: name, pattern: '*' });
            sessionApprovals.set(sessionId, existing);
          }
        }

        // Execute the original tool (with possibly updated input from permission approval)
        if (original.execute) {
          const output = await original.execute(input, execOptions);
          emitEvent('tool:post-use', { sessionId, toolName: name });
          return output;
        }
        return '(tool has no execute function)';
      },
    });
  }

  return wrapped;
}
