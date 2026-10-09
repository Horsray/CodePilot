import { NextResponse } from 'next/server';
import { backgroundJobManager } from '@/lib/background-job-manager';

/**
 * API to trigger backgrounding of a running tool call.
 */
export async function POST(req: Request) {
  try {
    const { sessionId, toolCallId } = await req.json();

    if (!sessionId || !toolCallId) {
      return NextResponse.json({ error: 'Missing sessionId or toolCallId' }, { status: 400 });
    }

    backgroundJobManager.signalBackground(sessionId, toolCallId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/chat/background] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 中文注释：此 API 用于接收来自前端的信号，通知后台正在运行的指定工具（toolCallId）转入后台执行，
// 从而释放当前的 AI 思考主循环。
