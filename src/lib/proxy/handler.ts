import { getProvider } from '@/lib/db';
import { anthropicToOpenaiChat } from './anthropicToOpenaiChat';
import { openaiChatToAnthropic } from './openaiChatToAnthropic';
import { openaiChatStreamToAnthropic } from './openaiChatStreamToAnthropic';
import { isAuthorizedProxyRequest } from './token';

/**
 * 中文注释：本地 Anthropic ⇄ OpenAI 转换代理（对齐 cc-haha 的 open 代理转换）。
 *
 * 背景：Claude Code CLI 只会说 Anthropic Messages 格式，而 OpenAI 兼容中转站
 * （bananarouter 等）只提供 /v1/chat/completions。这里接住 CLI 发来的
 * POST /api/proxy/<providerId>/v1/messages，转换成 OpenAI 请求转发给上游，
 * 再把响应（含流式 SSE）转换回 Anthropic 格式。
 *
 * 安全：仅接受携带进程级令牌的请求（令牌通过 ANTHROPIC_AUTH_TOKEN 注入 CLI，
 * 真实的上游 API Key 只存在于服务进程内，永不下发给 CLI）。
 */

export const PROXY_STREAM_TIMEOUT_MS = 30 * 60 * 1000;

/** 把服务商配置的 base_url 归一化为根地址（去掉结尾的 / 和 /v1），再拼目标路径。 */
export function normalizeUpstreamUrl(baseUrl: string, path: string): string {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${root}${path}`;
}

interface AnthropicRequestBody {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
}

export async function handleProxyMessages(
  providerId: string,
  request: Request,
): Promise<Response> {
  if (!isAuthorizedProxyRequest(request.headers)) {
    return Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Unauthorized proxy request' } },
      { status: 401 },
    );
  }

  const provider = getProvider(decodeURIComponent(providerId));
  if (!provider) {
    return Response.json(
      { type: 'error', error: { type: 'not_found_error', message: `Provider not found: ${providerId}` } },
      { status: 404 },
    );
  }

  let body: AnthropicRequestBody;
  try {
    body = (await request.json()) as AnthropicRequestBody;
  } catch {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const isStream = body.stream === true;
  const transformed = anthropicToOpenaiChat(body as never);
  const url = normalizeUpstreamUrl(provider.base_url || '', '/v1/chat/completions');

  let extraHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(provider.headers_json || '{}');
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') extraHeaders[k] = v;
      }
    }
  } catch {
    /* ignore malformed headers */
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.api_key || ''}`,
    ...extraHeaders,
  };

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: AbortSignal.timeout(PROXY_STREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
          },
        },
        { status: upstream.status },
      );
    }

    if (isStream) {
      if (!upstream.body) {
        return Response.json(
          { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
          { status: 502 },
        );
      }
      const anthropicStream = openaiChatStreamToAnthropic(
        upstream.body as unknown as Parameters<typeof openaiChatStreamToAnthropic>[0],
        body.model || 'unknown',
      );
      return new Response(anthropicStream as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    const responseBody = await upstream.json();
    const anthropicResponse = openaiChatToAnthropic(responseBody, body.model || 'unknown');
    return Response.json(anthropicResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { type: 'error', error: { type: 'api_error', message: `Proxy upstream request failed: ${message}` } },
      { status: 502 },
    );
  }
}
