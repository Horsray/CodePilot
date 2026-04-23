import { getAgent, getSubAgents } from './agent-registry';
import { runAgentLoop } from './agent-loop';
import { assembleTools } from './agent-tools';
import type { ToolSet } from 'ai';
import { resolveAgentModel } from './agent-routing';
import { truncateToTokenBudget } from './context-pruner';
import { buildSubAgentExecutionProfile, isLocalCodeSearchTask } from './subagent-profile';
import { createSubAgentProgressTracker } from './subagent-progress';

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

interface DAGTask {
  id: string;
  role: string;
  desc: string;
  dependsOn: string[];
}

interface TeamDAG {
  tasks: DAGTask[];
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
  const agentDef = getAgent(task.role);
  if (!agentDef) {
    return { report: `Error: Agent ${task.role} not found.`, errorEvent: 'Agent not found', role: task.role };
  }
  const profile = buildSubAgentExecutionProfile(agentDef, task.desc);

  const { providerId: finalProviderId, model: finalModel } = resolveAgentModel(
    agentDef,
    options.providerId,
    options.parentModel
  );

  emitTeamEvent('team_agent_start', {
    id: task.id,
    name: task.role,
    displayName: agentDef.displayName || task.role,
    prompt: task.desc,
    model: finalModel,
    startedAt: Date.now(),
  });

  const subAgentId = `team-${task.role}-${Date.now()}`;
  
  // 防止 Team 模式下的上下文溢出 (Truncate to reasonable token limit)
  const safeContext = truncateToTokenBudget(accumulatedContext, 15000);
  
