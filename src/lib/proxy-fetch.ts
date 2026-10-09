/**
 * proxy-fetch.ts — 服务端 fetch 的代理支持（对齐 cc-haha configureGlobalAgents）。
 *
 * Node 原生 fetch（undici）默认不读 HTTPS_PROXY 环境变量，也不读系统代理。
 * 国内网络直连 OpenAI 会被返回 403 unsupported_country_region_territory。
 * cc-haha 通过 undici.setGlobalDispatcher 让所有请求走代理；本项目只给
 * OpenAI OAuth / Codex 请求局部装配，避免影响本机 localhost 等其它请求。
 */

import { execFileSync } from 'node:child_process';
import type { Dispatcher } from 'undici';

let cachedDispatcher: Dispatcher | null | undefined; // undefined=未解析 null=无代理

function normalizeProxyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.includes('://') ? trimmed : `http://${trimmed}`;
}

/**
 * 探测系统代理（macOS scutil / Windows 注册表）。
 * 用户常用 Clash/Surge 等工具只设系统代理、不导出 shell 环境变量。
 */
export function detectSystemProxy(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 });
      const httpEnabled = /HTTPEnable\s*:\s*1/.test(out);
      const httpHost = /HTTPProxy\s*:\s*([^\s]+)/.exec(out)?.[1];
      const httpPort = /HTTPPort\s*:\s*(\d+)/.exec(out)?.[1];
      if (httpEnabled && httpHost && httpPort && httpHost !== '0.0.0.0') {
        return `http://${httpHost}:${httpPort}`;
      }
      // 只有 SOCKS 时也支持
      const socksEnabled = /SOCKSEnable\s*:\s*1/.test(out);
      const socksHost = /SOCKSProxy\s*:\s*([^\s]+)/.exec(out)?.[1];
      const socksPort = /SOCKSPort\s*:\s*(\d+)/.exec(out)?.[1];
      if (socksEnabled && socksHost && socksPort && socksHost !== '0.0.0.0') {
        return `socks5://${socksHost}:${socksPort}`;
      }
      return null;
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
        { encoding: 'utf8', timeout: 3000 }
      );
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out);
      if (!enabled) return null;
      const m = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/.exec(out);
      return m ? normalizeProxyUrl(m[1]) : null;
    }
  } catch {
    // 探测失败按无代理处理
  }
  return null;
}

/**
 * 获取用于 OpenAI 请求的 undici dispatcher（含代理），结果缓存。
 * 解析顺序：HTTPS_PROXY/HTTP_PROXY 环境变量 → 系统代理探测。
 */
export function getProxyDispatcher(): Dispatcher | undefined {
  if (cachedDispatcher !== undefined) return cachedDispatcher ?? undefined;

  let proxyUrl =
    process.env.https_proxy || process.env.HTTPS_PROXY ||
    process.env.http_proxy || process.env.HTTP_PROXY || '';
  proxyUrl = proxyUrl.trim();

  let source = 'env';
  if (!proxyUrl) {
    const sys = detectSystemProxy();
    if (sys) {
      proxyUrl = sys;
      source = 'system';
    }
  }

  if (!proxyUrl) {
    cachedDispatcher = null;
    return undefined;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EnvHttpProxyAgent } = require('undici') as typeof import('undici');
    const dispatcher = new EnvHttpProxyAgent({
      httpProxy: normalizeProxyUrl(proxyUrl) || proxyUrl,
      httpsProxy: normalizeProxyUrl(proxyUrl) || proxyUrl,
      noProxy: process.env.no_proxy || process.env.NO_PROXY,
    });
    cachedDispatcher = dispatcher;
    console.log(`[proxy-fetch] OpenAI 请求走${source === 'system' ? '系统' : '环境变量'}代理:`, proxyUrl.replace(/\/\/[^@]*@/, '//***@'));
    return dispatcher;
  } catch (err) {
    console.warn('[proxy-fetch] 创建代理 agent 失败，退回直连:', err);
    cachedDispatcher = null;
    return undefined;
  }
}

/** 给 fetch 请求附带代理 dispatcher（无代理时返回空对象） */
export function withProxyFetchOptions(): { dispatcher?: Dispatcher } {
  const dispatcher = getProxyDispatcher();
  return dispatcher ? { dispatcher } : {};
}

export type OpenAIRequestPhase =
  | 'OAuth token exchange'
  | 'OAuth token refresh'
  | 'Codex API request';

/**
 * Preserve the underlying network code while adding the operation that failed.
 * Node's fetch usually wraps socket failures in a generic TypeError, which made
 * the OAuth UI report only "fetch failed" and hid timeouts from retry logic.
 */
export class OpenAINetworkError extends Error {
  code?: string;

  constructor(phase: OpenAIRequestPhase, message: string, cause?: unknown, code?: string) {
    super(`${phase}: ${message}`);
    this.name = 'OpenAINetworkError';
    this.code = code || getNetworkErrorCode(cause);
  }
}

function getNetworkErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return getNetworkErrorCode(candidate.cause);
}

/**
 * Shared transport for every OpenAI OAuth and Codex request. It applies the
 * same proxy policy, honours the caller's cancellation signal, and turns an
 * otherwise opaque fetch timeout into an actionable error for the UI.
 */
export async function fetchOpenAI(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { phase: OpenAIRequestPhase; timeoutMs: number },
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    return await fetch(input, {
      ...init,
      signal,
      ...withProxyFetchOptions(),
    } as RequestInit);
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new OpenAINetworkError(
        options.phase,
        `timed out after ${options.timeoutMs}ms. Check the system proxy or HTTPS_PROXY.`,
        error,
        'ETIMEDOUT',
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenAINetworkError(options.phase, message, error);
  } finally {
    clearTimeout(timeout);
  }
}
