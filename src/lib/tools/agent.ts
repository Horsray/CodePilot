/**
 * tools/agent.ts — AgentTool: spawn a sub-agent with isolated context.
 *
 * The sub-agent runs an independent agent-loop with restricted tools
 * and a separate message history. Results are returned as text to the parent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getAgent, getSubAgents } from '../agent-registry';
import { runAgentLoop } from '../agent-loop';
import { assembleTools } from '../agent-tools';
import type { ToolSet } from 'ai';
import { buildSubAgentExecutionProfile } from '../subagent-profile';
import { createSubAgentProgressTracker } from '../subagent-progress';
import { tryExecuteSubAgentFastPath } from '../subagent-fast-path';

/**
 * Create the Agent tool for spawning sub-agents.
 */
export function createAgentTool(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  /** Inherit permission mode from parent */
  permissionMode?: string;
  /** Parent session ID — sub-agent inherits permission context */
  parentSessionId?: string;
  /** Callback to forward SSE events (permission_request) to the parent stream */
  emitSSE?: (event: { type: string; data: string }) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
}) {
  const subAgentIds = getSubAgents().map(a => a.id);

  return tool({
    description:
      'Launch a sub-agent to handle a complex, multi-step task autonomously. ' +
      'The sub-agent has its own context and tool access. ' +
      `Available agents: ${subAgentIds.join(', ')}. ` +
      'Use "explore" or "search" for codebase research/retrieval, "analyst" for deep logic/architecture analysis, "planner" to break down tasks, "executor" for heavy multi-file edits, and "general" for other multi-step tasks. Trust the sub-agent for its specialized scope.',
    inputSchema: z.object({
      prompt: z.string().describe('The task for the sub-agent to perform'),
      agent: z.string().optional().describe(`Agent type: ${subAgentIds.join(' | ')} (default: general)`),
      description: z.string().optional().describe('A short description of the task (used by SDK runtimes, optional here)'),
      subagent_type: z.string().optional().describe('Agent type (used by SDK runtimes, optional here)'),
    }),
    execute: async ({ prompt, agent, subagent_type }) => {
      const agentId = agent || subagent_type || 'general';
      const agentDef = getAgent(agentId);
      if (!agentDef) {
        return `Error: Unknown agent "${agentId}". Available: ${subAgentIds.join(', ')}`;
      }

      // Build restricted tool set — inherit permission context from parent
      const profile = buildSubAgentExecutionProfile(agentDef, prompt);

      const permissionContext = (ctx.parentSessionId && ctx.emitSSE && ctx.permissionMode)
        ? {
            sessionId: ctx.parentSessionId,
            permissionMode: (ctx.permissionMode || 'trust') as import('../permission-checker').PermissionMode,
            emitSSE: ctx.emitSSE,
            abortSignal: ctx.abortSignal,
          }
        : undefined;
      const { tools: allTools } = assembleTools({
        workingDirectory: ctx.workingDirectory,
        prompt,
        providerId: ctx.providerId,
        sessionProviderId: ctx.sessionProviderId,
        model: ctx.parentModel,
        permissionContext,
      });
      const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);

      // Check for multi-head provider logic
      const { resolveAgentModel } = await import('../agent-routing');
      const { providerId: finalProviderId, model: finalModel } = resolveAgentModel(
        agentDef,
        ctx.providerId,
        ctx.parentModel
      );

      // Build system prompt
      const systemPrompt = agentDef.prompt
        ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}`
        : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}`;

      // 生成稳定的子Agent ID，用于UI追踪
      const subAgentId = `subagent-${agentDef.id}-${Date.now()}`;

      // Emit subagent start event for UI tracking
      if (ctx.emitSSE) {
        ctx.emitSSE({
          type: 'subagent_start',
          data: JSON.stringify({
            id: subAgentId,
            name: agentDef.id,
            displayName: agentDef.displayName,
            prompt: prompt.length > 200 ? prompt.slice(0, 197) + '...' : prompt,
            model: finalModel,
          }),
        });
        ctx.emitSSE({ type: 'tool_output', data: `[subagent:${agentDef.id}] ${prompt.length > 120 ? prompt.slice(0, 117) + '...' : prompt}` });
      }

      const progress = createSubAgentProgressTracker({
        id: subAgentId,
        emitSSE: ctx.emitSSE,
        initialStage: profile.initialStatus,
        sla: profile.sla,
      });

      const fastPathResult = await tryExecuteSubAgentFastPath({
        agentId: agentDef.id,
        prompt,
        workingDirectory: ctx.workingDirectory,
        tools: subTools,
        abortSignal: ctx.abortSignal,
        onStage: (stage, detail) => {
          progress.setStage(stage);
          if (ctx.emitSSE && detail) {
            ctx.emitSSE({
              type: 'subagent_progress',
              data: JSON.stringify({
                id: subAgentId,
                detail: `${detail}\n`,
                append: true,
              }),
            });
          }
        },
      });

      if (fastPathResult) {
        progress.setStage('整理子任务结果');
        progress.close();
        if (ctx.emitSSE) {
          ctx.emitSSE({
            type: 'subagent_complete',
            data: JSON.stringify({
              id: subAgentId,
              report: fastPathResult.report,
            }),
          });
        }
        return fastPathResult.report;
      }

      // Run sub-agent loop and collect the full response
      const stream = runAgentLoop({
        prompt,
        sessionId: subAgentId,
        providerId: finalProviderId,
        sessionProviderId: ctx.sessionProviderId,
        model: finalModel,
        systemPrompt,
        workingDirectory: ctx.workingDirectory,
        tools: subTools,
        maxSteps: agentDef.maxSteps || 30,
        permissionMode: ctx.permissionMode, // inherit from parent
      });

      // Collect text from the stream
      const reader = stream.getReader();
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolResults: Array<{ name: string; content: string; isError: boolean }> = [];
      let errorEvent: string | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse SSE events, extract text content and forward permission requests
          if (value) {
            const lines = value.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                progress.touch();
                if (event.type === 'text') {
                  progress.setStage('整理子任务结果');
                  textParts.push(event.data);
                } else if (event.type === 'thinking') {
                  // 收集thinking作为后备输出
                  progress.setStage('模型思考中');
                  thinkingParts.push(event.data);
                } else if (event.type === 'error') {
                  // 收集错误事件
                  progress.setStage('子任务执行出错');
                  try {
                    const errData = JSON.parse(event.data);
                    errorEvent = errData.userMessage || event.data;
                  } catch {
                    errorEvent = event.data;
                  }
                } else if (event.type === 'tool_result') {
                  // 收集工具结果用于生成fallback摘要
                  progress.setStage('分析工具结果');
                  try {
                    const res = JSON.parse(event.data);
                    const toolName = res.tool_use_id ? 'tool' : 'unknown';
                    toolResults.push({
                      name: toolName,
                      content: String(res.content || '').slice(0, 2000),
                      isError: !!res.is_error,
                    });
                  } catch { /* skip malformed */ }
                  // 同时转发到父流
                  if (ctx.emitSSE) {
                    try {
                      const res = JSON.parse(event.data);
                      const status = res.is_error ? 'x' : '+';
                      ctx.emitSSE({ type: 'tool_output', data: `[${status}] done` });
                    } catch { /* skip malformed */ }
                  }
                } else if (event.type === 'permission_request' && ctx.emitSSE) {
                  // Forward permission requests to parent stream so the
                  // client can show the approval UI for sub-agent tool calls
                  progress.setStage('等待权限确认');
                  ctx.emitSSE(event);
                } else if (event.type === 'keep_alive' && ctx.emitSSE) {
                  ctx.emitSSE({ type: 'keep_alive', data: '' });
                } else if (event.type === 'tool_use' && ctx.emitSSE) {
                  // Forward subagent tool invocations as tool_output progress
                  try {
                    const tool = JSON.parse(event.data);
                    const toolRenderer = getToolSummary(tool.name, tool.input);
                    progress.setStage(`执行工具: ${toolRenderer}`);
                    ctx.emitSSE({ type: 'tool_output', data: `> ${toolRenderer}` });
                  } catch { /* skip malformed */ }
                }
              } catch { /* skip non-JSON lines */ }
            }
          }
        }
      } finally {
        progress.close();
        reader.releaseLock();
      }

      // 生成最终报告
      let finalReport: string;
      if (textParts.length > 0) {
        finalReport = textParts.join('');
      } else if (errorEvent) {
        finalReport = `**子Agent执行出错：** ${errorEvent}`;
      } else if (thinkingParts.length > 0 || toolResults.length > 0) {
        const parts: string[] = [];
        if (thinkingParts.length > 0) {
          const thinkingText = thinkingParts.join('').trim();
          if (thinkingText) {
            parts.push('**思考过程：**\n' + thinkingText.slice(0, 3000));
          }
        }
        if (toolResults.length > 0) {
          parts.push(`**执行了 ${toolResults.length} 个工具：**`);
          for (const tr of toolResults.slice(0, 10)) {
            const preview = tr.content.slice(0, 500).replace(/\n/g, ' ');
            parts.push(`- ${tr.name}: ${preview}${tr.content.length > 500 ? '...' : ''}`);
          }
        }
        finalReport = parts.join('\n\n');
      } else {
        finalReport = '(Sub-agent produced no text output)';
      }

      // 发送子Agent完成事件
      if (ctx.emitSSE) {
        ctx.emitSSE({
          type: 'subagent_complete',
          data: JSON.stringify({
            id: subAgentId,
            report: finalReport,
            error: errorEvent || undefined,
          }),
        });
      }

      return finalReport;
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────

/** Build a one-line summary of a tool invocation for subagent progress output. */
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

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    // Whitelist mode: only include specified tools
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }

  if (disallowedTools && disallowedTools.length > 0) {
    // Blacklist mode: include all except specified
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, tool] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = tool;
    }
    return filtered;
  }

  return allTools;
}
