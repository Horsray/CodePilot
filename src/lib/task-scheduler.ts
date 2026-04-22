/**
 * Task Scheduler — polls SQLite for due scheduled tasks and executes them.
 *
 * Architecture:
 * - Runs in Next.js server process via setInterval (10s poll)
 * - Uses globalThis to survive HMR in development
 * - Lightweight execution via generateTextFromProvider (no streaming UI)
 * - Exponential backoff on failure (30s → 1m → 5m → 15m)
 * - Auto-disables after 10 consecutive failures
 */

import type { ScheduledTask, NotificationChannel } from '@/types';
import crypto from 'crypto';

const POLL_INTERVAL = 10_000; // 10s
const GLOBAL_KEY = '__codepilot_scheduler__';
const BACKOFF_DELAYS = [30000, 60000, 300000, 900000]; // 30s, 1m, 5m, 15m
const MAX_CONSECUTIVE_ERRORS = 10;
const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── 本地时间格式化工具函数 ──────────────────────────────────────
/**
 * 将 Date 对象格式化为本地时间字符串 YYYY-MM-DD HH:mm:ss
 * 不使用 UTC，时区使用系统本地时间
 */
function formatLocalDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// ── Session-only tasks (in-memory, not persisted) ────────────────
const SESSION_TASKS_KEY = '__codepilot_session_tasks__';
const LAST_COMPACTION_KEY = '__codepilot_last_compaction__';

export function getSessionTasks(): Map<string, ScheduledTask> {
  if (!(globalThis as Record<string, unknown>)[SESSION_TASKS_KEY]) {
    (globalThis as Record<string, unknown>)[SESSION_TASKS_KEY] = new Map();
  }
  return (globalThis as Record<string, unknown>)[SESSION_TASKS_KEY] as Map<string, ScheduledTask>;
}

export function addSessionTask(task: ScheduledTask): void {
  getSessionTasks().set(task.id, task);
}

export function removeSessionTask(id: string): void {
  getSessionTasks().delete(id);
}

/**
 * Ensure the scheduler polling loop is running.
 * Safe to call multiple times — only starts once.
 */
