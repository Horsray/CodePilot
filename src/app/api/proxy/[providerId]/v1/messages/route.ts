import { handleProxyMessages } from '@/lib/proxy/handler';

/**
 * 中文注释：本地 OpenAI→Anthropic 转换代理入口。
 * CLI 的 ANTHROPIC_BASE_URL 被指到 /api/proxy/<providerId>，
 * 因此 CLI 会请求 POST /api/proxy/<providerId>/v1/messages（Anthropic 格式）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// SSE 长连接不设超时
export const maxDuration = 3600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;
  return handleProxyMessages(providerId, request);
}
