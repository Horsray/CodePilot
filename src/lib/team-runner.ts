import { getAgent, getSubAgents, normalizeAgentId } from './agent-registry';
import { runAgentLoop } from './agent-loop';
import { assembleTools } from './agent-tools';
import type { ToolSet } from 'ai';
import { resolveAgentModel } from './agent-routing';
import { truncateToTokenBudget } from './context-pruner';
import { roughTokenEstimate } from './context-estimator';
import { buildSubAgentExecutionProfile } from './subagent-profile';
import { createSubAgentProgressTracker } from './subagent-progress';
import { isSimpleLocalLookupTask, isSimpleWebLookupTask, tryExecuteSubAgentFastPath } from './subagent-fast-path';
import { buildTeamOrchestrationPrompt } from './team-orchestration-prompt';
import {
  appendTeamEvent,
  completeTeamRuntime,
  createTeamRuntime,
  setTeamTasks,
  updateTeamStage,
  updateTeamTask,
  writeTeamHandoff,
  type TeamRuntimeHandle,
} from './team-runtime';

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
  teamRuntime?: TeamRuntimeHandle;
}

interface DAGTask {
  id: string;
  role: string;
  desc: string;
  dependsOn: string[];
}

interface TeamDAG {
  tasks: DAGTask[];
}

/** Hard cap on DAG task count — prevents planner from generating excessive tasks */
const MAX_DAG_TASKS = 6;

function stageForRole(role: string): 'team-exec' | 'team-verify' | 'team-fix' {
  const normalized = normalizeAgentId(role);
  if (['verifier', 'code-reviewer', 'security-reviewer', 'qa-tester'].includes(normalized)) return 'team-verify';
  if (normalized === 'debugger') return 'team-fix';
  return 'team-exec';
}

