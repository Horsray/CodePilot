import { NextRequest, NextResponse } from 'next/server';
import { parseInterval, getNextCronTime, ensureSchedulerRunning } from '@/lib/task-scheduler';

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      prompt,
      schedule_type,
      schedule_value,
      priority,
      notify_on_complete,
      session_id,
      working_directory,
      group_id,
      group_name,
      notification_channels,
      session_binding,
      tool_authorization,
      active_hours_start,
      active_hours_end,
    } = body;

    if (!name || !prompt || !schedule_type || !schedule_value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Calculate next_run (使用本地时间，不用 UTC)
    let next_run: string;
    const now = new Date();

    if (schedule_type === 'once') {
      // Parse the datetime-local input (YYYY-MM-DDTHH:mm) as local time
      const localDate = new Date(schedule_value + ':00'); // 补上秒
      if (isNaN(localDate.getTime())) {
        return NextResponse.json({ error: 'Invalid datetime format' }, { status: 400 });
      }
      // 直接使用本地时间字符串，格式：YYYY-MM-DD HH:mm:ss
      const y = localDate.getFullYear();
      const mo = String(localDate.getMonth() + 1).padStart(2, '0');
      const d = String(localDate.getDate()).padStart(2, '0');
      const h = String(localDate.getHours()).padStart(2, '0');
      const mi = String(localDate.getMinutes()).padStart(2, '0');
      const s = String(localDate.getSeconds()).padStart(2, '0');
      next_run = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    } else if (schedule_type === 'interval') {
      const ms = parseInterval(schedule_value);
      const future = new Date(now.getTime() + ms);
      // 使用本地时间字符串格式
      next_run = formatLocalDateTime(future);
    } else if (schedule_type === 'cron') {
      const cronNext = getNextCronTime(schedule_value);
      if (!cronNext) {
        return NextResponse.json({ error: `Cron expression "${schedule_value}" has no valid occurrence within 4 years` }, { status: 400 });
      }
      next_run = formatLocalDateTime(cronNext);
    } else {
      return NextResponse.json({ error: 'Invalid schedule_type' }, { status: 400 });
    }

    const { createScheduledTask } = await import('@/lib/db');
    const task = createScheduledTask({
      name,
      prompt,
      schedule_type,
      schedule_value,
      next_run,
      status: 'active',
      priority: priority || 'normal',
      notify_on_complete: notify_on_complete ? 1 : 0,
      consecutive_errors: 0,
      permanent: 0,
      session_id: session_id || null,
      working_directory: working_directory || null,
      group_id: group_id || null,
      group_name: group_name || null,
      // 新增字段
      notification_channels: notification_channels || ['toast'],
      session_binding: session_binding || null,
      tool_authorization: tool_authorization || null,
      active_hours_start: active_hours_start || null,
      active_hours_end: active_hours_end || null,
    });

    // Ensure the scheduler is running
    ensureSchedulerRunning();

    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
