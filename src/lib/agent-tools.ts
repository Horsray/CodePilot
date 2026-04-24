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
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const;
import { createBuiltinTools } from './tools';
import { buildMcpToolSet } from './mcp-tool-adapter';
import { getBuiltinTools } from './builtin-tools';
import { checkPermission, type PermissionMode } from './permission-checker';
import { registerPendingPermission } from './permission-registry';
import { emit as emitEvent } from './runtime/event-bus';
import { createPermissionRequest } from './db';
import { getSessionSemaphore, isToolConcurrencySafe } from './tool-concurrency';
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
  /** Permission context — when set, tools are wrapped with permission checks */
  permissionContext?: {
    sessionId: string;
    permissionMode: PermissionMode;
    /** Callback to emit SSE events (for permission_request) */
    emitSSE: (event: { type: string; data: string }) => void;
    abortSignal?: AbortSignal;
  };
  /** Optional allow-list to avoid instantiating unrelated MCP tool wrappers */
  allowedToolNames?: string[];
  /** Bash execution mode: 'pty' for primary agent, 'spawn' for sub-agents */
  executionMode?: 'pty' | 'spawn';
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
  const allowedToolNames = options.allowedToolNames;

  // Built-in coding tools — pass permission context through so sub-agents
  // (Agent tool) can inherit the parent's permission mode and SSE emitter.
  const builtinTools = createBuiltinTools({
    workingDirectory: cwd,
    sessionId: options.permissionContext?.sessionId,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    model: options.model,
    permissionMode: options.permissionContext?.permissionMode,
    emitSSE: options.permissionContext?.emitSSE,
    abortSignal: options.permissionContext?.abortSignal,
    executionMode: options.executionMode,
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
    allowedToolNames,
  });

  // External MCP tools from connected servers
  const mcpTools = buildMcpToolSet(allowedToolNames);

  const allTools = { ...builtinTools, ...builtinMcpTools, ...mcpTools };
  const filteredTools = (allowedToolNames
    ? Object.fromEntries(Object.entries(allTools).filter(([toolName]) => allowedToolNames.includes(toolName)))
    : allTools) as ToolSet;

  // Wrap with concurrency control (prevents write conflicts across parallel tool calls)
  const concurrencyWrapped = wrapWithConcurrency(filteredTools, options.permissionContext?.sessionId);

  // Wrap with permission checks if context provided
  if (options.permissionContext) {
    return { tools: wrapWithPermissions(concurrencyWrapped, options.permissionContext), systemPrompts };
  }

  return { tools: concurrencyWrapped, systemPrompts };
}

// ── Concurrency wrapper ─────────────────────────────────────────

/**
 * Wrap tools with concurrency control. Non-parallel-safe tools (Write, Edit,
 * Bash, etc.) acquire a session-level semaphore before executing, preventing
 * write conflicts when the model issues multiple tool calls in one step.
 *
 * Safe tools (Read, Glob, Grep, WebFetch) bypass the semaphore entirely.
 */
function wrapWithConcurrency(tools: ToolSet, sessionId?: string): ToolSet {
  if (!sessionId) return tools; // no session = no concurrency control needed

  const wrapped: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    if (isToolConcurrencySafe(name)) {
      // Read-only tools — always safe to run concurrently
      wrapped[name] = t;
      continue;
    }

    const original = t as { description?: string; inputSchema?: unknown; execute?: (...args: unknown[]) => unknown };
    wrapped[name] = tool({
      description: original.description || name,
      inputSchema: (original.inputSchema || z.object({})) as z.ZodType,
      execute: async (input: unknown, execOptions: unknown) => {
        const semaphore = getSessionSemaphore(sessionId);
        const release = await semaphore.acquire();
        try {
          if (original.execute) {
            return await original.execute(input, execOptions);
          }
          return '(tool has no execute function)';
        } finally {
          release();
        }
      },
    });
  }

  return wrapped;
}

// ── Permission wrapper ──────────────────────────────────────────

// Session-level auto-approved rules (accumulated from "allow for session" responses)
const sessionApprovals = new Map<string, Array<{ toolName: string; pattern: string }>>();

function getSessionRules(sessionId: string): Array<{ permission: string; pattern: string; action: 'allow' | 'deny' | 'ask' }> {
  const approvals = sessionApprovals.get(sessionId) || [];
  return approvals.map(a => ({ permission: a.toolName, pattern: a.pattern, action: 'allow' as const }));
}

