import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const TODO_MCP_SYSTEM_PROMPT = `## Task Management
- Use the TodoWrite tool to create and manage a structured task list for your current session. This helps the user track progress and understand your plan for complex tasks.
- You MUST use this tool proactively in these scenarios:
  - When starting ANY task that requires modifying code or executing commands.
  - When starting a task that requires 3 or more distinct steps.
  - When the user provides a list of multiple requirements to be addressed.
- **CRITICAL**: If a task requires a plan, you MUST NOT start tool work (Read, Grep, Edit, Bash, etc.) until the task list exists via TodoWrite.
- Update the status of tasks in real-time as you complete them (pending -> in_progress -> completed).
- Keep exactly one task in_progress while work is active. Mark tasks completed as soon as evidence exists.
- STRICT PROHIBITION: NEVER output step-by-step plans, checklists, or numbered task lists in plain Markdown text. You MUST exclusively use the TodoWrite tool.`;

export function createTodoMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-todo',
    version: '1.0.0',
    tools: [
      tool(
        'TodoWrite',
        'Create and manage a structured task list for your current coding session. ' +
        'CRITICAL: This tool is the ONLY way to show your plan to the user in the UI. ' +
        'Plain text markdown plans will NOT be tracked. You MUST call this tool as your FIRST action ' +
        'for ANY user request that requires modifying code, executing commands, or involves 3+ steps. ' +
        'Keep exactly one task in_progress while work is active, update statuses as soon as evidence changes. ' +
        'Status can be "pending", "in_progress", or "completed".',
        {
          todos: z.array(z.object({
            id: z.string().describe('Unique identifier for the task'),
            content: z.string().describe('Short, actionable description of the task'),
            status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the task'),
            activeForm: z.string().optional().describe('Present-continuous label for the task (e.g., "Reading files...")'),
          })).describe('The full list of tasks for the current session'),
        },
        async ({ todos }) => {
          // In the SDK runtime, the actual DB sync and SSE emission are handled 
          // by intercepting the tool_use and tool_result blocks in claude-client.ts.
          // This MCP handler just needs to return a success message to satisfy the LLM.
          return { content: [{ type: 'text' as const, text: `Task list updated with ${todos.length} items. UI has been synced.` }] };
        },
      ),
    ],
  });
}
