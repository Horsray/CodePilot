import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getAgent, getSubAgents } from './agent-registry';
import { runAgentLoop } from './agent-loop';
import { assembleTools } from './agent-tools';
import type { ToolSet } from 'ai';

export const AGENT_MCP_SYSTEM_PROMPT = `
- **Agent Delegation (CRITICAL)**: You have access to the \`mcp__codepilot-agent__Agent\` (or \`Agent\`) tool which allows you to spawn specialized sub-agents. If the user's request matches the capabilities of an available sub-agent, you are **STRICTLY PROHIBITED** from performing the task manually. You MUST delegate it to the specialized agent using this tool.
`;

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }
  if (disallowedTools && disallowedTools.length > 0) {
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, t] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = t;
    }
    return filtered;
  }
  return allTools;
}

function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return name;
  const lower = name.toLowerCase();
  if (['bash', 'execute', 'run', 'shell'].includes(lower)) {
    const cmd = (inp.command || inp.cmd || '') as string;
    return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
  }
  const filePath = (inp.file_path || inp.path || inp.filePath || '') as string;
  if (['read', 'readfile', 'read_file'].includes(lower)) {
    return filePath ? `Read ${filePath}` : 'Read';
  }
  if (['write', 'edit', 'writefile', 'write_file', 'create_file'].includes(lower)) {
    return filePath ? `Edit ${filePath}` : 'Edit';
  }
  if (['glob', 'grep', 'search', 'find_files', 'search_files'].includes(lower)) {
    const pattern = (inp.pattern || inp.query || inp.glob || '') as string;
    return pattern ? `${name} "${pattern.length > 40 ? pattern.slice(0, 37) + '...' : pattern}"` : name;
  }
  return name;
}

export function createAgentMcpServer(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
}) {
  const subAgentIds = getSubAgents().map(a => a.id);

  return createSdkMcpServer({
    name: 'codepilot-agent',
    version: '1.0.0',
    tools: [
      tool(
        'Agent',
        'Launch a sub-agent to handle a complex, multi-step task autonomously. ' +
        'The sub-agent has its own context and tool access. ' +
        `Available agents: ${subAgentIds.join(', ')}. ` +
        'Use "explore" or "search" for codebase research/retrieval, "analyst" for deep logic/architecture analysis, "planner" to break down tasks, "executor" for heavy multi-file edits, and "general" for other multi-step tasks. Trust the sub-agent for its specialized scope.',
        {
          prompt: z.string().describe('The task for the sub-agent to perform'),
          agent: z.string().optional().describe(`Agent type: ${subAgentIds.join(' | ')} (default: general)`),
          description: z.string().optional().describe('A short description of the task (used by SDK runtimes, optional here)'),
          subagent_type: z.string().optional().describe('Agent type (used by SDK runtimes, optional here)'),
        },
        async ({ prompt, agent, subagent_type }) => {
          const agentId = agent || subagent_type || 'general';
          const agentDef = getAgent(agentId);
          if (!agentDef) {
            return { content: [{ type: 'text' as const, text: `Error: Unknown agent "${agentId}". Available: ${subAgentIds.join(', ')}` }] };
          }

          const permissionContext = (ctx.parentSessionId && ctx.emitSSE && ctx.permissionMode)
            ? {
                sessionId: ctx.parentSessionId,
                permissionMode: (ctx.permissionMode || 'trust') as import('./permission-checker').PermissionMode,
                emitSSE: ctx.emitSSE,
                abortSignal: ctx.abortSignal,
              }
            : undefined;

          const { tools: allTools } = assembleTools({
            workingDirectory: ctx.workingDirectory,
            providerId: ctx.providerId,
            sessionProviderId: ctx.sessionProviderId,
            model: ctx.parentModel,
            permissionContext,
          });
          const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);
          const model = agentDef.model || ctx.parentModel;
          const systemPrompt = agentDef.prompt
            ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}`
            : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}`;

          const stream = runAgentLoop({
            prompt,
            sessionId: `sub-${Date.now()}`,
            providerId: ctx.providerId,
            sessionProviderId: ctx.sessionProviderId,
            model,
            systemPrompt,
            workingDirectory: ctx.workingDirectory,
            tools: subTools,
            maxSteps: agentDef.maxSteps || 30,
            permissionMode: ctx.permissionMode,
          });

          if (ctx.emitSSE) {
            ctx.emitSSE({ type: 'tool_output', data: `[subagent:${agentDef.id}] ${prompt.length > 120 ? prompt.slice(0, 117) + '...' : prompt}` });
          }

          const reader = stream.getReader();
          const textParts: string[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              if (value) {
                const lines = value.split('\n');
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue;
                  try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === 'text') {
                      textParts.push(event.data);
                    } else if (event.type === 'permission_request' && ctx.emitSSE) {
                      ctx.emitSSE(event);
                    } else if (event.type === 'tool_use' && ctx.emitSSE) {
                      try {
                        const t = JSON.parse(event.data);
                        const toolRenderer = getToolSummary(t.name, t.input);
                        ctx.emitSSE({ type: 'tool_output', data: `> ${toolRenderer}` });
                      } catch { }
                    } else if (event.type === 'tool_result' && ctx.emitSSE) {
                      try {
                        const res = JSON.parse(event.data);
                        const status = res.is_error ? 'x' : '+';
                        ctx.emitSSE({ type: 'tool_output', data: `[${status}] done` });
                      } catch { }
                    }
                  } catch { }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          const resultText = textParts.join('') || '(Sub-agent produced no text output)';
          return { content: [{ type: 'text' as const, text: resultText }] };
        }
      )
    ]
  });
}