export function ensureSchedulerRunning(): void {
  if ((globalThis as Record<string, unknown>)[GLOBAL_KEY]) return;
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = true;

  // One-time missed task recovery on startup
  handleMissedTasks().catch(err => console.error('[scheduler] Missed task recovery failed:', err));

  // Auto-expire recurring tasks on startup + hourly
  checkExpiredTasks().catch(() => {});
  const expiryIntervalId = setInterval(() => checkExpiredTasks().catch(() => {}), 3600_000); // hourly
  if (expiryIntervalId && typeof expiryIntervalId === 'object' && 'unref' in expiryIntervalId) {
    (expiryIntervalId as NodeJS.Timeout).unref();
  }

  const intervalId = setInterval(async () => {
    try {
      const now = new Date();
      const nowLocalStr = formatLocalDateTime(now);
      const { getDueTasks } = await import('./db');
      const dueTasks = getDueTasks(nowLocalStr);

      if (dueTasks.length > 0) {
        console.log(`[scheduler] Found ${dueTasks.length} due tasks at local time ${nowLocalStr}`);
      }

      // [Phase 3: Nightly Compaction]
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const todayStr = now.toISOString().split('T')[0];
      const lastCompaction = (globalThis as Record<string, unknown>)[LAST_COMPACTION_KEY];
      
      // If it's past 3:00 AM and we haven't run compaction today
      if (currentHour >= 3 && lastCompaction !== todayStr) {
        (globalThis as Record<string, unknown>)[LAST_COMPACTION_KEY] = todayStr;
        
        // Run nightly compaction asynchronously
        (async () => {
          try {
            console.log('[Nightly Compaction] Starting nightly memory compaction...');
            const { getSetting } = await import('./db');
            const workspacePath = getSetting('assistant_workspace_path');
            if (!workspacePath) {
              console.log('[Nightly Compaction] No assistant_workspace_path configured. Skipping.');
              return;
            }

            const nightlyEnabled = getSetting('nightly_compaction_enabled') !== 'false';
            if (!nightlyEnabled) {
              console.log('[Nightly Compaction] Nightly compaction is disabled in settings. Skipping.');
              return;
            }

            const fs = await import('fs');
            const path = await import('path');
            const dailyDir = path.join(workspacePath, 'memory', 'daily');
            
            if (!fs.existsSync(dailyDir)) {
              console.log('[Nightly Compaction] No daily memory directory found. Skipping.');
              return;
            }

            // Get yesterday's file
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayFile = path.join(dailyDir, `${yesterday.toISOString().split('T')[0]}.md`);

            if (!fs.existsSync(yesterdayFile)) {
              console.log(`[Nightly Compaction] No memory file found for yesterday (${yesterdayFile}). Skipping.`);
              return;
            }

            const content = fs.readFileSync(yesterdayFile, 'utf-8').trim();
            if (!content) return;

            console.log(`[Nightly Compaction] Processing ${yesterdayFile}...`);

            const { generateTextFromProvider } = await import('./text-generator');
            const { resolveProvider } = await import('./provider-resolver');
            
            // Prefer dedicated nightly model config, fallback to default provider
            const nightlyProviderId = getSetting('nightly_compaction_provider_id');
            const nightlyModel = getSetting('nightly_compaction_model');
            
            const resolved = resolveProvider({ 
              sessionProviderId: nightlyProviderId || undefined,
              sessionModel: nightlyModel || undefined
            });

            if (!resolved.hasCredentials) {
              console.warn('[Nightly Compaction] No API credentials configured. Skipping.');
              return;
            }

            const result = await generateTextFromProvider({
              providerId: resolved.provider?.id || '',
              model: resolved.upstreamModel || resolved.model || 'haiku',
              system: `You are an AI memory compaction agent. Extract high-value architectural decisions, proven solutions, and user preferences from the provided daily log. 
Format your output STRICTLY as a JSON array of entities to be saved to the MCP Memory Graph.
Example:
[
  {
    "name": "TailwindCSS",
    "entityType": "technology",
    "observations": ["User prefers Tailwind over CSS modules", "Configured custom color palette"]
  }
]
If there is nothing valuable to extract, return an empty array []. DO NOT wrap in markdown \`\`\`json block, just return the raw JSON array.`,
              prompt: `Daily Log:\n\n${content}`,
              maxTokens: 1000,
            });

            try {
              // Strip markdown JSON block if the model included it
              const rawJson = result.replace(/^```json/i, '').replace(/```$/i, '').trim();
              const entities = JSON.parse(rawJson);
              if (Array.isArray(entities) && entities.length > 0) {
                const mcpLoader = await import('./mcp-loader');
                const mcpConnectionManager = await import('./mcp-connection-manager');
                const memoryConfig = mcpLoader.loadAllMcpServers(workspacePath)?.['memory'];
                if (memoryConfig) {
                  await mcpConnectionManager.connectServer('memory', memoryConfig);
                }
                const { memoryClient } = await import('./memory-client');
                await memoryClient.createEntities(entities);
                console.log(`[Nightly Compaction] Successfully extracted and saved ${entities.length} entities to MCP Memory.`);
              } else {
                console.log('[Nightly Compaction] No high-value entities extracted.');
              }
            } catch (parseErr) {
              console.error('[Nightly Compaction] Failed to parse LLM output as JSON:', result);
            }
          } catch (err) {
            console.error('[Nightly Compaction] Error during compaction:', err);
          }
        })();
      }

      for (const task of dueTasks) {
        // Check active hours
        if (task.active_hours_start && task.active_hours_end) {
          const currentHourMin = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
          if (currentHourMin < task.active_hours_start || currentHourMin > task.active_hours_end) {
            console.log(`[scheduler] Skipping task ${task.id} (outside active hours ${task.active_hours_start}-${task.active_hours_end})`);
            continue;
          }
        }
        // Execute task asynchronously
        executeDueTask(task).catch(err => {
          console.error(`[scheduler] Unhandled error executing task ${task.id}:`, err);
        });
      }

      // Check session-only tasks too
      const sessionTasks = getSessionTasks();
      for (const [id, task] of sessionTasks) {
        const taskNextRun = parseLocalDateTime(task.next_run);
        if (task.status === 'active' && taskNextRun <= now) {
          // Execute and handle errors in-memory (session tasks aren't in SQLite)
          try {
            await executeDueTask(task, true);
            // Reset error count on success
            task.consecutive_errors = 0;
          } catch (err) {
            task.consecutive_errors = (task.consecutive_errors || 0) + 1;
            console.error(`[scheduler] Session task ${id} failed (${task.consecutive_errors}x):`, err);

            // Auto-disable after too many consecutive failures
            if (task.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
              task.status = 'disabled' as ScheduledTask['status'];
              console.warn(`[scheduler] Session task ${id} auto-disabled after ${task.consecutive_errors} failures`);
              continue;
            }

            // Exponential backoff: push next_run forward
            const backoffMs = BACKOFF_DELAYS[Math.min(task.consecutive_errors - 1, BACKOFF_DELAYS.length - 1)];
            task.next_run = formatLocalDateTime(new Date(Date.now() + backoffMs));
            continue; // Skip normal next_run advancement
          }

          if (task.schedule_type === 'once') {
            // One-shot session tasks: remove after fire
            sessionTasks.delete(id);
          } else {
            // Recurring session tasks: advance next_run in memory
            if (task.schedule_type === 'interval') {
              const ms = parseInterval(task.schedule_value);
              let nextRun = new Date(now.getTime() + ms);
              while (nextRun <= now) nextRun = new Date(nextRun.getTime() + ms);
              task.next_run = formatLocalDateTime(nextRun);
            } else if (task.schedule_type === 'cron') {
              const cronNext = getNextCronTime(task.schedule_value);
              if (cronNext) {
                task.next_run = formatLocalDateTime(cronNext);
              } else {
                // No valid next occurrence — pause this session task
                task.status = 'paused' as ScheduledTask['status'];
                console.warn(`[scheduler] Session cron task ${id} paused: no match within 4 years`);
                continue;
              }
            }
            task.last_run = formatLocalDateTime(now);
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] Poll error:', err);
    }
  }, POLL_INTERVAL);

  // Prevent the interval from keeping the process alive
  if (intervalId && typeof intervalId === 'object' && 'unref' in intervalId) {
    (intervalId as NodeJS.Timeout).unref();
  }

  console.log('[scheduler] Started with 10s poll interval');
}

/**
 * Stop the scheduler polling loop.
 */
export function stopScheduler(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = false;
  console.log('[scheduler] Stopped');
}

/**
 * Execute a single due task.
 * @param isSessionTask If true, skip SQLite writes and re-throw errors for caller handling.
 */
async function executeDueTask(task: ScheduledTask, isSessionTask = false): Promise<void> {
  const { updateScheduledTask, insertTaskRunLog, getSession, getAllSessions, getSetting } = await import('@/lib/db');
  const startTime = Date.now();

  // Mark as running (skip for session tasks — they're not in SQLite)
  if (!isSessionTask) {
    updateScheduledTask(task.id, { last_status: 'running' });
  }

  try {
    // Determine target session for provider resolution
    let targetSessionId = task.session_id;
    if (task.session_binding?.session_id) {
      targetSessionId = task.session_binding.session_id;
    }

    // Load session to get its provider configuration
    let providerId: string | undefined;
    let model: string | undefined;
    if (targetSessionId) {
      const session = getSession(targetSessionId);
      if (session) {
        providerId = session.provider_id;
        model = session.model;
      }
    }

    // Resolve provider using session's configuration (or fallback to global)
    // Use explicit providerId to avoid inactive provider fallback issue
    const { resolveProvider } = await import('./provider-resolver');

    const resolved = resolveProvider({
      providerId: targetSessionId ? providerId : undefined,
      sessionProviderId: providerId,
      sessionModel: model
    });

    // Build system prompt with task context and current system time
    const { buildSystemPrompt } = await import('./agent-system-prompt');
    const systemPromptResult = buildSystemPrompt({
      workingDirectory: task.working_directory || process.cwd(),
      modelId: resolved.upstreamModel || resolved.model || 'MiniMax-M2.7',
    });
    
    const baseSystem = typeof systemPromptResult === 'string'
      ? systemPromptResult
      : (systemPromptResult as { prompt?: string }).prompt || '';

    const systemTime = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    
    const system = `${baseSystem}\n\n=================================\n\nYou are executing a scheduled task. Be concise and direct.\nTask name: ${task.name}\nCurrent system time (Shanghai): ${systemTime}`;

    let result = '';

    if (task.tool_authorization) {
      // Execute via Native path (AI SDK) with MCP tools support
      const { runAgentLoop } = await import('./agent-loop');
      let toolsOverride: any = undefined;
      
      if (task.tool_authorization.type === 'mcp' && task.tool_authorization.tool_ids) {
        const { assembleTools } = await import('./agent-tools');
        const all = assembleTools({ workingDirectory: task.working_directory || process.cwd() });
        toolsOverride = {};
        
        // 1. Always include all built-in tools (not starting with mcp__)
        for (const [key, tool] of Object.entries(all.tools)) {
          if (!key.startsWith('mcp__')) {
            toolsOverride[key] = tool;
          }
        }
        
        // 2. Include selected MCP tools (tool_ids are MCP server names)
        for (const id of task.tool_authorization.tool_ids) {
          if (all.tools[id]) toolsOverride[id] = all.tools[id]; // exact match just in case
          const prefix = `mcp__${id}__`;
          for (const [key, tool] of Object.entries(all.tools)) {
            if (key.startsWith(prefix)) {
              toolsOverride[key] = tool;
            }
          }
        }
      }

      const stream = runAgentLoop({
        prompt: task.prompt,
        sessionId: targetSessionId || task.id,
        providerId: resolved.provider?.id,
        sessionProviderId: providerId,
        model: resolved.upstreamModel || resolved.model || 'MiniMax-M2.7',
        systemPrompt: system,
        workingDirectory: task.working_directory || process.cwd(),
        bypassPermissions: true, // Scheduled tasks run unattended, must bypass permissions
        autoTrigger: true,
        tools: toolsOverride,
      });

      const reader = stream.getReader();
      let buffer = '';
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
          if (line.startsWith('data: ')) {
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
                const tr = JSON.parse(data.data);
                
                // For bash commands, extract the command string
                let displayInput = currentToolInput;
                try {
                  const parsedInput = JSON.parse(currentToolInput);
                  if (currentToolName === 'Bash' && parsedInput.command) {
                    displayInput = parsedInput.command;
                  }
                } catch {}

                const inputPreview = displayInput.length > 50 ? displayInput.slice(0, 47) + '...' : displayInput;
                executionLog += `- 🛠️ 调用工具：\`${currentToolName}\` (输入: ${inputPreview})\n`;
                executionLog += `  - 结果：${tr.is_error ? '❌ 失败' : '✅ 成功'}\n`;
              } else if (data.type === 'error') {
                executionLog += `- ❌ 发生错误：${data.data}\n`;
              }
            } catch {}
          }
        }
      }
      
      // Flush the remaining buffer
      const finalLines = buffer.split('\n');
      for (const line of finalLines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') result += data.data;
          } catch {}
        }
      }

      const finalStatus = executionLog.includes('❌ 失败') || executionLog.includes('❌ 发生错误') ? '失败' : '成功';
      
      const finalOutput = result.trim() || '(无文本输出)';

      const formattedLog = `---定时任务结果---
任务目标：
${task.prompt}
执行结果：${finalStatus}
最终输出：
${finalOutput}
--------------
小结：工具使用：${toolCallCount}个${toolCallCount > 0 ? '\n' + executionLog.trim() : ''}`;

      result = formattedLog;
      // We also keep the clean output for the chat session
      (task as any)._cleanOutput = finalOutput;
    } else {
      // Execute without tools (lightweight text generation)
      const { generateTextFromProvider } = await import('./text-generator');
      const rawResult = await generateTextFromProvider({
        providerId: resolved.provider?.id || '',
        model: resolved.upstreamModel || resolved.model || 'MiniMax-M2.7',
        system,
        prompt: task.prompt,
        maxTokens: 4096,
      });
      const finalOutput = rawResult.trim() || '(无文本输出)';
      result = `---定时任务结果---
任务目标：
${task.prompt}
执行结果：成功
最终输出：
${finalOutput}
--------------
小结：未使用工具`;
      (task as any)._cleanOutput = finalOutput;
    }

    // Success — update SQLite (skip for session tasks)
    if (!isSessionTask) {
      updateScheduledTask(task.id, {
        last_status: 'success',
        last_result: result.slice(0, 2000),
        last_run: new Date().toISOString(),
        last_error: undefined,
        consecutive_errors: 0,
      });

      try {
        insertTaskRunLog({ task_id: task.id, status: 'success', result: result.slice(0, 2000), duration_ms: Date.now() - startTime });
      } catch { /* best effort logging */ }

      computeNextRun(task);
    }

    // Notify on completion via all configured channels
    const channels = task.notification_channels || ['toast'];
    if (task.notify_on_complete) {
      await sendMultiChannelNotification(
        channels,
        `✅ ${task.name}`,
        `${task.prompt}\n\n---\n执行结果：\n${((task as any)._cleanOutput || result).slice(0, 1000)}`,
        task.priority || 'normal',
      );
    }

    // Insert result as assistant message only if the 'session' channel is selected
    if (channels.includes('session')) {
      try {
        const { addMessage, getSetting, getLatestSessionByWorkingDirectory, getAllSessions } = await import('@/lib/db');
        const workspacePath = getSetting('assistant_workspace_path');
        let msgTargetSessionId = targetSessionId;

        if (!msgTargetSessionId && workspacePath) {
          const session = getLatestSessionByWorkingDirectory(workspacePath);
          if (session) msgTargetSessionId = session.id;
        }

        // Fallback: if still no session, use the most recent session overall
        if (!msgTargetSessionId) {
          const sessions = getAllSessions();
          if (sessions.length > 0) msgTargetSessionId = sessions[0].id;
        }

        if (msgTargetSessionId) {
          // Load buddy info for personalized notification
          let buddyPrefix = '📋';
          try {
            const { loadState } = await import('@/lib/assistant-workspace');
            if (workspacePath) {
              const st = loadState(workspacePath);
              if (st.buddy) {
                buddyPrefix = `${st.buddy.emoji} ${st.buddy.buddyName || ''}`.trim();
              }
            }
          } catch {}
          
          // Build structured final message for the session and bridge
          const header = `**⏰ 定时任务执行完毕**\n- **任务名称**：${task.name}\n- **计划时间**：${task.next_run}\n- **执行耗时**：${(Date.now() - startTime) / 1000}s\n\n---\n\n`;
          const finalMessage = `${buddyPrefix} ${header}${(task as any)._cleanOutput || result}`;
          addMessage(msgTargetSessionId, 'assistant', finalMessage);
          
          // Forward message to any active bridge channels bound to this session
          try {
            const { deliverToSession } = await import('@/lib/bridge/bridge-manager');
            await deliverToSession(msgTargetSessionId, finalMessage);
          } catch { /* best effort */ }
        }
      } catch (err) { console.error('Failed to write session message', err); }
    }

    console.log(`[scheduler] Task ${task.id} (${task.name}) completed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const errors = task.consecutive_errors + 1;

    // For session tasks: skip SQLite writes and re-throw so the poll loop handles backoff
    if (isSessionTask) {
      // Notify on failure (best effort)
      if (task.notify_on_complete) {
        const channels = task.notification_channels || ['toast'];
        await sendMultiChannelNotification(
          channels,
          `❌ ${task.name}`,
          `任务执行失败：\n${task.prompt}\n\n错误信息：\n${errorMsg.slice(0, 300)}`,
          'urgent',
        ).catch(() => {});
      }
      console.error(`[scheduler] Session task ${task.id} (${task.name}) error:`, errorMsg);
      throw err;
    }

    updateScheduledTask(task.id, {
      last_status: 'error',
      last_error: errorMsg,
      last_run: new Date().toISOString(),
      consecutive_errors: errors,
    });

    // Log failed execution
    try {
      insertTaskRunLog({ task_id: task.id, status: 'error', error: errorMsg, duration_ms: Date.now() - startTime });
    } catch { /* best effort logging */ }

    // Exponential backoff
    applyBackoff(task.id, errors);

    // Notify on failure via all configured channels
    const channels = task.notification_channels || ['toast'];
    if (task.notify_on_complete) {
      await sendMultiChannelNotification(
        channels,
        `❌ ${task.name}`,
        `任务执行失败：\n${task.prompt}\n\n错误信息：\n${errorMsg.slice(0, 300)}`,
        'urgent',
      );
    }

    // Insert error as assistant message only if the 'session' channel is selected
    if (channels.includes('session')) {
      try {
        const { addMessage, getSetting } = await import('@/lib/db');
        const workspacePath = getSetting('assistant_workspace_path');
        let msgTargetSessionId = task.session_id;
        if (task.session_binding?.session_id) {
          msgTargetSessionId = task.session_binding.session_id;
        }

        if (!msgTargetSessionId && workspacePath) {
          const session = (await import('@/lib/db')).getLatestSessionByWorkingDirectory(workspacePath);
          if (session) msgTargetSessionId = session.id;
        }

        // Fallback: if still no session, use the most recent session overall
        if (!msgTargetSessionId) {
          const sessions = getAllSessions();
          if (sessions.length > 0) msgTargetSessionId = sessions[0].id;
        }

        if (msgTargetSessionId) {
          // Load buddy info for personalized error notification
          let buddyPrefix = '❌';
          try {
            const { loadState } = await import('@/lib/assistant-workspace');
            if (workspacePath) {
              const st = loadState(workspacePath);
              if (st.buddy) {
                buddyPrefix = `${st.buddy.emoji} ${st.buddy.buddyName || ''}`.trim();
              }
            }
          } catch {}
          const finalErrorMsg = `${buddyPrefix} ❌ **${task.name}** (定时任务失败)\n\n${errorMsg}`;
          addMessage(msgTargetSessionId, 'assistant', finalErrorMsg);
          
          // Forward message to any active bridge channels bound to this session
          try {
            const { deliverToSession } = await import('@/lib/bridge/bridge-manager');
            await deliverToSession(msgTargetSessionId, finalErrorMsg);
          } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
    }

    console.error(`[scheduler] Task ${task.id} (${task.name}) error (${errors}x):`, errorMsg);
  }
}

/**
 * Deterministic jitter: same task always gets the same jitter offset.
 * Prevents thundering-herd when many tasks share the same interval.
 */
function getJitter(taskId: string, intervalMs: number): number {
  const hash = parseInt(taskId.slice(0, 8), 16) / 0xFFFFFFFF;
  const maxJitter = Math.min(intervalMs * 0.1, 15 * 60 * 1000); // 10% of interval, max 15min
  return Math.floor(hash * maxJitter);
}

/**
 * Compute and set the next_run time for a recurring task.
 */
async function computeNextRun(task: ScheduledTask): Promise<void> {
  const { updateScheduledTask } = await import('@/lib/db');
  const now = new Date();
  const nowLocalStr = formatLocalDateTime(now);

  switch (task.schedule_type) {
    case 'once':
      updateScheduledTask(task.id, { status: 'completed' });
      return;

    case 'interval': {
      const ms = parseInterval(task.schedule_value);
      const lastRunStr = task.last_run || nowLocalStr;
      // 解析本地时间字符串为 Date 对象进行计算
      const lastRun = parseLocalDateTime(lastRunStr);
      let nextRun = new Date(lastRun.getTime() + ms);
      // Anchor-based: skip past missed runs
      while (nextRun <= now) nextRun = new Date(nextRun.getTime() + ms);
      // Apply deterministic jitter to avoid thundering-herd
      nextRun = new Date(nextRun.getTime() + getJitter(task.id, ms));
      updateScheduledTask(task.id, { next_run: formatLocalDateTime(nextRun) });
      break;
    }

    case 'cron': {
      const nextRun = getNextCronTime(task.schedule_value);
      if (nextRun) {
        updateScheduledTask(task.id, { next_run: formatLocalDateTime(nextRun) });
      } else {
        // No valid next occurrence within 4 years — pause the task
        updateScheduledTask(task.id, { status: 'paused', last_error: 'No valid cron match within 4 years' });
        console.warn(`[scheduler] Task ${task.id} paused: cron "${task.schedule_value}" has no match within 4 years`);
      }
      break;
    }
  }
}

/**
 * 解析本地时间字符串 YYYY-MM-DD HH:mm:ss 或 ISO 格式为 Date 对象
 */
function parseLocalDateTime(dateStr: string): Date {
  // 如果是 ISO 格式，先转为本地时间
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // YYYY-MM-DD HH:mm:ss 格式
  const [datePart, timePart] = dateStr.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s] = timePart.split(':').map(Number || 0);
  return new Date(y, mo - 1, d, h, mi, s);
}

/**
 * Apply exponential backoff after task failure.
 */
async function applyBackoff(taskId: string, errors: number): Promise<void> {
  const { updateScheduledTask } = await import('@/lib/db');
  const delay = BACKOFF_DELAYS[Math.min(errors - 1, BACKOFF_DELAYS.length - 1)];
  const nextRun = new Date(Date.now() + delay);
  updateScheduledTask(taskId, { next_run: nextRun.toISOString() });

  // Auto-disable after too many consecutive failures
  if (errors >= MAX_CONSECUTIVE_ERRORS) {
    updateScheduledTask(taskId, { status: 'disabled' });
    console.warn(`[scheduler] Task ${taskId} auto-disabled after ${errors} consecutive failures`);
  }
}

/**
 * Send a notification via the notify API (which handles Toast + Electron + Telegram).
 */
async function sendTaskNotification(title: string, body: string, priority: 'low' | 'normal' | 'urgent'): Promise<void> {
  try {
    const { sendNotification } = await import('@/lib/notification-manager');
    await sendNotification({ title, body, priority });
  } catch {
    // Best effort — don't let notification failure affect task execution
  }
}

/**
 * Send notification through multiple channels based on task configuration.
 * @param channels Array of notification channels: 'toast', 'system', 'telegram', 'email', 'session'
 * @param title Notification title
 * @param body Notification body
 * @param priority Notification priority (controls Telegram delivery)
 */
async function sendMultiChannelNotification(
  channels: NotificationChannel[],
  title: string,
  body: string,
  priority: 'low' | 'normal' | 'urgent'
): Promise<void> {
  try {
    const { sendNotification, enqueueNotification } = await import('@/lib/notification-manager');

    // Channel 1: Toast (in-app) — always via notification queue
    if (channels.includes('toast')) {
      enqueueNotification(title, body, priority);
    }

    // Channel 2: System notification (Electron) — for normal/urgent priority
    if (channels.includes('system')) {
      enqueueNotification(title, body, priority);
    }

    // Channel 3: Telegram (mobile) — only for urgent priority
    if (priority === 'urgent' || channels.includes('telegram')) {
      try {
        const { notifyGeneric } = await import('@/lib/telegram-bot');
        await notifyGeneric(title, body);
      } catch { /* best effort */ }
    }

    // Channel 4: Email — placeholder for future email integration
    if (channels.includes('email')) {
      // TODO: Implement email notification
    }

    // Channel 5: Session — write directly to the task's session
    if (channels.includes('session')) {
      // Already handled in executeDueTask via addMessage
    }
  } catch {
    // Best effort
  }
}

// ── Missed task recovery ──────────────────────────────────────────

/**
 * One-time recovery for tasks that were missed while the app was closed.
 * Finds past-due one-shot tasks and executes them immediately with a notification.
 */
async function handleMissedTasks(): Promise<void> {
  const { getDueTasks, getSetting, getLatestSessionByWorkingDirectory, getAllSessions, addMessage } = await import('@/lib/db');

  // Find one-shot tasks that are past due (missed while app was closed)
  const dueTasks = getDueTasks();
  const missedOnce = dueTasks.filter(t => t.schedule_type === 'once');

  if (missedOnce.length === 0) return;

  console.log(`[scheduler] Found ${missedOnce.length} missed one-shot task(s)`);

  const workspacePath = getSetting('assistant_workspace_path');

  for (const task of missedOnce) {
    // Notify user about missed task
    const message = `⏰ **过期提醒: ${task.name}**\n\n你有一个定时任务在 app 关闭期间到期了：\n\n> ${task.prompt}\n\n这个任务将立即执行。`;

    try {
      let targetSessionId = task.session_id;
      if (!targetSessionId && workspacePath) {
        const session = getLatestSessionByWorkingDirectory(workspacePath);
        if (session) targetSessionId = session.id;
      }
      // Fallback: if still no session, use the most recent session overall
      if (!targetSessionId) {
        const sessions = getAllSessions();
        if (sessions.length > 0) targetSessionId = sessions[0].id;
      }
      if (targetSessionId) {
        addMessage(targetSessionId, 'assistant', message);
        try {
          const { deliverToSession } = await import('@/lib/bridge/bridge-manager');
          await deliverToSession(targetSessionId, message);
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }

    // Execute the missed task immediately
    executeDueTask(task).catch(err =>
      console.error(`[scheduler] Missed task ${task.id} execution failed:`, err)
    );
  }
}

/**
 * Auto-expire recurring tasks older than 7 days (unless marked permanent).
 */
async function checkExpiredTasks(): Promise<void> {
  const { listScheduledTasks, updateScheduledTask } = await import('@/lib/db');
  const now = Date.now();
  const activeTasks = listScheduledTasks({ status: 'active' });

  for (const task of activeTasks) {
    if (task.schedule_type === 'once') continue; // once tasks complete themselves
    if (task.permanent) continue; // permanent tasks never expire

    const age = now - new Date(task.created_at).getTime();
    if (age > RECURRING_MAX_AGE_MS) {
      updateScheduledTask(task.id, { status: 'disabled' });
      console.log(`[scheduler] Task ${task.id} (${task.name}) auto-expired after 7 days`);

      // Notify
      try {
        await sendTaskNotification(`⏰ ${task.name}`, 'This recurring task has auto-expired after 7 days. Recreate it if needed.', 'low');
      } catch { /* best effort */ }
    }
  }
}

// ── Utility functions ──────────────────────────────────────────────

/**
 * Parse interval string like "30m", "2h", "1d" to milliseconds.
 */
export function parseInterval(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 10 * 60 * 1000; // default 10m
  const num = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * (multipliers[unit] || 60000);
}

/**
 * Simple 5-field cron expression parser.
 * Day-level scan over 4 years (1461 days) to cover all valid schedules
 * including leap-year-only dates like `0 9 29 2 *`.
 */
export function getNextCronTime(expression: string): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    console.warn(`[scheduler] Invalid cron expression: "${expression}"`);
    return null;
  }

  const now = new Date();

  // Scan each day for up to 4 years, testing all 1440 minutes per day.
  // For common expressions this returns on day 0-1; sparse ones (monthly, yearly)
  // may scan further but the day-level outer loop keeps it bounded.
  for (let day = 0; day <= 1461; day++) {
    const baseDate = new Date(now.getTime() + day * 86400000);
    const y = baseDate.getFullYear();
    const mo = baseDate.getMonth();
    const d = baseDate.getDate();

    // Quick pre-check: skip this day entirely if dom/month/dow can't match
    const testDate = new Date(y, mo, d, 0, 0, 0, 0);
    if (!matchField(testDate.getDate(), parts[2]) ||
        !matchField(testDate.getMonth() + 1, parts[3]) ||
        !matchField(testDate.getDay(), parts[4])) {
      continue;
    }

    // Day matches — scan minutes
    for (let m = 0; m < 1440; m++) {
      const candidate = new Date(y, mo, d, Math.floor(m / 60), m % 60, 0, 0);
      if (candidate <= now) continue;
      if (matchField(candidate.getMinutes(), parts[0]) &&
          matchField(candidate.getHours(), parts[1])) {
        return candidate;
      }
    }
  }

  // No match found within 4 years — expression is either impossible (e.g. Feb 30)
  // or extremely sparse (e.g. Feb 29 on a specific weekday). Return null so
  // callers can pause the task instead of scheduling a fake execution time.
  console.warn(`[scheduler] No cron match for "${expression}" within 4 years`);
  return null;
}

function matchesCron(date: Date, parts: string[]): boolean {
  const [min, hour, dom, month, dow] = parts;
  return matchField(date.getMinutes(), min)
    && matchField(date.getHours(), hour)
    && matchField(date.getDate(), dom)
    && matchField(date.getMonth() + 1, month)
    && matchField(date.getDay(), dow);
}

function matchField(value: number, field: string): boolean {
  if (field === '*') return true;
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const stepNum = parseInt(step);
    if (base === '*') return value % stepNum === 0;
    return value >= parseInt(base) && (value - parseInt(base)) % stepNum === 0;
  }
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(field) === value;
}
