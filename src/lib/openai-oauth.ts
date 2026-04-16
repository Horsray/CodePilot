/**
 * openai-oauth.ts — OpenAI PKCE OAuth + Token Exchange.
 *
 * Implements the Codex CLI OAuth flow for ChatGPT Plus/Pro users.
 * Based on CraftAgent's verified implementation.
 *
 * Flow: PKCE auth → code exchange → id_token → RFC 8693 token exchange → OpenAI API Key
 */

import { randomBytes, createHash } from 'node:crypto';

// ── OAuth Configuration ────────────────────────────────────────

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';
export const CALLBACK_PORT = 1455;

// ── Types ──────────────────────────────────────────────────────

export interface OAuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix ms
}

export interface PreparedFlow {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

export interface JwtClaims {
  email?: string;
  chatgpt_account_id?: string;
  chatgpt_plan_type?: string;
  organizations?: Array<{ id: string }>;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
}

// ── PKCE ───────────────────────────────────────────────────────

function generateState(): string {
  return randomBytes(32).toString('hex');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ── Prepare OAuth Flow ─────────────────────────────────────────

export function prepareOAuthFlow(): PreparedFlow {
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
  });

  return {
    authUrl: `${AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

// ── Exchange Code for Tokens ───────────────────────────────────

/**
 * 中文注释：功能名称「OAuth token exchange 重试判定」。
 * 用法：把网络抖动、403 传播延迟、429 和 5xx 归类为可重试，避免一次瞬时失败直接中断登录流程。
 */
export function isRetryableTokenExchangeFailure(status: number | null, err?: unknown): boolean {
  if (status === null) return true;
  if (status >= 500) return true;
  if (status === 403 || status === 408 || status === 429) return true;
  if (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      return true;
    }
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  // 中文注释：功能名称「OAuth token exchange 重试执行」。
  // 用法：在 OpenAI 授权码刚签发的短窗口内，允许对 403/网络错误做有限重试，降低偶发登录失败。
  const MAX_ATTEMPTS = 3;
  let lastStatus: number | null = null;
  let lastBody = '';
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });
    } catch (err) {
      lastStatus = null;
      lastErr = err;
      lastBody = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS && isRetryableTokenExchangeFailure(null, err)) {
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }
      throw new Error(`Token exchange failed (network): ${lastBody}`);
    }

    if (response.ok) {
      const data = await response.json() as {
        id_token: string;
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      return {
        idToken: data.id_token,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
    }

    lastStatus = response.status;
    lastBody = await response.text();

    if (attempt < MAX_ATTEMPTS && isRetryableTokenExchangeFailure(response.status)) {
      await sleep(1000 * Math.pow(2, attempt - 1));
      continue;
    }
    break;
  }

  let msg: string;
  try {
    const parsed = JSON.parse(lastBody);
    msg = parsed.error_description || parsed.error || JSON.stringify(parsed);
  } catch {
    msg = lastBody || (lastErr instanceof Error ? lastErr.message : 'unknown');
  }
  throw new Error(`Token exchange failed after ${MAX_ATTEMPTS} attempts: ${lastStatus ?? 'network'} - ${msg}`);
}

// ── Refresh Tokens ─────────────────────────────────────────────

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg: string;
    try {
      const j = JSON.parse(text);
      msg = j.error_description || j.error || text;
    } catch { msg = text; }
    throw new Error(`Token refresh failed: ${response.status} - ${msg}`);
  }

  const data = await response.json() as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

// ── Parse JWT Claims (without verification) ────────────────────

export function parseIdTokenClaims(idToken: string): JwtClaims {
  try {
    const payload = idToken.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

/**
 * Extract ChatGPT account ID from JWT claims.
 * Used as ChatGPT-Account-Id header for Codex API calls.
 */
export function extractAccountId(claims: JwtClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

/**
 * Codex API endpoint — ChatGPT Plus/Pro users access OpenAI models through this.
 * Uses access_token as Bearer + ChatGPT-Account-Id header.
 */
export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
