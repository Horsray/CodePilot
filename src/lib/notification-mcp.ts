/**
 * codepilot-notify MCP — in-process MCP server for notifications and scheduled tasks.
 *
 * Provides 4 tools:
 * - codepilot_notify: Send an immediate notification
 * - codepilot_schedule_task: Create a scheduled task
 * - codepilot_list_tasks: List scheduled tasks
 * - codepilot_cancel_task: Cancel a scheduled task
 *
 * Globally registered: available in all contexts (no keyword gating).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** Resolve base URL from PORT env, supporting worktree dev servers and Electron builds. */
function getBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export const NOTIFICATION_MCP_SYSTEM_PROMPT = `## 通知与定时任务

你可以发送通知和创建定时任务：

- codepilot_notify: 立即发送通知给用户（支持系统通知和应用内提示）
- codepilot_schedule_task: 创建定时任务（支持 cron 表达式、固定间隔、一次性定时）
- codepilot_list_tasks: 查看已有的定时任务
- codepilot_cancel_task: 取消定时任务
- codepilot_hatch_buddy: 孵化或命名用户的助理伙伴

使用场景：
- 用户说"提醒我..."或"X 分钟后..." → 用 codepilot_schedule_task（schedule_type: "once"）
- 用户说"每天/每小时..." → 用 codepilot_schedule_task（schedule_type: "cron" 或 "interval"）
- 任务完成需要告知用户 → 用 codepilot_notify
- 用户问"有哪些定时任务" → 用 codepilot_list_tasks
- 用户说"孵化"、"领养"、"hatch" → 用 codepilot_hatch_buddy
- 用户给伙伴起名字 → 用 codepilot_hatch_buddy(buddyName: 名字)

创建定时任务（codepilot_schedule_task）的重要规则：
1. 默认工具授权：必须将 tool_authorization 设为 { "type": "full_access" } 以确保任务能使用所需工具。
2. 默认通知渠道：必须将 notification_channels 设为 ["toast", "system", "telegram", "session"] 以确保用户能收到通知，并保持 notify_on_complete 为 true。
3. 时间核对：创建前，请先向用户核对任务的名称、执行内容、执行时间、通知渠道等信息。
4. 时区注意：所有的 "once" 时间（schedule_value）必须使用北京时间（UTC+8）的本地时间格式（YYYY-MM-DD HH:mm:ss）。请根据当前的系统时间计算出正确的北京时间，绝对不要使用 UTC 时间，否则会导致任务在错误的时间执行。`;

