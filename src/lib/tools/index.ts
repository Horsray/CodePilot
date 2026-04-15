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
import { createEditTool } from './edit';
import { createSkillTool } from './skill';
import { createTodoWriteTool } from './todo-write';
import { createAskUserQuestionTool } from './ask-user-question';
import { createCheckBackgroundJobTool } from './background-job';
import { createGetDiagnosticsTool } from './get-diagnostics';
import { createSearchHistoryTool } from './search-history';

export interface ToolContext {
  /** Working directory for file operations */
  workingDirectory: string;
  /** Session ID (for checkpoint tracking) */
  sessionId?: string;
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
    Glob: createGlobTool(ctx),
    Grep: createGrepTool(ctx),
    SearchHistory: createSearchHistoryTool(ctx),
    Skill: createSkillTool(ctx.workingDirectory),
    TodoWrite: createTodoWriteTool(ctx),
    AskUserQuestion: createAskUserQuestionTool(ctx),
    codepilot_check_background_job: createCheckBackgroundJobTool(ctx),
    GetDiagnostics: createGetDiagnosticsTool(ctx),
  };
}
