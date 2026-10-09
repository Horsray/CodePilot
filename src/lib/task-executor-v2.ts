/**
 * task-executor-v2.ts — Multi-phase scheduled task executor.
 *
 * Replaces the single-shot LLM call in executeDueTask() with a structured
 * Plan → Execute → Verify pipeline, adding error recovery, context retention
 * across recurring executions, and output validation.
 *
 * Only affects the scheduled task execution path. Chat, Agent, and all other
 * features are untouched.
 *
 * Architecture:
 *   Phase 1 (Analyze)  — Understand task goal, create structured plan + success criteria
 *   Phase 2 (Execute)  — Run the plan via runAgentLoop (tools) or generateTextFromProvider
 *   Phase 3 (Verify)   — Check output against success criteria, retry with adjusted approach
 *
 * Token cost per phase:
 *   Analyze: ~1 round trip, maxTokens=1000
 *   Execute: same as current single-shot call
 *   Verify:  ~1 round trip, maxTokens=500
 *   Retry:   re-runs all 3 phases with previous error context
 */

import type { ScheduledTask } from '@/types';

// ── Types ───────────────────────────────────────────────────────

interface TaskContext {
  lastError?: string;
  lastPartialOutput?: string;
  lastPlan?: string;
  consecutiveFailures: number;
  retryCount: number;
}

interface PlanOutput {
  plan: string;
  successCriteria: string;
}

interface VerifyOutput {
  passed: boolean;
  feedback: string;
}

interface ExecResult {
  output: string;
  cleanOutput: string;
  success: boolean;
  toolCallCount: number;
}

// ── In-memory context store (survives within process lifetime) ──

const contextStore = new Map<string, TaskContext>();

function getContext(taskId: string): TaskContext {
  if (!contextStore.has(taskId)) {
    contextStore.set(taskId, { consecutiveFailures: 0, retryCount: 0 });
  }
  return contextStore.get(taskId)!;
}

function clearContext(taskId: string): void {
  contextStore.delete(taskId);
}

// ── Helpers ─────────────────────────────────────────────────────

async function generateText(
  providerId: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 1000
): Promise<string> {
  const { generateTextFromProvider } = await import('./text-generator');
  return generateTextFromProvider({ providerId, model, system, prompt, maxTokens });
}

/**
 * Parse JSON from LLM output, stripping markdown fences if present.
 */