function estimateTaskPromptTokens(task: DAGTask, context: string): number {
  return roughTokenEstimate(`${task.role}\n${task.desc}\n${context}`);
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

/**
 * executeAgentTask - 单个智能体任务执行器
 * 功能：运行单个智能体完成指定任务，收集日志、工具结果，并通过 SSE 汇报进度
 * 用法：由并行调度器（runTeamPipeline）调用，处理 DAG 中的单个节点任务
 */
async function executeAgentTask(
  task: DAGTask,
  options: TeamRunnerOptions,
  accumulatedContext: string
): Promise<{ report: string; errorEvent: string | null; role: string }> {
  const { workingDirectory, emitSSE, abortSignal } = options;
  const role = normalizeAgentId(task.role);
  let agentDef = getAgent(role);
  if (!agentDef) {
    // 中文注释：如果找不到注册的 Agent（比如大模型幻觉了 call_function_xxx），不要直接报错中断，而是降级使用通用的 subagent 执行。
    console.warn(`[team-runner] Unknown agent role: ${role}. Falling back to general subagent.`);
    agentDef = getAgent('general') || getAgent('subagent') || {
      id: role,
      displayName: '智能体',
      description: '通用任务执行智能体',
      mode: 'subagent',
    };
  }
  const profile = buildSubAgentExecutionProfile(agentDef, task.desc);

  const { providerId: finalProviderId, model: finalModel } = resolveAgentModel(
    agentDef,
    options.providerId,
    options.parentModel
  );

  emitTeamEvent('team_agent_start', {
    id: task.id,
    name: role,
    displayName: agentDef.displayName || role,
    prompt: task.desc,
    model: finalModel,
    startedAt: Date.now(),
  });

  const subAgentId = `team-${role}-${Date.now()}`;
  if (options.teamRuntime) {
    updateTeamTask(options.teamRuntime, task.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  }
  
  // 防止 Team 模式下的上下文溢出 (Truncate to reasonable token limit)
  const safeContext = truncateToTokenBudget(accumulatedContext, 8000); // Reduced from 15000 to cut token cost
  
  const prompt = `Your role is ${role}. Your task is: ${task.desc}.\n\nOverall Team Goal: ${options.goal}\n\nContext from previous steps:\n${safeContext}\n\nWorking Directory: ${workingDirectory}\n\nPlease perform your specialized task. You MUST output a clear, detailed summary of your findings or actions when you finish.`;

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
    prompt: task.desc,
    providerId: finalProviderId,
    sessionProviderId: options.sessionProviderId,
    model: finalModel,
    permissionContext,
    executionMode: 'spawn', // Team agents use isolated spawn, no PTY contention
  });

  const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);
  // OMC-style: non-nesting constraints for sub-agents
  const SUBAGENT_CONSTRAINTS = `\n\nCONSTRAINTS (CRITICAL):
- You are a sub-agent in a team. You CANNOT spawn sub-agents or use the Agent/Team tools.
- Work directly with your available tools. Do NOT delegate.
- You MUST provide a clear, detailed final report of your findings or actions before you finish.`;
  const systemPrompt = agentDef.prompt
    ? `${agentDef.prompt}\n\nWorking directory: ${workingDirectory}${SUBAGENT_CONSTRAINTS}`
    : `You are a helpful sub-agent in a team. Working directory: ${workingDirectory}${SUBAGENT_CONSTRAINTS}`;

  if (emitSSE) {
    emitSSE({
      type: 'subagent_start',
      data: JSON.stringify({
        id: subAgentId,
        name: role,
        displayName: agentDef.displayName || role,
        prompt: task.desc,
        model: finalModel,
      }),
    });
    emitSSE({ type: 'tool_output', data: `[subagent:${role}] ${task.desc}\n` });
  }

  const progress = createSubAgentProgressTracker({
    id: subAgentId,
    emitSSE,
    initialStage: profile.initialStatus,
    sla: profile.sla,
  });

  const fastPathResult = await tryExecuteSubAgentFastPath({
    agentId: agentDef.id,
    prompt: task.desc,
    workingDirectory,
    tools: subTools,
    abortSignal,
    onStage: (stage, detail) => {
      progress.setStage(stage);
      emitTeamEvent('team_agent_update', {
        id: task.id,
        name: role,
        status: 'running',
        progress: detail ? `${stage}: ${detail}` : stage,
      });
      if (emitSSE && detail) {
        emitSSE({
          type: 'subagent_progress',
          data: JSON.stringify({ id: subAgentId, detail: `${detail}\n`, append: true }),
        });
      }
    },
    onProgress: (detail) => {
      if (emitSSE) {
        emitSSE({
          type: 'subagent_progress',
          data: JSON.stringify({ id: subAgentId, detail, append: true }),
        });
      }
    },
  });

  if (fastPathResult) {
    const report = `**📝 最终输出：**\n${fastPathResult.report}`;
    progress.setStage('整理子任务结果');
    progress.close();

    emitTeamEvent('team_agent_done', {
      id: task.id,
      name: role,
      displayName: agentDef.displayName || role,
      prompt: task.desc,
      model: finalModel,
      status: 'completed',
      report,
      completedAt: Date.now(),
    });

    if (emitSSE) {
      emitSSE({
        type: 'subagent_complete',
        data: JSON.stringify({
          id: subAgentId,
          report,
        }),
      });
      emitSSE({ type: 'tool_output', data: `[+] done\n\n` });
    }
    if (options.teamRuntime) {
      updateTeamTask(options.teamRuntime, task.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    }

    return { report, errorEvent: null, role };
  }

  const stream = runAgentLoop({
    prompt,
    sessionId: subAgentId,
    providerId: finalProviderId,
    sessionProviderId: options.sessionProviderId,
    model: finalModel,
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
  let taskFailed = false;
  let timedOut = false;

  // 中文注释：功能名称「子agent超时检测」，用法是当子agent在60秒内没有任何活动
  // （文本输出、工具调用、思考等）时，自动终止流并生成报告，防止无限等待
  const SUBAGENT_TIMEOUT_MS = 60_000; // 60秒超时
  let lastActivityAt = Date.now();

  const checkTimeout = () => {
    const elapsed = Date.now() - lastActivityAt;
    if (elapsed > SUBAGENT_TIMEOUT_MS) {
      console.warn(`[team-runner] Sub-agent "${role}" timed out after ${Math.round(elapsed / 1000)}s of inactivity`);
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

      if (value) {
        const lines = value.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            // 中文注释：功能名称「子agent活动检测」，用法是只有真实活动事件才更新活动时间戳
            // keep_alive是心跳事件，不应刷新超时计时器，否则超时检测永远不触发
            if (event.type !== 'keep_alive') {
              lastActivityAt = Date.now();
              progress.touch();
            }
            if (event.type === 'permission_request' && emitSSE) {
              progress.setStage('等待权限确认');
              emitSSE(event);
            } else if (event.type === 'keep_alive' && emitSSE) {
              emitSSE({ type: 'keep_alive', data: '' });
            } else if (event.type === 'terminal_mirror' && emitSSE) {
              emitSSE(event);
            } else {
              if (event.type === 'text') {
                progress.setStage('整理子任务结果');
                textParts.push(event.data);
              } else if (event.type === 'thinking') {
                progress.setStage('模型思考中');
                thinkingParts.push(event.data);
              } else if (event.type === 'error') {
                taskFailed = true;
                progress.setStage('子任务执行出错');
                try {
                  const errData = JSON.parse(event.data);
                  errorEvent = errData.userMessage || event.data;
                } catch {
                  errorEvent = event.data;
                }
              } else if (event.type === 'tool_result') {
                progress.setStage('分析工具结果');
                try {
                  const res = JSON.parse(event.data);
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
                try {
                  const toolData = JSON.parse(event.data);
                  progress.setStage(`执行工具: ${toolData.name}`);
                  emitTeamEvent('team_agent_update', {
                    id: task.id,
                    name: role,
                    status: 'running',
                    progress: `执行工具: ${toolData.name}`,
                  });
                } catch { }
              }
              if (emitSSE) {
                  let progressMsg = '';
                  if (event.type === 'text') progressMsg = event.data;
                  else if (event.type === 'tool_use') {
                    try {
                      const toolData = JSON.parse(event.data);
                      progressMsg = `\n🛠️ 准备执行工具: ${toolData.name}\n`;
                    } catch { }
                  }
                  else if (event.type === 'tool_result') {
                    try {
                      const res = JSON.parse(event.data);
                      const preview = String(res.content || '').slice(0, 200).replace(/\n/g, ' ');
                      progressMsg = `\n📋 结果: ${res.is_error ? '❌' : '✅'} ${preview}${String(res.content || '').length > 200 ? '...' : ''}\n\n`;
                    } catch { }
                  }
                  else if (event.type === 'thinking') progressMsg = event.data;
                  else if (event.type === 'tool_output') progressMsg = event.data;
                
                if (progressMsg) {
                  emitSSE({
                    type: 'subagent_progress',
                    data: JSON.stringify({ id: subAgentId, detail: progressMsg, append: true })
                  });
                }
              }
            }
          } catch { }
        }
      }
    }
  } catch (streamErr: unknown) {
    // Stream interrupted (network disconnect, client abort, etc.)
    taskFailed = true;
    progress.setStage('子任务执行中断');
    const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
    if (!errorEvent) {
      errorEvent = `任务执行中断: ${errMsg}`;
    }
    console.warn(`[team-runner] executeAgentTask stream error for ${role}:`, errMsg);
  } finally {
    clearInterval(timeoutTimer);
    progress.close();
    reader.releaseLock();
  }

  // 超时处理：基于已收集的工具结果和thinking生成报告
  if (timedOut) {
    const parts: string[] = [];
    parts.push(`**⏱️ 子Agent执行超时（60秒无活动），已自动终止。**`);
    if (toolResults.length > 0) {
      parts.push(`\n**已执行 ${toolResults.length} 个工具：**`);
      for (const tr of toolResults.slice(0, 10)) {
        const preview = tr.content.slice(0, 800).replace(/\n/g, ' ');
        parts.push(`- ${tr.isError ? '❌' : '✅'} ${preview}${tr.content.length > 800 ? '...' : ''}`);
      }
    }
    if (thinkingParts.length > 0) {
      const thinkingText = thinkingParts.join('').trim();
      if (thinkingText) {
        parts.push('\n**思考过程：**\n' + thinkingText.slice(0, 3000));
      }
    }
    parts.push('\n> 子Agent可能因模型响应缓慢或陷入循环而超时。建议检查任务复杂度或更换模型。');
    const timeoutReport = parts.join('\n');
    
    emitTeamEvent('team_agent_done', {
      id: task.id,
      name: role,
      displayName: agentDef.displayName || role,
      prompt: task.desc,
      model: finalModel,
      status: 'completed',
      report: timeoutReport,
      completedAt: Date.now(),
    });

    if (emitSSE) {
      emitSSE({
        type: 'subagent_complete',
        data: JSON.stringify({
          id: subAgentId,
          report: timeoutReport,
        }),
      });
      emitSSE({ type: 'tool_output', data: `[+] done (timeout)\n\n` });
    }
    if (options.teamRuntime) {
      updateTeamTask(options.teamRuntime, task.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: 'Sub-agent timed out after 60s of inactivity',
      });
    }

    return { report: timeoutReport, errorEvent: null, role };
  }

  // EMPTY_RESPONSE fallback: if routed model returned nothing, retry with parent model
  if (errorEvent && errorEvent.includes('模型未返回任何内容') && finalModel !== options.parentModel) {
    console.warn(`[team-runner] Agent "${role}" got empty response from model="${finalModel}", retrying with parentModel="${options.parentModel}"`);
    progress.setStage('模型不兼容，回退重试中');
    const fallbackStream = runAgentLoop({
      prompt,
      sessionId: `${subAgentId}-retry`,
      providerId: options.providerId,
      sessionProviderId: options.sessionProviderId,
      model: options.parentModel,
      systemPrompt,
      workingDirectory,
      tools: subTools,
      maxSteps: agentDef.maxSteps || 30,
      permissionMode: options.permissionMode,
    });
    const fallbackReader = fallbackStream.getReader();
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
                textParts.push(ev.data);
              } else if (ev.type === 'thinking') {
                thinkingParts.push(ev.data);
              } else if (ev.type === 'tool_use' && emitSSE) {
                try {
                  const toolData = JSON.parse(ev.data);
                  emitSSE({
                    type: 'subagent_progress',
                    data: JSON.stringify({ id: subAgentId, detail: `\n🛠️ [fallback] ${toolData.name}\n`, append: true }),
                  });
                } catch { /* skip */ }
              }
            } catch { /* skip non-JSON */ }
          }
        }
      }
    } finally {
      fallbackReader.releaseLock();
    }
    if (textParts.length > 0) {
      errorEvent = null; // clear error since fallback succeeded
      taskFailed = false;
    }
  }

  const parts: string[] = [];

  if (errorEvent) {
    parts.push(`**❌ 执行出错：**\n${errorEvent}\n`);
  }

  if (thinkingParts.length > 0) {
    const thinkingText = thinkingParts.join('').trim();
    if (thinkingText) {
      parts.push('**💭 思考过程：**\n' + thinkingText);
    }
  }

  if (toolResults.length > 0) {
    parts.push(`**🛠️ 工具执行 (${toolResults.length} 次)：**`);
    for (const tr of toolResults) {
      const preview = tr.content.slice(0, 800).replace(/\n/g, ' ');
      parts.push(`- ${tr.isError ? '❌' : '✅'} ${preview}${tr.content.length > 800 ? '...' : ''}`);
    }
  }

  if (textParts.length > 0) {
    parts.push('**📝 最终输出：**\n' + textParts.join(''));
  }

  let report = parts.join('\n\n');
  if (!report.trim()) {
    report = '(No report provided)';
  }

  emitTeamEvent('team_agent_done', {
    id: task.id,
    name: role,
    displayName: agentDef.displayName || role,
    prompt: task.desc,
    model: finalModel,
    status: errorEvent ? 'error' : 'completed',
    report,
    error: errorEvent || undefined,
    completedAt: Date.now(),
  });

  if (emitSSE) {
    emitSSE({
      type: 'subagent_complete',
      data: JSON.stringify({
        id: subAgentId,
        report,
        error: errorEvent || undefined,
      }),
    });
    emitSSE({ type: 'tool_output', data: `[+] done\n\n` });
  }
  if (options.teamRuntime) {
    updateTeamTask(options.teamRuntime, task.id, {
      status: errorEvent ? 'failed' : 'completed',
      completedAt: new Date().toISOString(),
      error: errorEvent || undefined,
    });
  }

  return { report, errorEvent, role };
}

