/**
 * POST /api/bridge/feishu/register/start
 *
 * Begin a Feishu App Registration device flow.
 * Returns a session_id and verification_url for the frontend to open in a browser.
 */

import { NextResponse } from 'next/server';
import { startRegistration } from '@/lib/bridge/feishu-app-registration';

export async function POST() {
  try {
    // 中文注释：功能名称「飞书应用注册启动」。
    // 用法：设置页点击“一键创建”后，通过此接口拿到 session_id 与授权链接。
    const { sessionId, verificationUrl } = await startRegistration();
    return NextResponse.json({ session_id: sessionId, verification_url: verificationUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start registration' },
      { status: 500 },
    );
  }
}