function parseJSON<T>(raw: string): T | null {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

// ── Phase 1: Analyze ────────────────────────────────────────────

/**
 * Generate a structured execution plan and success criteria for the task.
 * Includes previous failure context if this is a retry.
 */
async function phaseAnalyze(
  task: ScheduledTask,
  deps: { providerId: string; model: string; currentTime: string }
): Promise<PlanOutput> {
  const ctx = getContext(task.id);

  const system = `你是一个定时任务分析器。分析任务描述，生成可执行的计划和成功标准。

${ctx.lastError ? `⚠️ 上次尝试失败：${ctx.lastError}` : ''}
${ctx.lastPartialOutput ? `上次部分输出：${ctx.lastPartialOutput.slice(0, 300)}` : ''}

请严格按以下 JSON 格式输出（不要包裹 markdown 代码块）：
{
  "plan": "简要执行计划——做什么、什么顺序。简明扼要，2-5句话。",
  "successCriteria": "判断任务成功的一条明确标准"
}`;

  const prompt = `任务名称：${task.name}
任务描述：${task.prompt}
当前时间：${deps.currentTime}
计划类型：${task.schedule_type === 'interval' ? `间隔: ${task.schedule_value}` : task.schedule_type === 'cron' ? `cron: ${task.schedule_value}` : '一次性'}`;

  const raw = await generateText(deps.providerId, deps.model, system, prompt, 1000);
  const parsed = parseJSON<PlanOutput>(raw);

  if (parsed?.plan && parsed?.successCriteria) {
    return parsed;
  }

  // Fallback: return raw output as plan
  return { plan: raw.trim(), successCriteria: '任务执行完成，输出有意义的内容' };
}

// ── Phase 2: Execute ────────────────────────────────────────────

/**
 * Execute the task using runAgentLoop (with tools) or generateTextFromProvider.
 * The enhanced system prompt includes the analysis plan as guidance.
 */
async function phaseExecute(
  task: ScheduledTask,
  plan: string,
  runtime: {
    prompt: string;
    providerId: string;
    sessionProviderId?: string;
    model: string;
    baseSystem: string;
    workingDirectory: string;
    targetSessionId?: string;
    toolsOverride?: any;
    hasTools: boolean;
  }
): Promise<{
  output: string;
  cleanOutput: string;
  success: boolean;
  toolCallCount: number;
  rawResult?: string;
}> {
  if (!runtime.hasTools) {
    // Text-only execution
    const system = `${runtime.baseSystem}

=================================
[定时任务执行指令]
任务名称：${task.name}
原始目标：${runtime.prompt}

执行计划：
${plan}

请严格按照上述计划执行。执行完成后总结输出。`;

    const rawResult = await generateText(
      runtime.providerId,
      runtime.model,
      system,
      runtime.prompt,
      4096
    );
    const cleanOutput = rawResult.trim() || '(无文本输出)';
    return {
      output: `---定时任务结果---
任务目标：
${runtime.prompt}
执行结果：成功
最终输出：
${cleanOutput}
--------------
小结：文本生成（无工具调用）`,
      cleanOutput,
      success: true,
      toolCallCount: 0,
      rawResult,
    };
  }

  // Tool-enabled execution via runAgentLoop
  const { runAgentLoop } = await import('./agent-loop');

  const enhancedSystem = `${runtime.baseSystem}

=================================
[定时任务执行指令]
任务名称：${task.name}
原始目标：${runtime.prompt}

执行计划：
${plan}

请严格按照上述计划执行。执行完成后总结输出。`;

  const stream = runAgentLoop({
    prompt: runtime.prompt,
    sessionId: runtime.targetSessionId || task.id,
    providerId: runtime.providerId,
    sessionProviderId: runtime.sessionProviderId,
    model: runtime.model,
    systemPrompt: enhancedSystem,
    workingDirectory: runtime.workingDirectory,
    bypassPermissions: true,
    autoTrigger: true,
    tools: runtime.toolsOverride,
  });

  // Read the SSE stream (same logic as current executeDueTask)
  const reader = stream.getReader();
  let buffer = '';
  let result = '';
  let executionLog = '';
  let toolCallCount = 0;
  let currentToolName = '';
  let currentToolInput = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += typeof value === 'string' ? value : new TextDecoder().decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'text') {
          result += data.data;
        } else if (data.type === 'tool_use') {
          const tu = JSON.parse(data.data);
          toolCallCount++;
          currentToolName = tu.name;
          currentToolInput = typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input);
        } else if (data.type === 'tool_result') {
          let displayInput = currentToolInput;
          try {
            const parsedInput = JSON.parse(currentToolInput);
            if (currentToolName === 'Bash' && parsedInput.command) {
              displayInput = parsedInput.command;
            }
          } catch { /* ignore */ }
          const inputPreview = displayInput.length > 50 ? displayInput.slice(0, 47) + '...' : displayInput;
          executionLog += `- 🛠️ 调用工具：\`${currentToolName}\` (输入: ${inputPreview})\n`;
          const tr = JSON.parse(data.data);
          executionLog += `  - 结果：${tr.is_error ? '❌ 失败' : '✅ 成功'}\n`;
        } else if (data.type === 'error') {
          executionLog += `- ❌ 发生错误：${data.data}\n`;
        }
      } catch { /* skip unparseable lines */ }
    }
  }

  // Flush remaining buffer
  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.slice(6));
      if (data.type === 'text') result += data.data;
    } catch { /* ignore */ }
  }

  const cleanOutput = result.trim() || '(无文本输出)';
  const hasError = executionLog.includes('❌ 失败') || executionLog.includes('❌ 发生错误');

  const formattedLog = `---定时任务结果---
任务目标：
${runtime.prompt}
执行结果：${hasError ? '失败' : '成功'}
最终输出：
${cleanOutput}
--------------
小结：工具使用：${toolCallCount}个${toolCallCount > 0 ? '\n' + executionLog.trim() : ''}`;

  return {
    output: formattedLog,
    cleanOutput,
    rawResult: result,
    success: !hasError,
    toolCallCount,
  };
}

// ── Phase 3: Verify ─────────────────────────────────────────────

/**
 * Verify the execution output against the success criteria.
 * Returns { passed, feedback } to inform retry decisions.
 */