/**
 * isSingleAgentTask - 检测是否为简单的单 agent 任务
 * 分析、审查、解释类任务通常不需要多 agent 协作
 */
function isSingleAgentTask(goal: string): boolean {
  // Short goals (under 80 chars) that are primarily analysis/review/explanation
  if (goal.length < 80) {
    const isAnalysis = /分析|审查|评审|解释|说明|review|analyze|explain|summarize|总结|describe|描述/i.test(goal);
    const isLookup = /查找|搜索|找到|哪里|哪个|find|where|search|locate/i.test(goal);
    if (isAnalysis || isLookup) return true;
  }
  return false;
}

/**
 * buildFallbackDAG - 智能 fallback DAG 生成器
 * 当 planner 输出无效 JSON 时，根据用户目标关键词动态构建合理的任务图
 */
function buildFallbackDAG(goal: string): TeamDAG {
  const lower = goal.toLowerCase();

  // Detect task type from goal keywords
  const isBugFix = /bug|fix|修复|错误|报错|崩溃|crash|error|broken|不工作/i.test(goal);
  const isFeature = /feature|feat|新增|添加|实现|功能|implement|add|create/i.test(goal);
  const isRefactor = /refactor|重构|优化|整理|simplify|clean/i.test(goal);
  const isTest = /test|测试|验证|检查|check|verify/i.test(goal);
  const isReview = /review|审查|评审|分析|analyze/i.test(goal);
  const needsSearch = !/仅|只|just|only/i.test(goal); // Almost always need search

  const tasks: Array<{ id: string; role: string; desc: string; dependsOn: string[] }> = [];
  let taskNum = 0;

  // Phase 1: Research (parallel if multiple angles)
  if (needsSearch) {
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: 'search',
      desc: `探索代码库，收集与以下目标相关的上下文和代码位置：${goal}`,
      dependsOn: [],
    });

    // For bug fixes, add a parallel analyst to understand the error pattern
    if (isBugFix) {
      taskNum++;
      tasks.push({
        id: `t${taskNum}`,
        role: 'analyst',
        desc: `分析错误模式和可能的根因：${goal}`,
        dependsOn: [],
      });
    }
  }

  // Phase 2: Execution (depends on research)
  const researchTaskIds = tasks.map(t => t.id);
  if (isBugFix) {
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: 'debugger',
      desc: `根据搜索和分析结果，定位并修复问题：${goal}`,
      dependsOn: researchTaskIds,
    });
  } else if (isRefactor) {
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: 'code-simplifier',
      desc: `根据搜索结果执行重构：${goal}`,
      dependsOn: researchTaskIds,
    });
  } else if (isReview) {
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: 'code-reviewer',
      desc: `根据搜索结果进行深度代码审查：${goal}`,
      dependsOn: researchTaskIds,
    });
  } else {
    // Feature or generic
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: 'executor',
      desc: `根据搜索结果执行代码修改：${goal}`,
      dependsOn: researchTaskIds,
    });
  }

  // Phase 3: Verification (depends on execution)
  const executionTaskIds = tasks.filter(t => t.role !== 'search' && t.role !== 'analyst').map(t => t.id);
  if (!isReview) {
    taskNum++;
    tasks.push({
      id: `t${taskNum}`,
      role: isTest ? 'test-engineer' : 'verifier',
      desc: `验证修改结果的正确性和完整性：${goal}`,
      dependsOn: executionTaskIds,
    });
  }

  return { tasks };
}

