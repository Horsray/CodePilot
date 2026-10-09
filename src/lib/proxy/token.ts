/**
 * 中文注释：本地转换代理的进程级访问令牌。
 *
 * OpenAI 兼容中转的请求需要经过本地 /api/proxy/<providerId> 转换成 Anthropic 格式给 CLI。
 * 该路由会使用数据库里存的真实 API Key 向上游发请求，因此必须防止被同网段的其它进程滥用。
 * 做法：服务进程启动时生成一个随机令牌（挂在 globalThis 上，跨 Next HMR 存活），
 * 构造 CLI 环境变量时把它塞进 ANTHROPIC_AUTH_TOKEN（CLI 会以 Bearer 头发送），
 * 代理侧校验一致后才转发；CLI 侧永远拿不到真实的上游 Key。
 */

const TOKEN_KEY = '__codepilotProxyToken__';

export function getProxyToken(): string {
  const g = globalThis as Record<string, unknown>;
  if (typeof g[TOKEN_KEY] !== 'string' || !g[TOKEN_KEY]) {
    // Node 18+ / 浏览器均可用；服务端只走 Node 分支
    g[TOKEN_KEY] = globalThis.crypto?.randomUUID?.() || `cp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
  return g[TOKEN_KEY] as string;
}

/** 从 Authorization: Bearer <token> 或 x-api-key 中提取请求携带的令牌并校验。 */
export function isAuthorizedProxyRequest(headers: Headers): boolean {
  const expected = getProxyToken();
  const auth = headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const apiKey = headers.get('x-api-key') || '';
  return bearer === expected || apiKey === expected;
}
