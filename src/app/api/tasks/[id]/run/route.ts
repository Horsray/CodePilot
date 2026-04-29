import { NextRequest, NextResponse } from 'next/server';

// 中文注释：功能名称「本地时间格式化」，用法是把“立即执行”时间写成调度器可比较的本地字符串，避免 ISO/UTC 格式导致手动测试任务不触发。
function formatLocalDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { getScheduledTask, updateScheduledTask } = await import('@/lib/db');
    const task = getScheduledTask(id);
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Set next_run to now to trigger immediate execution
    updateScheduledTask(id, {
      next_run: formatLocalDateTime(new Date()),
      status: 'active',
      last_status: undefined,
    });

    // Ensure scheduler picks it up
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();

    return NextResponse.json({ success: true, message: 'Task will execute on next poll cycle' });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