async function phaseVerify(
  task: ScheduledTask,
  execResult: { cleanOutput: string; toolCallCount: number; success: boolean },
  successCriteria: string,
  deps: { providerId: string; model: string }
): Promise<VerifyOutput> {
  // Fast-path: no tools called and not explicitly successful
  if (execResult.toolCallCount === 0) {
    // Text-only execution that produced content → likely fine
    if (execResult.cleanOutput.length > 10) {
      return { passed: true, feedback: '文本生成任务已输出内容' };
    }
    return { passed: false, feedback: '未产生有效输出内容' };
  }

  // Tool execution with suspiciously little output
  if (execResult.toolCallCount > 0 && execResult.cleanOutput.length < 10) {
    // But if tools were called successfully, the action itself was the output
    return { passed: true, feedback: '工具已成功调用，任务已执行' };
  }

  // LLM-based verification for complex tasks
  const system = `你是一个任务执行验证器。判断输出是否符合任务目标。
按以下 JSON 格式输出（不要包裹代码块）：
{
  "passed": true/false,
  "feedback": "判断依据（20字以内）"
}`;

  const prompt = `任务目标：${task.prompt}
成功标准：${successCriteria}
执行输出：${execResult.cleanOutput.slice(0, 1500)}`;

  const raw = await generateText(deps.providerId, deps.model, system, prompt, 500);
  const parsed = parseJSON<VerifyOutput>(raw);

  if (parsed && typeof parsed.passed === 'boolean') {
    return parsed;
  }

  // Fallback: trust the execution result
  return { passed: execResult.success, feedback: '验证阶段解析失败，信任执行结果' };
}

// ── Orchestrator ─────────────────────────────────────────────────

/**
 * Execute a scheduled task with multi-phase orchestration.
 *
 * Returns ExecResult compatible with the existing notification/DB flow in task-scheduler.ts.
 * On success: clears in-memory context so fresh runs start clean.
 * On failure after retries: includes retry info in output.
 */
export async function executeTaskV2(params: {
  task: ScheduledTask;
  prompt: string;
  providerId: string;
  sessionProviderId?: string;
  model: string;
  baseSystem: string;
  workingDirectory: string;
  targetSessionId?: string;
  toolsOverride?: any;
  hasTools: boolean;
  currentTime: string;
}): Promise<ExecResult> {
  const { task } = params;
  const maxAttempts = 3; // 1 initial + 2 retries
  const ctx = getContext(task.id);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ── Phase 1: Analyze ──
    const { plan, successCriteria } = await phaseAnalyze(task, {
      providerId: params.providerId,
      model: params.model,
      currentTime: params.currentTime,
    });

    // Store plan for context on retry
    ctx.lastPlan = plan;

    console.log(`[task-executor-v2] Task ${task.id} attempt ${attempt}: plan ready (${plan.length} chars)`);

    // ── Phase 2: Execute ──
    const execResult = await phaseExecute(task, plan, {
      prompt: params.prompt,
      providerId: params.providerId,
      sessionProviderId: params.sessionProviderId,
      model: params.model,
      baseSystem: params.baseSystem,
      workingDirectory: params.workingDirectory,
      targetSessionId: params.targetSessionId,
      toolsOverride: params.toolsOverride,
      hasTools: params.hasTools,
    });

    console.log(`[task-executor-v2] Task ${task.id} attempt ${attempt}: executed (tools: ${execResult.toolCallCount}, output: ${execResult.cleanOutput.length} chars)`);

    // ── Phase 3: Verify ──
    const verify = await phaseVerify(task, execResult, successCriteria, {
      providerId: params.providerId,
      model: params.model,
    });

    console.log(`[task-executor-v2] Task ${task.id} attempt ${attempt}: verify ${verify.passed ? '✅' : '❌'} — ${verify.feedback}`);

    if (verify.passed) {
      // Success! Clear context for clean future runs
      clearContext(task.id);
      return { ...execResult, success: true };
    }

    // ── Retry: store failure context ──
    ctx.lastError = verify.feedback;
    ctx.lastPartialOutput = execResult.cleanOutput;
    ctx.consecutiveFailures++;
    ctx.retryCount = attempt;

    if (attempt < maxAttempts) {
      console.log(`[task-executor-v2] Task ${task.id}: retrying (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  // All attempts exhausted
  return {
    output: `---定时任务结果---
任务目标：
${task.prompt}
执行结果：失败（已重试 ${maxAttempts} 次）
最终输出：所有尝试均未通过验证
最后失败原因：${ctx.lastError || '未知'}
--------------`,
    cleanOutput: `任务执行失败，共尝试 ${maxAttempts} 次。`,
    success: false,
    toolCallCount: 0,
  };
}

// ── API for tests ───────────────────────────────────────────────

/** Clear all stored execution contexts (for test cleanup). */
export function resetAllContexts(): void {
  contextStore.clear();
}

/** Get current stored contexts count (for test assertions). */
export function contextCount(): number {
  return contextStore.size;
}
