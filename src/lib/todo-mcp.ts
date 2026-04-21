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
- **Skill Crystallization**: If you successfully complete a complex workflow (e.g., resolving a difficult bug, configuring a new environment, creating a reusable script) that involved multiple tool calls and debugging, you MUST call \`codepilot_skill_create\` at the very end to save your successful steps as a reusable SKILL.md file before finishing the conversation.
- STRICT PROHIBITION: NEVER output step-by-step plans, checklists, or numbered task lists in plain Markdown text. You MUST exclusively use the TodoWrite tool.`;

export function createTodoMcpServer(workspacePath: string) {
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
      tool(
        'codepilot_todo_write',
        'Alias of TodoWrite for compatibility with older prompts/tool names.',
        {
          todos: z.array(z.object({
            id: z.string().describe('Unique identifier for the task'),
            content: z.string().describe('Short, actionable description of the task'),
            status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the task'),
            activeForm: z.string().optional().describe('Present-continuous label for the task (e.g., "Reading files...")'),
          })).describe('The full list of tasks for the current session'),
        },
        async ({ todos }) => {
          return { content: [{ type: 'text' as const, text: `Task list updated with ${todos.length} items. UI has been synced.` }] };
        },
      ),
      tool(
        'codepilot_skill_create',
        'Auto-crystallize a successful workflow into a reusable SKILL.md file. Use this ONLY after you have successfully completed a complex task (like setting up an environment or fixing a bug) to save the exact steps for future use.',
        {
          name: z.string().describe('The name of the skill, lowercase with dashes (e.g., "setup-nginx", "fix-cors")'),
          description: z.string().describe('A short, one-sentence description of what this skill does.'),
          whenToUse: z.string().describe('When should the AI use this skill? (e.g., "When the user asks to configure Nginx")'),
          content: z.string().describe('The actual Markdown content of the skill. This should include the exact Bash commands, file paths, or code snippets that were proven to work in this session.'),
        },
        async ({ name, description, whenToUse, content }) => {
          try {
            const fs = await import('fs');
            const path = await import('path');
            const skillsDir = path.join(workspacePath, '.claude', 'skills', name);
            fs.mkdirSync(skillsDir, { recursive: true });

            const skillContent = `---
name: ${name}
description: "${description.replace(/"/g, '\\"')}"
whenToUse: "${whenToUse.replace(/"/g, '\\"')}"
---

${content}
`;
            const filePath = path.join(skillsDir, 'SKILL.md');
            fs.writeFileSync(filePath, skillContent, 'utf-8');

            try {
              const { sendNotification } = await import('@/lib/notification-manager');
              await sendNotification({
                title: '技能习得',
                body: `已成功保存新技能：${name}`,
                priority: 'low'
              });
            } catch (e) {
              console.error('[todo-mcp] Failed to notify skill creation:', e);
            }

            return { content: [{ type: 'text' as const, text: `Successfully crystallized skill! Saved to ${filePath}. In future conversations, you can call this skill by its name "${name}".` }] };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `Failed to create skill: ${e instanceof Error ? e.message : String(e)}` }] };
          }
        },
      ),
      tool(
        'codepilot_mcp_activate',
        'Activate a dormant MCP server from the <available_mcp_servers> list. Call this tool IMMEDIATELY when you realize you need a capability provided by an unloaded MCP server. DO NOT attempt to guess the tool names or call them before activating the server.',
        {
          serverName: z.string().describe('The exact name of the MCP server to activate (e.g., "minimax_vision", "github")'),
        },
        async ({ serverName }) => {
          // The actual loading logic is handled dynamically by the Native Runtime loop
          // or by the next turn keyword matcher in SDK runtime.
          return { content: [{ type: 'text' as const, text: `Activation request received for ${serverName}. In Native Runtime, the tools will be available in your NEXT tool call step. In SDK Runtime, you MUST yield back to the user now and ask them to continue so the server can load. Do NOT try to call the unloaded tools in this step.` }] };
        }
      )
    ],
  });
}