export function createNotificationMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-notify',
    version: '1.0.0',
    tools: [
      // Tool 1: Immediate notification
      tool(
        'codepilot_notify',
        'Send an immediate notification to the user. Supports system notification, in-app toast, and Telegram (for urgent). Use when a task completes, something needs attention, or user asked to be notified.',
        {
          title: z.string().describe('Notification title'),
          body: z.string().describe('Notification body text'),
          priority: z.enum(['low', 'normal', 'urgent']).optional().default('normal')
            .describe('low=toast only, normal=toast+system, urgent=toast+system+telegram'),
        },
        async ({ title, body, priority }) => {
          try {
            const { sendNotification } = await import('@/lib/notification-manager');
            await sendNotification({ title, body, priority });
            return { content: [{ type: 'text' as const, text: `Notification sent: "${title}"` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 2: Schedule a task
      tool(
        'codepilot_schedule_task',
        'Create a scheduled task. Supports cron expressions (e.g. "0 9 * * *" for daily 9am), fixed intervals (e.g. "30m", "2h"), or one-time timestamps (local time YYYY-MM-DD HH:mm:ss, e.g. "2026-03-31 15:00:00"). Use Beijing Time (UTC+8).',
        {
          name: z.string().describe('Task name (e.g. "Drink water reminder")'),
          prompt: z.string().describe('The instruction to execute when triggered'),
          schedule_type: z.enum(['cron', 'interval', 'once']).describe('Schedule type'),
          schedule_value: z.string().describe('cron: "0 9 * * *", interval: "30m"/"2h", once: local time like "2026-03-31 15:00:00"'),
          priority: z.enum(['low', 'normal', 'urgent']).optional().default('normal'),
          notify_on_complete: z.boolean().optional().default(true),
          notification_channels: z.array(z.enum(['toast', 'system', 'telegram', 'session'])).optional().default(['toast', 'system', 'telegram', 'session']),
          tool_authorization: z.object({
            type: z.enum(['none', 'full_access', 'mcp']),
            tool_ids: z.array(z.string()).optional()
          }).optional().default({ type: 'full_access' }),
          durable: z.boolean().optional().default(true).describe('true=persists across restart, false=session-only'),
        },
        async ({ name, prompt, schedule_type, schedule_value, priority, notify_on_complete, notification_channels, tool_authorization, durable }) => {
          try {
            // Session-only tasks: stored in memory, not persisted to DB
            if (!durable) {
              const crypto = await import('crypto');
              const { addSessionTask } = await import('@/lib/task-scheduler');
              const id = crypto.randomBytes(8).toString('hex');
              const now = new Date();

              let next_run: string;
              if (schedule_type === 'once') {
                next_run = schedule_value; // local timestamp
              } else if (schedule_type === 'interval') {
                const { parseInterval } = await import('@/lib/task-scheduler');
                const future = new Date(now.getTime() + parseInterval(schedule_value));
                // format local time
                const y = future.getFullYear();
                const mo = String(future.getMonth() + 1).padStart(2, '0');
                const d = String(future.getDate()).padStart(2, '0');
                const h = String(future.getHours()).padStart(2, '0');
                const mi = String(future.getMinutes()).padStart(2, '0');
                const s = String(future.getSeconds()).padStart(2, '0');
                next_run = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
              } else {
                const { getNextCronTime } = await import('@/lib/task-scheduler');
                const cronNext = getNextCronTime(schedule_value);
                if (!cronNext) {
                  return { content: [{ type: 'text' as const, text: `Cron expression "${schedule_value}" has no valid occurrence within 4 years. Task not created.` }] };
                }
                const y = cronNext.getFullYear();
                const mo = String(cronNext.getMonth() + 1).padStart(2, '0');
                const d = String(cronNext.getDate()).padStart(2, '0');
                const h = String(cronNext.getHours()).padStart(2, '0');
                const mi = String(cronNext.getMinutes()).padStart(2, '0');
                const s = String(cronNext.getSeconds()).padStart(2, '0');
                next_run = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
              }

              const task: any = {
                id,
                name,
                prompt,
                schedule_type,
                schedule_value,
                next_run,
                consecutive_errors: 0,
                status: 'active' as const,
                priority: priority || 'normal',
                notify_on_complete: notify_on_complete ? 1 : 0,
                notification_channels,
                tool_authorization,
                permanent: 0,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
              };
              addSessionTask(task);
              return { content: [{ type: 'text' as const, text: `Session task "${name}" scheduled (non-durable). ID: ${id}, next run: ${next_run}` }] };
            }

            const res = await fetch(`${getBaseUrl()}/api/tasks/schedule`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                name, prompt, schedule_type, schedule_value, priority, 
                notify_on_complete: notify_on_complete ? 1 : 0,
                notification_channels,
                tool_authorization
              }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            return { content: [{ type: 'text' as const, text: `Task "${name}" scheduled. ID: ${data.task.id}, next run: ${data.task.next_run}` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to schedule task: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 3: List tasks
      tool(
        'codepilot_list_tasks',
        'List all scheduled tasks with their IDs, schedules, status, and next run time.',
        {
          status: z.enum(['active', 'paused', 'completed', 'disabled', 'all']).optional().default('all')
            .describe('Filter by status'),
        },
        async ({ status }) => {
          try {
            // Fetch durable tasks from SQLite
            const url = status && status !== 'all'
              ? `${getBaseUrl()}/api/tasks/list?status=${status}`
              : `${getBaseUrl()}/api/tasks/list`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const tasks: Array<{ id: string; name: string; schedule_type: string; schedule_value: string; status: string; next_run: string; last_status?: string; durable?: boolean }> = (data.tasks || []).map((t: Record<string, unknown>) => ({ ...t, durable: true }));

            // Merge session-only tasks from memory
            try {
              const { getSessionTasks } = await import('@/lib/task-scheduler');
              for (const [, task] of getSessionTasks()) {
                if (status && status !== 'all' && task.status !== status) continue;
                tasks.push({
                  id: task.id,
                  name: task.name + ' (session)',
                  schedule_type: task.schedule_type,
                  schedule_value: task.schedule_value,
                  status: task.status,
                  next_run: task.next_run,
                  last_status: task.last_status,
                  durable: false,
                });
              }
            } catch { /* best effort */ }

            if (tasks.length === 0) {
              return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
            }
            const formatted = tasks.map((t, i) =>
              `${i + 1}. [${t.id}] ${t.name}\n   Type: ${t.schedule_type} (${t.schedule_value})\n   Status: ${t.status} | Next: ${t.next_run}${t.last_status ? ` | Last: ${t.last_status}` : ''}${t.durable === false ? ' | Session-only' : ''}`
            ).join('\n\n');
            return { content: [{ type: 'text' as const, text: formatted }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to list tasks: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 4: Cancel task
      tool(
        'codepilot_cancel_task',
        'Cancel (delete) a scheduled task by its ID.',
        {
          task_id: z.string().describe('The task ID to cancel'),
        },
        async ({ task_id }) => {
          try {
            // Try session-only tasks first
            const { removeSessionTask, getSessionTasks } = await import('@/lib/task-scheduler');
            const sessionTasks = getSessionTasks();
            if (sessionTasks.has(task_id)) {
              removeSessionTask(task_id);
              return { content: [{ type: 'text' as const, text: `Session task ${task_id} cancelled.` }] };
            }

            // Fall back to durable task deletion via API
            const res = await fetch(`${getBaseUrl()}/api/tasks/${task_id}`, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `HTTP ${res.status}`);
            }
            return { content: [{ type: 'text' as const, text: `Task ${task_id} cancelled.` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to cancel task: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 5: Hatch / name buddy
      tool(
        'codepilot_hatch_buddy',
        'Hatch a new buddy companion for the user, or update the buddy name. Call this when the user wants to adopt/hatch their buddy or give it a name.',
        {
          buddyName: z.string().optional().describe('Name for the buddy (user-given)'),
        },
        async ({ buddyName }) => {
          try {
            const res = await fetch(`${getBaseUrl()}/api/workspace/hatch-buddy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ buddyName: buddyName || '' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.buddy) throw new Error('No buddy data');

            const b = data.buddy;
            const { SPECIES_LABEL, RARITY_DISPLAY, STAT_LABEL, SPECIES_IMAGE_URL, getBuddyTitle } = await import('@/lib/buddy');
            const speciesName = SPECIES_LABEL[b.species as keyof typeof SPECIES_LABEL]?.zh || b.species;
            const rarityInfo = RARITY_DISPLAY[b.rarity as keyof typeof RARITY_DISPLAY];
            const title = getBuddyTitle(b);
            const imageUrl = SPECIES_IMAGE_URL[b.species as keyof typeof SPECIES_IMAGE_URL] || '';
            const statsText = Object.entries(b.stats)
              .map(([stat, val]) => `${STAT_LABEL[stat as keyof typeof STAT_LABEL]?.zh || stat}: ${val}`)
              .join(' · ');

            const result = [
              data.alreadyHatched ? `Updated buddy name to "${buddyName}"` : `Hatched a new buddy!`,
              `Species: ${b.emoji} ${speciesName}`,
              `Rarity: ${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || b.rarity}`,
              title ? `Title: "${title}"` : '',
              `Stats: ${statsText}`,
              `Peak: ${b.peakStat}`,
              imageUrl ? `Image: ${imageUrl}` : '',
              buddyName ? `Name: ${buddyName}` : '',
            ].filter(Boolean).join('\n');

            return { content: [{ type: 'text' as const, text: result }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to hatch buddy: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),
    ],
  });
}
