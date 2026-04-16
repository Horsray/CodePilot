/**
 * POST /api/bridge/feishu/register/poll
 *
 * Poll a Feishu App Registration session for completion.
 * On success, credentials are auto-saved to DB and bot info is verified.
 */

import { NextResponse } from 'next/server';
import { pollRegistration, cancelRegistration } from '@/lib/bridge/feishu-app-registration';
import { getSetting } from '@/lib/db';
import { getStatus, restart } from '@/lib/bridge/bridge-manager';

async function verifyCredentials(appId: string, appSecret: string, domain: string): Promise<{ botName?: string; error?: string }> {
  const baseUrl = domain === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn';

  const tokenRes = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.tenant_access_token) {
    return { error: tokenData.msg || 'Failed to get access token' };
  }

  const botRes = await fetch(`${baseUrl}/open-apis/bot/v3/info/`, {
    headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const botData = await botRes.json();
  if (botData?.bot?.open_id) {
    return { botName: botData.bot.app_name || botData.bot.open_id };
  }
  return { error: botData?.msg || 'Could not retrieve bot info' };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.session_id;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    const session = await pollRegistration(sessionId);

    // 中文注释：功能名称「飞书注册会话收尾」。
    // 用法：成功/失败/过期后延迟清理，避免前端刷新时会话立刻丢失。
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'expired') {
      setTimeout(() => cancelRegistration(sessionId), 30_000).unref();
    }

    let botName: string | undefined;
    let verifyError: string | undefined;
    let bridgeRestartError: string | undefined;

    if (session.status === 'completed' && session.appId && session.appSecret) {
      const domain = session.domain || getSetting('bridge_feishu_domain') || 'feishu';
      const verify = await verifyCredentials(session.appId, session.appSecret, domain);
      botName = verify.botName;
      verifyError = verify.error;

      if (getStatus().running) {
        try {
          const result = await restart();
          if (!result.started) bridgeRestartError = result.reason || 'Bridge restart failed';
        } catch (err) {
          bridgeRestartError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return NextResponse.json({
      status: session.status,
      app_id: session.appId || undefined,
      domain: session.domain || undefined,
      bot_name: botName || undefined,
      verify_error: verifyError || undefined,
      error_code: session.errorCode || undefined,
      error_detail: session.errorDetail || undefined,
      bridge_restart_error: bridgeRestartError,
      interval_ms: session.status === 'waiting' ? session.interval : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to poll registration' },
      { status: 500 },
    );
  }
}
