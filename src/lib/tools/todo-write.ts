/**
 * tools/todo-write.ts — TodoWrite: manage a structured task list.
 *
 * This tool is the native implementation of the Claude Code SDK's TodoWrite.
 * It allows the AI to track its progress through a multi-step task and
 * updates the TaskList UI in real-time.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { syncSdkTasks } from '../db';
import type { ToolContext } from './index';

/**
 * Create the TodoWrite tool for task management.
 * 中文注释：TodoWrite 工具用于管理任务列表，
 * AI 可以通过此工具向用户展示其执行复杂任务的计划和进度。
 */
export function createTodoWriteTool(ctx: ToolContext) {
  return tool({
    description:
      'Create and manage a structured task list for your current coding session. ' +
      'CRITICAL: This tool is the ONLY way to show your plan to the user in the UI. ' +
      'Plain text markdown plans will NOT be tracked. You MUST call this tool as your FIRST action ' +
      'for ANY user request that requires modifying code, executing commands, or involves 3+ steps. ' +
      'Keep exactly one task in_progress while work is active, update statuses as soon as evidence changes. ' +
      'Status can be "pending", "in_progress", or "completed". ' +
      'IMPORTANT: If you successfully complete a complex workflow (e.g., resolving a difficult bug, ' +
      'configuring a new environment, creating a reusable script), you MUST call ' +
      'codepilot_skill_create at the very end to save your successful steps as a reusable SKILL.md file.',
    inputSchema: z.object({
      todos: z.array(z.object({
        id: z.string().describe('Unique identifier for the task'),
        content: z.string().describe('Short, actionable description of the task'),
        status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the task'),
        activeForm: z.string().optional().describe('Present-continuous label for the task (e.g., "Reading files...")'),
      })).describe('The full list of tasks for the current session'),
    }),
    execute: async ({ todos }) => {
      if (!ctx.sessionId) {
        return 'Error: No active session ID found for task sync.';
      }

      try {
        // Sync tasks to the database. We reuse syncSdkTasks but mark it as 'sdk'
        // for consistent UI rendering with the original SDK tools.
        syncSdkTasks(ctx.sessionId, todos);

        // Emit a task_update SSE event for real-time UI refresh
        ctx.emitSSE?.({
          type: 'task_update',
          data: JSON.stringify({
            session_id: ctx.sessionId,
            todos,
          }),
        });

        return `Task list updated with ${todos.length} items.`;
      } catch (err) {
        console.error('[todo-write] Sync failed:', err);
        return `Error: Failed to sync task list: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
