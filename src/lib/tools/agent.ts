/**
 * tools/agent.ts — AgentTool: spawn a sub-agent with isolated context.
 *
 * The sub-agent runs an independent agent-loop with restricted tools
 * and a separate message history. Results are returned as text to the parent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getAgent, getSubAgents, discoverPluginAgents } from '../agent-registry';
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
  // Discover and register OMC/plugin agents before building the agent list.
  discoverPluginAgents(ctx.workingDirectory);

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
        executionMode: 'spawn', // Sub-agents use isolated spawn, no PTY contention
      });
      const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);

      // Check for multi-head provider logic
      const { resolveAgentModel } = await import('../agent-routing');
      const { providerId: finalProviderId, model: finalModel } = resolveAgentModel(
        agentDef,
        ctx.providerId,
        ctx.parentModel
      );

      // Build system prompt — OMC-style non-nesting constraints
      const SUBAGENT_CONSTRAINTS = `\n\nCONSTRAINTS (CRITICAL):
- You are a sub-agent. You CANNOT spawn sub-agents or use the Agent/Team tools.
- Work directly with your available tools (Read, Write, Edit, Bash, Glob, Grep).
- Do NOT delegate. Complete your task yourself and provide a clear final report.`;

      const systemPrompt = agentDef.prompt
        ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}${SUBAGENT_CONSTRAINTS}`
        : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}${SUBAGENT_CONSTRAINTS}`;

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
            source: 'native_agent_tool',
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
        onProgress: (detail) => {
          ctx.emitSSE?.({
            type: 'subagent_progress',
            data: JSON.stringify({
              id: subAgentId,
              detail,
              append: true,
            }),
          });
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
              source: 'native_agent_tool',
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
      let timedOut = false;

      // 中文注释：功能名称「子agent超时检测」，用法是当子agent在60秒内没有任何活动
      // （文本输出、工具调用、思考等）时，自动终止流并生成报告，防止无限等待
      const SUBAGENT_TIMEOUT_MS = 60_000; // 60秒超时
      let lastActivityAt = Date.now();

      const checkTimeout = () => {
        const elapsed = Date.now() - lastActivityAt;
        if (elapsed > SUBAGENT_TIMEOUT_MS) {
          console.warn(`[agent] Sub-agent "${agentDef.id}" timed out after ${Math.round(elapsed / 1000)}s of inactivity`);
          return true;
        }
        return false;
      };

      // 定期检测超时的定时器
      const timeoutTimer = setInterval(() => {
        if (checkTimeout()) {
          timedOut = true;
          reader.cancel().catch(() => {});
        }
      }, 5_000); // 每5秒检测一次

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (timedOut) break;

          // Parse SSE events, extract text content and forward permission requests
          if (value) {
            const lines = value.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                progress.touch();
                // 中文注释：功能名称「子agent活动检测」，用法是只有真实活动事件才更新活动时间戳
                // keep_alive是心跳事件，不应刷新超时计时器，否则超时检测永远不触发
                if (event.type !== 'keep_alive') {
                  lastActivityAt = Date.now();
                }
                if (event.type === 'text') {
                  progress.setStage('整理子任务结果');
                  textParts.push(event.data);
                  if (ctx.emitSSE) ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: event.data, append: true }) });
                } else if (event.type === 'thinking') {
                  // 收集thinking作为后备输出
                  progress.setStage('模型思考中');
                  thinkingParts.push(event.data);
                  if (ctx.emitSSE) ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: event.data, append: true }) });
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
                  progress.setStage('等待模型响应');
                  try {
                    const res = JSON.parse(event.data);
                    const toolName = res.tool_use_id ? 'tool' : 'unknown';
                  toolResults.push({
                    name: toolName,
                    content: String(res.content || '').slice(0, 2000),
                    isError: !!res.is_error,
                  });
                  // Emit result preview for transparency
                  if (ctx.emitSSE) {
                    const preview = String(res.content || '').slice(0, 200).replace(/\n/g, ' ');
                    const progressMsg = `\n📋 结果: ${res.is_error ? '❌' : '✅'} ${preview}${String(res.content || '').length > 200 ? '...' : ''}\n\n`;
                    ctx.emitSSE({
                      type: 'subagent_progress',
                      data: JSON.stringify({ id: subAgentId, detail: progressMsg, append: true }),
                    });
                  }
                } catch { /* skip malformed */ }
                  // 同时转发到父流
                  if (ctx.emitSSE) {
                    try {
                      const res = JSON.parse(event.data);
                      const status = res.is_error ? 'x' : '+';
                      ctx.emitSSE({ type: 'tool_output', data: `[${status}] done` });
                    } catch { /* skip malformed */ }
                  }
                } else if (event.type === 'tool_finished' && ctx.emitSSE) {
                  progress.setStage('等待模型响应');
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
                    ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: `\n🛠️ 准备执行工具: ${tool.name}\n`, append: true }) });
                  } catch { /* skip malformed */ }
                }
              } catch { /* skip non-JSON lines */ }
            }
          }
        }
      } finally {
        clearInterval(timeoutTimer);
        progress.close();
        reader.releaseLock();
      }

      // 生成最终报告
      let finalReport: string;
      if (timedOut) {
        // 超时终止：基于已收集的工具结果和thinking生成报告
        const parts: string[] = [];
        parts.push(`**⏱️ 子Agent执行超时（60秒无活动），已自动终止。**`);
        if (toolResults.length > 0) {
          parts.push(`\n**已执行 ${toolResults.length} 个工具：**`);
          for (const tr of toolResults.slice(0, 10)) {
            const preview = tr.content.slice(0, 500).replace(/\n/g, ' ');
            parts.push(`- ${tr.name}: ${preview}${tr.content.length > 500 ? '...' : ''}`);
          }
        }
        if (thinkingParts.length > 0) {
          const thinkingText = thinkingParts.join('').trim();
          if (thinkingText) {
            parts.push('\n**思考过程：**\n' + thinkingText.slice(0, 3000));
          }
        }
        parts.push('\n> 子Agent可能因模型响应缓慢或陷入循环而超时。建议检查任务复杂度或更换模型。');
        finalReport = parts.join('\n');
      } else if (textParts.length > 0) {
        finalReport = textParts.join('');
      } else if (errorEvent && errorEvent.includes('模型未返回任何内容') && finalModel !== ctx.parentModel) {
        // EMPTY_RESPONSE from routed model — retry with parent model as fallback
        console.warn(`[agent] Sub-agent "${agentDef.id}" got empty response from model="${finalModel}", retrying with parentModel="${ctx.parentModel}"`);
        progress.setStage('模型不兼容，回退重试中');
        const fallbackStream = runAgentLoop({
          prompt,
          sessionId: `${subAgentId}-retry`,
          providerId: ctx.providerId || finalProviderId,
          sessionProviderId: ctx.sessionProviderId,
          model: ctx.parentModel,
          systemPrompt,
          workingDirectory: ctx.workingDirectory,
          tools: subTools,
          maxSteps: agentDef.maxSteps || 30,
          permissionMode: ctx.permissionMode,
        });
        const fallbackReader = fallbackStream.getReader();
        const fallbackTextParts: string[] = [];
        try {
          while (true) {
            const { done, value } = await fallbackReader.read();
            if (done) break;
            if (value) {
              for (const line of value.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const ev = JSON.parse(line.slice(6));
                  progress.touch();
                  if (ev.type === 'text') {
                    fallbackTextParts.push(ev.data);
                    if (ctx.emitSSE) ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: ev.data, append: true }) });
                  }
                  else if (ev.type === 'tool_use' && ctx.emitSSE) {
                    try {
                      const tool = JSON.parse(ev.data);
                      const toolRenderer = getToolSummary(tool.name, tool.input);
                      progress.setStage(`回退执行: ${toolRenderer}`);
                      ctx.emitSSE({ type: 'tool_output', data: `> [fallback] ${toolRenderer}` });
                      ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: `\n🛠️ 准备执行工具: ${tool.name}\n`, append: true }) });
                    } catch { /* skip */ }
                  }
                  else if (ev.type === 'tool_result' && ctx.emitSSE) {
                    try {
                      const res = JSON.parse(ev.data);
                      const preview = String(res.content || '').slice(0, 200).replace(/\n/g, ' ');
                      const progressMsg = `\n📋 结果: ${res.is_error ? '❌' : '✅'} ${preview}${String(res.content || '').length > 200 ? '...' : ''}\n\n`;
                      ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: progressMsg, append: true }) });
                    } catch { /* skip */ }
                  }
                  else if (ev.type === 'thinking' && ctx.emitSSE) {
                    ctx.emitSSE({ type: 'subagent_progress', data: JSON.stringify({ id: subAgentId, detail: ev.data, append: true }) });
                  }
                  else if (ev.type === 'permission_request' && ctx.emitSSE) {
                    progress.setStage('等待权限确认');
                    ctx.emitSSE(ev);
                  }
                  else if (ev.type === 'tool_finished' && ctx.emitSSE) {
                    progress.setStage('等待模型响应');
                  }
                } catch { /* skip non-JSON */ }
              }
            }
          }
        } finally {
          fallbackReader.releaseLock();
        }
        if (fallbackTextParts.length > 0) {
          finalReport = fallbackTextParts.join('');
          errorEvent = null; // clear error since fallback succeeded
        } else {
          finalReport = `**子Agent执行出错：** 原始模型 "${finalModel}" 返回空内容，回退到父模型 "${ctx.parentModel}" 也未产出有效输出。`;
        }
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
            source: 'native_agent_tool',
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