/**
 * generateTeamDAG - 动态 DAG 计划生成器
 * 功能：调用 planner 根据系统可用智能体列表和用户目标生成包含执行依赖树的 DAG JSON
 * 用法：在执行管线前调用，替换固定的串行编排数组
 */
async function generateTeamDAG(options: TeamRunnerOptions): Promise<TeamDAG> {
  if (isSimpleLocalLookupTask(options.goal) || isSimpleWebLookupTask(options.goal)) {
    if (options.emitSSE) {
      options.emitSSE({ type: 'text', data: `\n\n⚡ **启用轻量检索编排**\n检测到这是简单检索任务，跳过 DAG 规划子任务，直接派发搜索智能体。\n` });
    }
    return {
      tasks: [
        { id: 'lookup-1', role: 'explore', desc: options.goal, dependsOn: [] },
      ],
    };
  }

  // Single-agent bypass: analysis/review tasks don't need multi-agent DAG planning
  if (isSingleAgentTask(options.goal)) {
    if (options.emitSSE) {
      options.emitSSE({ type: 'text', data: `\n\n⚡ **轻量单智能体模式**\n检测到这是分析/审查任务，跳过多智能体编排，直接派发专用智能体。\n` });
    }
    return {
      tasks: [
        { id: 'analysis-1', role: 'analyst', desc: options.goal, dependsOn: [] },
      ],
    };
  }

  const subAgents = getSubAgents();
  const subAgentsList = subAgents.map(a => `- ${a.id}: ${a.description}`).join('\n');

  const plannerPrompt = `You are the Orchestrator. The user's goal is: ${options.goal}

Available agents:
${subAgentsList}

Create a task execution DAG (Directed Acyclic Graph) to accomplish this goal.
You must output a valid JSON block containing the execution plan. The JSON should match this schema:
{
  "tasks": [
    {
      "id": "task1",
      "role": "agent_id",
      "desc": "detailed description of the task",
      "dependsOn": ["task_id_1"]
    }
  ]
}

CRITICAL RULES:
1. TASK COUNT: Output AT MOST 5 tasks total (including verifier). Fewer is better — prefer 2-4 well-scoped tasks over many tiny ones. Do NOT split tasks that can be done by a single agent.
2. INDEPENDENT TASKS: Tasks with empty \`dependsOn\` \`[]\` run in parallel.
3. CONVERGENCE: Only sequentialize when one task STRICTLY requires the output of another.
4. Include ONE final verifier step that depends on all execution tasks.
5. Use ONLY exact role ids from the Available agents list.

Only output the JSON block, no other text.`;

  if (options.emitSSE) {
    options.emitSSE({ type: 'text', data: `\n\n🚀 **启动 OMC Team 管线**\n正在规划任务有向无环图 (DAG)...\n` });
  }

  const { report, errorEvent } = await executeAgentTask({
    id: 'planner-init',
    role: 'planner',
    desc: '规划任务 DAG',
    dependsOn: []
  }, options, plannerPrompt);

  if (errorEvent) {
    throw new Error(`Failed to generate DAG: ${errorEvent}`);
  }

  const jsonMatch = report.match(/```json\n([\s\S]*?)\n```/) || report.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return buildFallbackDAG(options.goal);
  }

  try {
    const dag = JSON.parse(jsonMatch[1] || jsonMatch[0]) as TeamDAG;
    if (!dag.tasks || !Array.isArray(dag.tasks)) throw new Error('Invalid DAG format');
    dag.tasks = dag.tasks.map((task) => ({
      ...task,
      role: normalizeAgentId(task.role),
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    }));

    // Validate DAG to prevent deadlocks (missing dependencies or circular deps)
    const taskIds = new Set(dag.tasks.map(t => t.id));
    for (const task of dag.tasks) {
      if (task.dependsOn) {
        for (const dep of task.dependsOn) {
          if (!taskIds.has(dep)) {
            throw new Error(`DAG Validation Error: Task ${task.id} depends on non-existent task ${dep}`);
          }
        }
      }
    }

    // Hard cap: if planner generated too many tasks, fall back to simpler DAG
    if (dag.tasks.length > MAX_DAG_TASKS) {
      console.warn(`[team-runner] Planner generated ${dag.tasks.length} tasks (max ${MAX_DAG_TASKS}), falling back to simplified DAG`);
      return buildFallbackDAG(options.goal);
    }

    return dag;
  } catch (e) {
    return buildFallbackDAG(options.goal);
  }
}

