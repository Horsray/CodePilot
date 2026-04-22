import { getAgent } from './agent-registry';
import { runAgentLoop } from './agent-loop';
import { assembleTools } from './agent-tools';
import type { ToolSet } from 'ai';

export interface TeamRunnerOptions {
  goal: string;
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
}

function filterTools(allTools: ToolSet, allowedTools?: string[], disallowedTools?: string[]): ToolSet {
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

/**
 * 发射窗口事件供TeamLeaderWidget监听
 */
function emitTeamEvent(type: string, data: Record<string, unknown>) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(type, { detail: data }));
  }
}

export async function runTeamPipeline(options: TeamRunnerOptions): Promise<string> {
  const { goal, workingDirectory, emitSSE, abortSignal } = options;

  // 定义pipeline
  const pipeline = [
    { role: 'search', desc: '探索代码库并收集相关上下文' },
    { role: 'planner', desc: '制定技术方案和修改计划' },
    { role: 'executor', desc: '执行代码修改' },
    { role: 'verifier', desc: '验证修改结果并进行复核' }
  ];

  // 发射team_start事件供TeamLeaderWidget使用
  emitTeamEvent('team_start', {
    goal,
    agents: pipeline.map(p => p.role),
    startedAt: Date.now(),
  });

  if (emitSSE) {
    // 隐藏主 Agent 发送的额外文本
    // emitSSE({ type: 'text', data: `\n\n🚀 **启动 OMC Team 管线**\n目标：_${goal}_\n\n` });
  }

  let accumulatedContext = `Team Goal: ${goal}\n\n`;

  for (const step of pipeline) {
    if (abortSignal?.aborted) break;

    const agentDef = getAgent(step.role);
    if (!agentDef) continue;

    const model = agentDef.model || options.parentModel;

    // 发射team_agent_start事件
    emitTeamEvent('team_agent_start', {
      agent: step.role,
      desc: step.desc,
      model,
      startedAt: Date.now(),
    });

    if (emitSSE) {
      emitSSE({ type: 'tool_output', data: JSON.stringify({ agent: step.role, event: 'start', model }) + '\n' });
    }

    const prompt = `Your role is ${step.role}. Your task is: ${step.desc}.\n\nOverall Team Goal: ${goal}\n\nContext from previous steps:\n${accumulatedContext}\n\nPlease perform your specialized task. You MUST output a clear, detailed summary of your findings or actions when you finish.`;

    const permissionContext = (options.parentSessionId && options.emitSSE && options.permissionMode)
      ? {
          sessionId: options.parentSessionId,
          permissionMode: (options.permissionMode || 'trust') as import('./permission-checker').PermissionMode,
          emitSSE: options.emitSSE,
          abortSignal: options.abortSignal,
        }
      : undefined;

    const { tools: allTools } = assembleTools({
      workingDirectory,
      providerId: options.providerId,
      sessionProviderId: options.sessionProviderId,
      model: options.parentModel,
      permissionContext,
    });

    const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);
    const systemPrompt = agentDef.prompt
      ? `${agentDef.prompt}\n\nWorking directory: ${workingDirectory}\n\nCRITICAL RULE: You are a sub-agent in a team. You MUST provide a clear, detailed final report of your findings or actions before you finish. Do NOT just output your internal thoughts.`
      : `You are a helpful sub-agent in a team. Working directory: ${workingDirectory}\n\nCRITICAL RULE: You are a sub-agent in a team. You MUST provide a clear, detailed final report of your findings or actions before you finish. Do NOT just output your internal thoughts.`;

    const stream = runAgentLoop({
      prompt,
      sessionId: `team-${step.role}-${Date.now()}`,
      providerId: options.providerId,
      sessionProviderId: options.sessionProviderId,
      model,
      systemPrompt,
      workingDirectory,
      tools: subTools,
      maxSteps: agentDef.maxSteps || 30,
      permissionMode: options.permissionMode,
    });

    const reader = stream.getReader();
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolResults: Array<{ content: string; isError: boolean }> = [];
    let errorEvent: string | null = null;

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
              if (event.type === 'permission_request' && emitSSE) {
                emitSSE(event);
              } else {
                if (event.type === 'text') {
                  textParts.push(event.data);
                } else if (event.type === 'thinking') {
                  thinkingParts.push(event.data);
                } else if (event.type === 'error') {
                  try {
                    const errData = JSON.parse(event.data);
                    errorEvent = errData.userMessage || event.data;
                  } catch {
                    errorEvent = event.data;
                  }
                } else if (event.type === 'tool_result') {
                  try {
                    const res = JSON.parse(event.data);
                    // Handle null/undefined content, or the string "null" from JSON.stringify(null)
                    let content = res.content;
                    if (content == null || content === 'null') {
                      content = '';
                    } else {
                      content = String(content);
                    }
                    toolResults.push({
                      content: content.slice(0, 2000),
                      isError: !!res.is_error,
                    });
                  } catch { }
                } else if (event.type === 'tool_use') {
                  // 发射tool_use进度事件
                  try {
                    const toolData = JSON.parse(event.data);
                    emitTeamEvent('team_agent_update', {
                      agent: step.role,
                      status: 'running',
                      progress: `执行工具: ${toolData.name}`,
                    });
                  } catch { }
                }
                if (emitSSE) {
                  emitSSE({ type: 'tool_output', data: JSON.stringify({ agent: step.role, payload: event }) + '\n' });
                }
              }
            } catch { }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    let report: string;
    if (textParts.length > 0) {
      report = textParts.join('');
    } else if (errorEvent) {
      report = `**执行出错：** ${errorEvent}`;
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
          parts.push(`- ${tr.isError ? '❌' : '✅'} ${preview}${tr.content.length > 500 ? '...' : ''}`);
        }
      }
      report = parts.join('\n\n');
    } else {
      report = '(No report provided)';
    }
    accumulatedContext += `\n\n--- Report from ${step.role} ---\n${report}\n`;

    // 发射team_agent_done事件
    emitTeamEvent('team_agent_done', {
      agent: step.role,
      status: errorEvent ? 'error' : 'completed',
      report,
      error: errorEvent || undefined,
      completedAt: Date.now(),
    });

    if (emitSSE) {
      emitSSE({ type: 'tool_output', data: JSON.stringify({ agent: step.role, event: 'done' }) + '\n' });
    }
  }

  // 发射team_done事件
  emitTeamEvent('team_done', {
    summary: 'OMC Team 管线全部执行完毕',
    completedAt: Date.now(),
  });

  if (emitSSE) {
    emitSSE({ type: 'text', data: `\n\n🎉 **OMC Team 管线全部执行完毕**\n请查阅上方各智能体的执行报告。` });
  }

  return accumulatedContext;
}