function wrapWithPermissions(
  tools: ToolSet,
  ctx: NonNullable<AssembleToolsOptions['permissionContext']>,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    // Skip permission checks for safe tools:
    // - Read-only core tools (Read, Glob, Grep, Skill)
    // - Agent (safe sub-agent spawner, sub-agents inherit and enforce their own permissions)
    // - codepilot_skill_create (safe utility to write skill files)
    if (['Read', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite', 'codepilot_skill_create'].includes(name) || name.startsWith('codepilot_')) {
      wrapped[name] = t;
      continue;
    }

    // Wrap execute with permission check
    const original = t as { description?: string; inputSchema?: unknown; execute?: (...args: unknown[]) => unknown };
    wrapped[name] = tool({
      description: original.description || name,
      inputSchema: (original.inputSchema || z.object({})) as z.ZodType,
      execute: async (input: unknown, execOptions: unknown) => {
        emitEvent('tool:pre-use', { sessionId: ctx.sessionId, toolName: name, input });
        const result = checkPermission(name, input, ctx.permissionMode, getSessionRules(ctx.sessionId));
        // 中文注释：输出权限判定日志，便于排查 AskUserQuestion 是否真正进入 ask 分支。
        console.log('[permission] checkPermission', {
          toolName: name,
          permissionMode: ctx.permissionMode,
          action: result.action,
        });

        if (result.action === 'deny') {
          return `Permission denied: ${result.reason || 'Tool not allowed in current mode'}`;
        }

        if (result.action === 'ask') {
          // Emit permission_request SSE and wait for user response
          // 中文注释：记录 permission_request 发出时机，便于核对前端是否正确收到交互请求。
          console.log('[permission] emitting permission_request', {
            toolName: name,
            permissionMode: ctx.permissionMode,
          });
          const permId = crypto.randomBytes(8).toString('hex');

          // Persist to DB
          try {
            createPermissionRequest({
              id: permId,
              sessionId: ctx.sessionId,
              toolName: name,
              toolInput: JSON.stringify(input),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });
          } catch { /* non-critical */ }

          emitEvent('permission:request', { sessionId: ctx.sessionId, toolName: name, permissionId: permId });

          // Emit SSE
          ctx.emitSSE({
            type: 'permission_request',
            data: JSON.stringify({
              permissionRequestId: permId,
              toolName: name,
              toolInput: input,
              description: result.reason,
            }),
          });

          // Wait for user response
          // IMPORTANT: do NOT pass abortSignal — same rationale as SDK path:
          // the stream's AbortController may fire while the user is still
          // answering. The permission has its own 5-minute independent timer.
          const permResult = await registerPendingPermission(
            permId,
            (input || {}) as Record<string, unknown>,
          );

          emitEvent('permission:resolved', { sessionId: ctx.sessionId, toolName: name, behavior: permResult.behavior });

          console.log('[permission wrapper] resolved:', {
            toolName: name,
            behavior: permResult.behavior,
            hasUpdatedInput: !!permResult.updatedInput,
            updatedInputPreview: permResult.updatedInput ? JSON.stringify(permResult.updatedInput).slice(0, 300) : 'none',
            originalInputKeys: Object.keys(input as Record<string, unknown>),
          });

          if (permResult.behavior === 'deny') {
            return `Permission denied by user: ${permResult.message || 'Denied'}`;
          }

          // Apply user-modified input if provided (e.g. user edited the command)
          if (permResult.updatedInput) {
            input = permResult.updatedInput;
          }

          // Save session-level approval for future calls (allow_session)
          if (permResult.updatedPermissions && Array.isArray(permResult.updatedPermissions)) {
            const existing = sessionApprovals.get(ctx.sessionId) || [];
            existing.push({ toolName: name, pattern: '*' });
            sessionApprovals.set(ctx.sessionId, existing);
          }
        }

        // Execute the original tool (with possibly updated input from permission approval)
        if (original.execute) {
          try {
            const output = await original.execute(input, execOptions);
            emitEvent('tool:post-use', { sessionId: ctx.sessionId, toolName: name });
            if (ctx.emitSSE) {
              ctx.emitSSE({
                type: 'tool_finished',
                data: JSON.stringify({ tool: name }),
              });
            }
            // Ensure we always return a valid value, never null/undefined
            if (output == null) {
              console.warn(`[permission-wrapper] Tool ${name} returned null/undefined, converting to empty string`);
              return '';
            }
            return output;
          } catch (err) {
            // Tool execution failed — return error message instead of throwing
            // This prevents the entire agent loop from crashing
            console.error(`[permission-wrapper] Tool ${name} execution failed:`, err);
            return `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        return '(tool has no execute function)';
      },
    });
  }

  return wrapped;
}