/**
 * runTeamPipeline - 多智能体团队调度引擎主入口
 *
 * OMC-style: 父 agent 直接编排，不再通过单独的 planner LLM 生成 DAG。
 * 父 agent 在自己的推理循环中决定是否/如何 spawn 子 agent。
 * 子 agent 通过 Agent tool 自然并行，SSE 事件流式传输到前端。
 *
 * 如果父 agent 无法正常编排（模型不支持工具调用等），降级到 DAG 模式。
 */
export async function runTeamPipeline(options: TeamRunnerOptions): Promise<string> {
  const { goal, workingDirectory, abortSignal } = options;
  const runtime = options.teamRuntime || createTeamRuntime({
    goal,
    cwd: workingDirectory,
    sessionId: options.parentSessionId,
  });
  const emitSSE = (event: { type: string; data: string }) => {
    try {
      let parsedData: unknown = event.data;
      try { parsedData = JSON.parse(event.data); } catch { /* plain text */ }
      appendTeamEvent(runtime, { type: event.type, data: parsedData });
    } catch { /* best effort */ }
    options.emitSSE?.(event);
  };
  const runtimeOptions: TeamRunnerOptions = { ...options, emitSSE, teamRuntime: runtime };

  // Phase 0: 触发前端 UI 渲染
  emitTeamEvent('team_start', {
    goal,
    agents: [],
    startedAt: Date.now(),
    jobId: runtime.jobId,
  });

  emitSSE({ type: 'text', data: `🚀 **启动智能体团队协作**\nTeam Job: \`${runtime.jobId}\`\n正在分析任务并编排智能体...\n\n` });
  updateTeamStage(runtime, 'team-plan');

  // Phase 1: 父 agent 直接编排（OMC 策略）
  const orchestrationPrompt = buildTeamOrchestrationPrompt(goal, workingDirectory);
  const sessionId = `team-lead-${Date.now()}`;

  const { providerId: finalProviderId, model: finalModel } = resolveAgentModel(
    { id: 'orchestrator', displayName: 'Team Leader', description: 'Team orchestrator', mode: 'subagent' },
    runtimeOptions.providerId,
    runtimeOptions.parentModel
  );

  const { tools: allTools } = assembleTools({
    workingDirectory,
    prompt: goal,
    providerId: finalProviderId,
    sessionProviderId: runtimeOptions.sessionProviderId,
    model: finalModel,
    permissionContext: (runtimeOptions.parentSessionId && runtimeOptions.permissionMode)
      ? {
          sessionId: runtimeOptions.parentSessionId,
          permissionMode: (runtimeOptions.permissionMode || 'trust') as import('./permission-checker').PermissionMode,
          emitSSE,
          abortSignal,
        }
      : undefined,
    // Parent agent needs Agent/Team tools to orchestrate sub-agents.
    // Only sub-agents use executionMode: 'spawn' to prevent nesting.
  });
  delete allTools.Team;

  // DEBUG: log parent agent's available tools
  const toolNames = Object.keys(allTools);
  console.log(`[team-runner] Parent agent tools (${toolNames.length}): ${toolNames.join(', ')}`);
  console.log(`[team-runner] Agent tool present: ${!!allTools['Agent']}, Team tool present: ${!!allTools['Team']}`);

  const stream = runAgentLoop({
    prompt: goal,
    sessionId,
    providerId: finalProviderId,
    sessionProviderId: runtimeOptions.sessionProviderId,
    model: finalModel,
    systemPrompt: orchestrationPrompt,
    workingDirectory,
    tools: allTools,
    maxSteps: 30,
    permissionMode: runtimeOptions.permissionMode,
  });

  // Phase 2: 消费父 agent 流，转发所有 SSE 事件到前端
  const reader = stream.getReader();
  const collectedText: string[] = [];
  let hasSpawnedSubAgents = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const lines = value.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        // 转发 SSE 事件到前端，保留原始事件类型
        // subagent_start/subagent_complete 等事件驱动前端卡片渲染
        if (emitSSE) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text' && event.data) {
              collectedText.push(event.data);
            } else if (event.type === 'subagent_start') {
              hasSpawnedSubAgents = true;
            }
            emitSSE(event);
          } catch { /* skip non-JSON */ }
        }
      }
    }
  } catch (streamErr: unknown) {
    const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
    console.warn('[team-runner] Parent agent stream error:', errMsg);
    appendTeamEvent(runtime, { type: 'team_leader_error', data: { error: errMsg } });
  } finally {
    reader.releaseLock();
  }

  // Phase 3: 如果父 agent 没有 spawn 子 agent（模型不支持 tool calling 或未调用 Agent tool），
  // 降级到 DAG 模式确保子 agent 卡片正常渲染。
  if (!hasSpawnedSubAgents) {
    console.warn('[team-runner] Parent agent did not spawn sub-agents, falling back to DAG execution');
    emitSSE({ type: 'text', data: `\n\n⚡ **切换到 DAG 调度模式**\n启用多智能体并行编排...\n\n` });
    const result = await runDAGFallback(runtimeOptions);
    emitTeamEvent('team_done', { summary: 'Team pipeline completed (DAG fallback)', completedAt: Date.now() });
    const failed = result.includes('**❌') || result.includes('**Error**') || abortSignal?.aborted;
    completeTeamRuntime(runtime, result, failed ? 'Team pipeline completed with failed or aborted tasks' : undefined);
    return result;
  }

  emitTeamEvent('team_done', {
    summary: 'Team orchestration completed',
    completedAt: Date.now(),
  });

  writeTeamHandoff(runtime, 'team-verify', `## Handoff: team-verify -> complete
- Decided: Parent orchestrator spawned sub-agents directly.
- Files: See sub-agent reports in the chat timeline.
- Remaining: Review individual sub-agent reports for residual risks.`);
  completeTeamRuntime(runtime, collectedText.join('').trim() || 'Team orchestration completed');
  emitSSE({ type: 'text', data: `\n\n🎉 **团队协作完成**\n请查阅上方各智能体的执行报告。` });

  return collectedText.join('');
}

