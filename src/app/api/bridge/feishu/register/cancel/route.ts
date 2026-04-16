/**
 * POST /api/bridge/feishu/register/cancel
 *
 * Cancel an in-progress Feishu App Registration session.
 */

import { NextResponse } from 'next/server';
import { cancelRegistration } from '@/lib/bridge/feishu-app-registration';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.session_id;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // 中文注释：功能名称「飞书注册取消」。
    // 用法：用户取消一键创建时，主动销毁服务端会话，避免晚到的授权结果变成孤儿绑定。
    cancelRegistration(sessionId);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel' },
      { status: 500 },
    );
  }
}
