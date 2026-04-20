/**
 * GET /api/tasks/[id]/logs
 * 获取指定任务的执行历史日志
 */
import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = request.nextUrl;
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  try {
    const { getTaskRunLogs, getScheduledTask } = await import('@/lib/db');

    const task = getScheduledTask(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const logs = getTaskRunLogs(id, limit);
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