/**
 * runDAGFallback - DAG 降级执行路径
 * 当父 agent 无法正常编排时，使用 buildFallbackDAG 生成任务图并执行。
 */
async function runDAGFallback(options: TeamRunnerOptions): Promise<string> {
  const { goal, emitSSE, abortSignal } = options;
  let accumulatedContext = `Team Goal: ${goal}\n\n`;

  const dag = buildFallbackDAG(goal);
  if (options.teamRuntime) {
    setTeamTasks(options.teamRuntime, dag.tasks.map((task) => ({
      id: task.id,
      role: normalizeAgentId(task.role),
      desc: task.desc,
      dependsOn: task.dependsOn || [],
      status: 'pending',
    })));
    writeTeamHandoff(options.teamRuntime, 'team-plan', `## Handoff: team-plan -> team-exec
- Decided: Use deterministic DAG fallback because the leader did not spawn sub-agents directly.
- Tasks: ${dag.tasks.map((task) => `${task.id}:${normalizeAgentId(task.role)}`).join(', ')}
- Risks: File ownership is task-scoped by prompt; overlapping edits still require verifier review.
- Remaining: Execute ready tasks, then run verifier.`);
    updateTeamStage(options.teamRuntime, 'team-exec');
  }

  emitTeamEvent('team_dag_ready', { agents: dag.tasks });

  if (emitSSE) {
    emitSSE({ type: 'text', data: `✅ **DAG 降级规划完成**\n包含 ${dag.tasks.length} 个任务节点\n\n` });
  }

  const pendingTasks = [...dag.tasks];
  const runningTasks = new Map<string, Promise<{ id: string }>>();
  const completedTasks = new Set<string>();
  const taskReports = new Map<string, string>();

  while ((pendingTasks.length > 0 || runningTasks.size > 0) && !abortSignal?.aborted) {
    const readyTasks = pendingTasks.filter(t =>
      !t.dependsOn || t.dependsOn.length === 0 || t.dependsOn.every(dep => completedTasks.has(dep))
    );

    if (readyTasks.length === 0 && runningTasks.size === 0 && pendingTasks.length > 0) {
      console.error('[team-runner] Deadlock detected in DAG fallback:', pendingTasks);
      break;
    }

    for (const task of readyTasks) {
      const idx = pendingTasks.indexOf(task);
      if (idx > -1) pendingTasks.splice(idx, 1);

      let taskContext = accumulatedContext;
      if (task.dependsOn && task.dependsOn.length > 0) {
        taskContext += `\n\n--- Context from Dependencies ---\n`;
        for (const depId of task.dependsOn) {
          if (taskReports.has(depId)) {
            taskContext += `[From Task ${depId}]:\n${taskReports.get(depId)}\n\n`;
          }
        }
      }
      if (options.teamRuntime) {
        const stage = stageForRole(task.role);
        updateTeamStage(options.teamRuntime, stage);
        appendTeamEvent(options.teamRuntime, {
          type: 'team_task_scheduled',
          data: {
            taskId: task.id,
            role: normalizeAgentId(task.role),
            stage,
            estimatedInputTokens: estimateTaskPromptTokens(task, taskContext),
          },
        });
      }

      const taskPromise = executeAgentTask(task, options, taskContext).then(({ report, errorEvent, role }) => {
        const fullReport = errorEvent ? `**Error**: ${errorEvent}` : report;
        taskReports.set(task.id, fullReport);
        completedTasks.add(task.id);
        accumulatedContext += `\n\n--- Report from ${role} (${task.id}) ---\n${fullReport}\n`;
        if (options.teamRuntime) {
          writeTeamHandoff(options.teamRuntime, role === 'verifier' ? 'team-verify' : 'team-exec', `## Handoff: ${role} ${task.id}
- Decided: ${role} completed assigned task ${task.id}.
- Task: ${task.desc}
- Report: ${truncateToTokenBudget(fullReport, 1200)}
- Remaining: Continue dependency graph and verification.`);
        }
        return { id: task.id };
      }).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        const role = normalizeAgentId(task.role);
        taskReports.set(task.id, `**❌ 执行异常**: ${errMsg}`);
        completedTasks.add(task.id);
        accumulatedContext += `\n\n--- Report from ${role} (${task.id}) ---\n**❌ 执行异常**: ${errMsg}\n`;
        if (options.teamRuntime) {
          updateTeamTask(options.teamRuntime, task.id, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: errMsg,
          });
          writeTeamHandoff(options.teamRuntime, 'team-fix', `## Handoff: team-exec -> team-fix
- Failed: ${role} task ${task.id}
- Error: ${errMsg}
- Remaining: Re-run with debugger or simplify the task.`);
        }
        return { id: task.id };
      });

      runningTasks.set(task.id, taskPromise);
    }

    if (runningTasks.size > 0) {
      const settled = await Promise.race(runningTasks.values());
      runningTasks.delete(settled.id);
      continue;
    }
  }

  if (options.teamRuntime) {
    updateTeamStage(options.teamRuntime, abortSignal?.aborted ? 'cancelled' : 'team-verify');
    writeTeamHandoff(options.teamRuntime, 'team-verify', `## Handoff: team-verify -> complete
- Decided: DAG execution reached terminal queue state.
- Completed: ${Array.from(completedTasks).join(', ')}
- Failed: ${Array.from(taskReports.entries()).filter(([, report]) => report.includes('**❌') || report.includes('**Error**')).map(([id]) => id).join(', ') || 'none'}
- Remaining: Read accumulated reports for pass/fail evidence.`);
  }
  return accumulatedContext;
}