  const prompt = `Your role is ${task.role}. Your task is: ${task.desc}.\n\nOverall Team Goal: ${options.goal}\n\nContext from previous steps:\n${safeContext}\n\nPlease perform your specialized task. You MUST output a clear, detailed summary of your findings or actions when you finish.`;

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
  });

  const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);
  const systemPrompt = agentDef.prompt
    ? `${agentDef.prompt}\n\nWorking directory: ${workingDirectory}\n\nCRITICAL RULE: You are a sub-agent in a team. You MUST provide a clear, detailed final report of your findings or actions before you finish. Do not just output your internal thoughts.`
    : `You are a helpful sub-agent in a team. Working directory: ${workingDirectory}\n\nCRITICAL RULE: You are a sub-agent in a team. You MUST provide a clear, detailed final report of your findings or actions before you finish. Do not just output your internal thoughts.`;

  if (emitSSE) {
    emitSSE({
      type: 'subagent_start',
      data: JSON.stringify({
        id: subAgentId,
        name: task.role,
        displayName: agentDef.displayName || task.role,
        prompt: task.desc,
        model: finalModel,
      }),
    });
    emitSSE({ type: 'tool_output', data: `[subagent:${task.role}] ${task.desc}\n` });
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

  const progress = createSubAgentProgressTracker({
    id: subAgentId,
    emitSSE,
    initialStage: profile.initialStatus,
    sla: profile.sla,
  });

  const reader = stream.getReader();
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolResults: Array<{ content: string; isError: boolean }> = [];
  let errorEvent: string | null = null;
  let taskFailed = false;


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
            if (event.type !== 'keep_alive') {
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
                    name: task.role,
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
    console.warn(`[team-runner] executeAgentTask stream error for ${task.role}:`, errMsg);
  } finally {
    progress.close();
    reader.releaseLock();
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
    name: task.role,
    displayName: agentDef.displayName || task.role,
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

  return { report, errorEvent, role: task.role };
}

/**
 * generateTeamDAG - 动态 DAG 计划生成器
 * 功能：调用 planner 根据系统可用智能体列表和用户目标生成包含执行依赖树的 DAG JSON
 * 用法：在执行管线前调用，替换固定的串行编排数组
 */
async function generateTeamDAG(options: TeamRunnerOptions): Promise<TeamDAG> {
  if (isLocalCodeSearchTask(options.goal)) {
    if (options.emitSSE) {
      options.emitSSE({ type: 'text', data: `\n\n⚡ **启用轻量检索编排**\n检测到这是本地代码检索任务，跳过 DAG 规划子任务，直接派发搜索智能体。\n` });
    }
    return {
      tasks: [
        { id: 'lookup-1', role: 'explore', desc: options.goal, dependsOn: [] },
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

CRITICAL RULES FOR MULTI-AGENT PARALLELISM:
1. MAXIMIZE PARALLELISM: If a complex task can be split into 2-5 independent sub-tasks (e.g., analyzing different modules, modifying separate files, researching different topics), you MUST split them into separate tasks with NO overlapping dependencies.
2. INDEPENDENT TASKS: Tasks that have an empty \`dependsOn\` array \`[]\` will run in background concurrently.
3. CONVERGENCE: Only sequentialize tasks (using \`dependsOn\`) when one task STRICTLY requires the output of another.
4. MAKE SURE to include a final verifier or qa-tester step at the end that depends on all the parallel execution tasks.

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
    // Fallback to default pipeline if planner fails to output JSON
    return {
      tasks: [
        { id: 't1', role: 'search', desc: '探索代码库并收集相关上下文', dependsOn: [] },
        { id: 't2', role: 'executor', desc: '执行代码修改', dependsOn: ['t1'] },
        { id: 't3', role: 'verifier', desc: '验证修改结果并进行复核', dependsOn: ['t2'] }
      ]
    };
  }

  try {
    const dag = JSON.parse(jsonMatch[1] || jsonMatch[0]) as TeamDAG;
    if (!dag.tasks || !Array.isArray(dag.tasks)) throw new Error('Invalid DAG format');
    
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
    
    // A simple cycle detection could be added here, but for now we rely on 
    // the deadlock detector in the while loop below to catch circular dependencies at runtime.
    
    return dag;
  } catch (e) {
    return {
      tasks: [
        { id: 't1', role: 'search', desc: '探索代码库并收集相关上下文', dependsOn: [] },
        { id: 't2', role: 'executor', desc: '执行代码修改', dependsOn: ['t1'] },
        { id: 't3', role: 'verifier', desc: '验证修改结果并进行复核', dependsOn: ['t2'] }
      ]
    };
  }
}

/**
 * runTeamPipeline - 多智能体团队调度引擎主入口
 * 功能：接收用户的团队目标，触发 DAG 计划生成，随后以并发方式和反馈闭环（失败重试）调度各个子智能体
 * 用法：OMC Team 模式下，供 /team 指令调用执行完整的任务链路
 */
export async function runTeamPipeline(options: TeamRunnerOptions): Promise<string> {
  const { goal, emitSSE, abortSignal } = options;
  let accumulatedContext = `Team Goal: ${goal}\n\n`;

  // Phase 0: 立即触发前端 UI 渲染，避免用户觉得卡顿
  emitTeamEvent('team_start', {
    goal,
    agents: [], // 先传空列表，稍后 DAG 生成后补充
    startedAt: Date.now(),
  });

  // Phase 1: Generate DAG
  const dag = await generateTeamDAG(options);
  
  emitTeamEvent('team_dag_ready', {
    agents: dag.tasks,
  });

  if (emitSSE) {
    emitSSE({ type: 'text', data: `✅ **任务 DAG 规划完成**\n包含 ${dag.tasks.length} 个任务节点，即将开始并发执行...\n\n` });
  }

  // Phase 2 & 4: Execute DAG with Parallel Execution and Verification Loop
  const pendingTasks = [...dag.tasks];
  const runningTasks = new Map<string, Promise<void>>();
  const completedTasks = new Set<string>();
  const taskReports = new Map<string, string>();
  let retries = 0;
  const MAX_RETRIES = 3;

  while ((pendingTasks.length > 0 || runningTasks.size > 0) && !abortSignal?.aborted) {
    // Find ready tasks
    const readyTasks = pendingTasks.filter(t => 
      !t.dependsOn || t.dependsOn.length === 0 || t.dependsOn.every(dep => completedTasks.has(dep))
    );

    // Deadlock detection: if there are pending tasks but none are ready AND no tasks are running,
    // we have a circular dependency or unresolvable dependency in the DAG.
    if (readyTasks.length === 0 && runningTasks.size === 0 && pendingTasks.length > 0) {
      console.error('[team-runner] Deadlock detected in DAG:', pendingTasks);
      const errMsg = `⚠️ **调度死锁错误**\n任务图中存在循环依赖或无法解析的前置条件。强制中止管线以防止系统卡死。\n剩余未执行任务: ${pendingTasks.map(t => t.id).join(', ')}`;
      if (emitSSE) emitSSE({ type: 'error', data: JSON.stringify({ category: 'DAG_DEADLOCK', userMessage: errMsg }) });
      throw new Error('DAG Execution Deadlock: Circular dependencies detected.');
    }

    // Start ready tasks
    for (const task of readyTasks) {
      // Remove from pending
      const idx = pendingTasks.indexOf(task);
      if (idx > -1) pendingTasks.splice(idx, 1);

      // Build context from dependencies
      let taskContext = accumulatedContext;
      if (task.dependsOn && task.dependsOn.length > 0) {
        taskContext += `\n\n--- Context from Dependencies ---\n`;
        for (const depId of task.dependsOn) {
          if (taskReports.has(depId)) {
            taskContext += `[From Task ${depId}]:\n${taskReports.get(depId)}\n\n`;
          }
        }
      }

      // Execute task
      const taskPromise = executeAgentTask(task, options, taskContext).then(({ report, errorEvent, role }) => {
        const fullReport = errorEvent ? `**Error**: ${errorEvent}` : report;
        taskReports.set(task.id, fullReport);
        completedTasks.add(task.id);
        accumulatedContext += `\n\n--- Report from ${role} (${task.id}) ---\n${fullReport}\n`;

        // Phase 4: Verification Loop
        if ((role === 'verifier' || role === 'qa-tester') && !errorEvent) {
          const isFailed = fullReport.toLowerCase().includes('status: fail') || fullReport.toLowerCase().includes('fail') || fullReport.toLowerCase().includes('❌');
          if (isFailed && retries < MAX_RETRIES) {
            retries++;
            if (emitSSE) {
              emitSSE({ type: 'text', data: `\n\n⚠️ **验证失败**\n触发自动重试闭环 (Retry ${retries}/${MAX_RETRIES})...\n` });
            }

            const debugId = `debug-${retries}`;
            const execId = `exec-${retries}`;
            const verifyId = `verify-${retries}`;

            pendingTasks.push({
              id: debugId,
              role: 'debugger',
              desc: `分析验证失败的原因。前一次验证报告：\n${fullReport}`,
              dependsOn: [task.id]
            });
            pendingTasks.push({
              id: execId,
              role: 'executor',
              desc: `根据 Debugger 的分析结果修复代码。`,
              dependsOn: [debugId]
            });
            pendingTasks.push({
              id: verifyId,
              role: role,
              desc: `重新运行验证步骤。`,
              dependsOn: [execId]
            });
          }
        }
      }).catch((err: unknown) => {
        // Handle unexpected errors from executeAgentTask
        const errMsg = err instanceof Error ? err.message : String(err);
        taskReports.set(task.id, `**❌ 执行异常**: ${errMsg}`);
        completedTasks.add(task.id);
        accumulatedContext += `\n\n--- Report from ${task.role} (${task.id}) ---\n**❌ 执行异常**: ${errMsg}\n`;
        console.error(`[team-runner] Task ${task.id} threw error:`, err);
      });

      runningTasks.set(task.id, taskPromise);
    }

    // Wait for all running tasks to settle (resolved or rejected)
    if (runningTasks.size > 0) {
      const settled = await Promise.allSettled(Array.from(runningTasks.values()));

      // Process each settled result and clean up
      for (const [id, _promise] of runningTasks.entries()) {
        runningTasks.delete(id);

        // If task was rejected (not in completedTasks), mark as failed
        if (!completedTasks.has(id)) {
          // Find the task that failed
          const failedTask = dag.tasks.find(t => t.id === id);
          if (failedTask) {
            const errorMsg = `Task ${id} (${failedTask.role}) failed with unhandled error.`;
            taskReports.set(id, `**❌ 任务执行失败**: ${errorMsg}`);
            accumulatedContext += `\n\n--- Report from ${failedTask.role} (${id}) ---\n**❌ 任务执行失败**: ${errorMsg}\n`;
            console.error(`[team-runner] Unhandled rejection for task ${id}:`, settled);
          }
          // Add to completedTasks to prevent deadlock
          completedTasks.add(id);
        }
      }

      // Re-check for newly ready tasks after all settled
      continue;
    }
  }

  emitTeamEvent('team_done', {
    summary: 'OMC Team 管线全部执行完毕',
    completedAt: Date.now(),
  });

  if (emitSSE) {
    emitSSE({ type: 'text', data: `\n\n🎉 **OMC Team 管线全部执行完毕**\n请查阅上方各智能体的执行报告。` });
  }

  return accumulatedContext;
}
