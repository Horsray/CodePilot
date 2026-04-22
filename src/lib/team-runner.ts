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

export async function runTeamPipeline(options: TeamRunnerOptions): Promise<string> {
  const { goal, workingDirectory, emitSSE, abortSignal } = options;
  
  if (emitSSE) {
    emitSSE({ type: 'text', data: `\n\n🚀 **启动 OMC Team 管线**\n目标：_${goal}_\n\n` });
  }

  const pipeline = [
    { role: 'search', desc: '探索代码库并收集相关上下文' },
    { role: 'planner', desc: '制定技术方案和修改计划' },
    { role: 'executor', desc: '执行代码修改' },
    { role: 'verifier', desc: '验证修改结果并进行复核' }
  ];

  let accumulatedContext = `Team Goal: ${goal}\n\n`;

  for (const step of pipeline) {
    if (abortSignal?.aborted) break;

    const agentDef = getAgent(step.role);
    if (!agentDef) continue;

    if (emitSSE) {
      emitSSE({ type: 'tool_output', data: `[team:${step.role}] start` });
      emitSSE({ type: 'text', data: `\n---\n### 👨‍💻 正在派遣 [${step.role}] 智能体\n> 任务：${step.desc}\n\n` });
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
    const model = agentDef.model || options.parentModel;
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
                // Also stream the agent's thought process to the main UI!
                if (emitSSE) {
                  emitSSE({ type: 'text', data: event.data });
                }
              } else if (event.type === 'permission_request' && emitSSE) {
                emitSSE(event);
              } else if (event.type === 'tool_use' && emitSSE) {
                try {
                  const t = JSON.parse(event.data);
                  const cmd = t.input?.command || t.input?.pattern || t.input?.file_path || t.name;
                  emitSSE({ type: 'tool_output', data: `[team:${step.role}] > ${t.name}: ${cmd}` });
                } catch { }
              } else if (event.type === 'tool_result' && emitSSE) {
                try {
                  const res = JSON.parse(event.data);
                  const status = res.is_error ? '[x]' : '[+]';
                  emitSSE({ type: 'tool_output', data: `[team:${step.role}] ${status} done` });
                } catch { }
              }
            } catch { }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const report = textParts.join('') || '(No report provided)';
    accumulatedContext += `\n\n--- Report from ${step.role} ---\n${report}\n`;

    if (emitSSE) {
      emitSSE({ type: 'tool_output', data: `[team:${step.role}] done` });
      emitSSE({ type: 'text', data: `\n\n✅ **[${step.role}] 任务完成**\n\n` });
    }
  }

  if (emitSSE) {
    emitSSE({ type: 'text', data: `\n\n🎉 **OMC Team 管线全部执行完毕**\n请查阅上方各智能体的执行报告。` });
  }

  return accumulatedContext;
}