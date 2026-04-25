/**
 * tools/index.ts — Tool registry for the Native Runtime.
 *
 * Exports all built-in tools as a ToolSet ready for streamText().
 * Each tool is a factory function that takes ToolContext and returns a Tool.
 */

import type { ToolSet } from 'ai';
import { createReadTool } from './read';
import { createWriteTool } from './write';
import { createGlobTool } from './glob';
import { createGrepTool } from './grep';
import { createBashTool } from './bash';
import { createEditTool } from './edit';
import { createSkillTool } from './skill';
import { createAgentTool } from './agent';
// [DISABLED] CodePilot 原生 Team 编排已停用，改由 OMC 驱动多 Agent 协作
// import { createTeamTool } from './team';
import { createTodoWriteTool } from './todo-write';
import { createSkillCreateTool } from '../builtin-tools/skill-create';
import { createMcpActivateTool } from '../builtin-tools/mcp-activate';
import { createBrowserTool } from '../builtin-tools/browser';

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
  /** SSE emitter callback — passed to sub-agents for permission forwarding */
  emitSSE?: (event: { type: string; data: string }) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
  /**
   * Bash execution mode:
   * - 'pty': use shared PTY session (default, for primary agent)
   * - 'spawn': use isolated child_process.spawn (for sub-agents, no contention)
   */
  executionMode?: 'pty' | 'spawn';
}

/**
 * Create the full set of built-in coding tools.
 */
export function createBuiltinTools(ctx: ToolContext): ToolSet {
  const tools: ToolSet = {
    Read: createReadTool(ctx),
    Write: createWriteTool(ctx),
    Edit: createEditTool(ctx),
    Bash: createBashTool(ctx),
    Glob: createGlobTool(ctx),
    Grep: createGrepTool(ctx),
    Skill: createSkillTool(ctx.workingDirectory),
    TodoWrite: createTodoWriteTool(ctx),
    codepilot_skill_create: createSkillCreateTool(ctx.workingDirectory),
    codepilot_mcp_activate: createMcpActivateTool(ctx.workingDirectory),
    codepilot_open_browser: createBrowserTool(),
  };

  // OMC-style: sub-agents (spawn mode) cannot spawn their own sub-agents
  // or orchestrate teams. Only the parent agent has these capabilities.
  if (ctx.executionMode !== 'spawn') {
    tools.Agent = createAgentTool({
      workingDirectory: ctx.workingDirectory,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      parentModel: ctx.model,
      permissionMode: ctx.permissionMode,
      parentSessionId: ctx.sessionId,
      emitSSE: ctx.emitSSE,
      abortSignal: ctx.abortSignal,
    });
    // [DISABLED] CodePilot 原生 Team 编排已停用，改由 OMC 驱动多 Agent 协作
    // tools.Team = createTeamTool({
    //   workingDirectory: ctx.workingDirectory,
    //   providerId: ctx.providerId,
    //   sessionProviderId: ctx.sessionProviderId,
    //   parentModel: ctx.model,
    //   permissionMode: ctx.permissionMode,
    //   parentSessionId: ctx.sessionId,
    //   emitSSE: ctx.emitSSE,
    //   abortSignal: ctx.abortSignal,
    // });
  }

  return tools;
}
