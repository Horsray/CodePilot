import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Ensure scheduler is running when the task list is viewed
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();

    const status = request.nextUrl.searchParams.get('status') || undefined;
    const { listScheduledTasks } = await import('@/lib/db');
    const tasks = listScheduledTasks(status ? { status } : undefined);
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
