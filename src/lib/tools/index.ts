/**
 * tools/index.ts — Tool registry for the Native Runtime.
 *
 * Exports all built-in tools as a ToolSet ready for streamText().
 * Each tool is a factory function that takes ToolContext and returns a Tool.
 */

import type { ToolSet } from 'ai';
import type { SSEEvent } from '@/types';
import { createReadTool } from './read';
import { createWriteTool } from './write';
import { createGlobTool } from './glob';
import { createGrepTool } from './grep';
import { createBashTool } from './bash';
import { createBrowserOpenTool } from './browser';
import { createBrowserContextTool } from './browser-context';
import { createEditTool } from './edit';
import { createSkillTool } from './skill';
import { createAgentTool } from './agent';
import { createTodoWriteTool } from './todo-write';
import { createAskUserQuestionTool } from './ask-user-question';
import { createCheckBackgroundJobTool } from './background-job';
import { createGetDiagnosticsTool } from './get-diagnostics';

export interface ToolContext {
  /** Working directory for file operations */
  workingDirectory: string;
  /** Session ID (for checkpoint tracking) */
  sessionId?: string;
  /** Provider ID (for sub-agents) */
  providerId?: string;
  /** Session provider ID (for sub-agents) */
  sessionProviderId?: string;
  /** Current model ID (for sub-agents to inherit) */
  model?: string;
  /** Permission mode (for sub-agents) */
  permissionMode?: string;
  /** Orchestration tier for sub-agents */
  orchestrationTier?: 'single' | 'dual' | 'multi';
  /** SSE emitter callback — passed to sub-agents for permission forwarding */
  emitSSE?: (event: SSEEvent) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
}

/**
 * Create the full set of built-in coding tools.
 */
export function createBuiltinTools(ctx: ToolContext): ToolSet {
  return {
    Read: createReadTool(ctx),
    Write: createWriteTool(ctx),
    Edit: createEditTool(ctx),
    Bash: createBashTool(ctx),
    codepilot_browser_open: createBrowserOpenTool(ctx),
    codepilot_browser_context: createBrowserContextTool(ctx),
    Glob: createGlobTool(ctx),
    Grep: createGrepTool(ctx),
    Skill: createSkillTool(ctx.workingDirectory),
    Agent: createAgentTool({
      workingDirectory: ctx.workingDirectory,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      parentModel: ctx.model,
      permissionMode: ctx.permissionMode,
      parentSessionId: ctx.sessionId,
      // 中文注释：功能名称「向子 Agent 透传编排层级」，用法是让 dual/multi 路由在子智能体中真正生效。
      orchestrationTier: ctx.orchestrationTier,
      emitSSE: ctx.emitSSE,
      abortSignal: ctx.abortSignal,
    }),
    TodoWrite: createTodoWriteTool(ctx),
    AskUserQuestion: createAskUserQuestionTool(ctx),
    codepilot_check_background_job: createCheckBackgroundJobTool(ctx),
    GetDiagnostics: createGetDiagnosticsTool(ctx),
  };
}
