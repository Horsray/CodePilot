/**
 * agent-tools.ts — Tool assembly layer for the native Agent Loop.
 *
 * Selects which tools to pass to streamText() based on session mode,
 * keyword-gating, and MCP server availability.
 * Wraps tools with permission checking when a permissionContext is provided.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

/** Tool names that are safe in read-only (plan) mode */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'TodoWrite'] as const;
import { createBuiltinTools } from './tools';
import { buildMcpToolSet } from './mcp-tool-adapter';
import { getBuiltinTools } from './builtin-tools';
import { checkPermission, type PermissionMode } from './permission-checker';
import { registerPendingPermission } from './permission-registry';
import { emit as emitEvent } from './runtime/event-bus';
import { createPermissionRequest } from './db';
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
  /** Permission context — when set, tools are wrapped with permission checks */
  permissionContext?: {
    permissionMode: PermissionMode;
    /** Callback to emit SSE events (for permission_request) */
    emitSSE: (event: { type: string; data: string }) => void;
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
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    model: options.model,
    permissionMode: options.permissionContext?.permissionMode,
    emitSSE: options.permissionContext?.emitSSE,
    abortSignal: options.permissionContext?.abortSignal,
  });

  // In 'plan' mode, restrict to read-only tools
  if (options.mode === 'plan') {
    return {
      tools: { Read: builtinTools.Read, Glob: builtinTools.Glob, Grep: builtinTools.Grep },
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
      emitSSE: options.permissionContext?.emitSSE,
      abortSignal: options.permissionContext?.abortSignal,
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
const RETRYABLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Skill', 'Agent', 'codepilot_browser_open', 'codepilot_browser_context']);

interface ToolGuardOptions {
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
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

        const config = getToolGuardConfig(name);
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

          try {
            const result = await Promise.race([
              Promise.resolve(original.execute(input, injectAbortSignal(execOptions, localAbortController.signal))),
              timeoutPromise,
            ]);
            return result ?? '(tool completed with no output)';
          } catch (error) {
            if (parentAbortSignal?.aborted) {
              throw error;
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
            }

            if (attempt < totalAttempts) {
              continue;
            }
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            parentAbortSignal?.removeEventListener('abort', handleParentAbort);
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
    // MCP tools usually shouldn't hang forever, but network requests can be slow
    return { timeoutMs: 30_000, maxRetries: 0 };
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

          // Emit SSE
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
