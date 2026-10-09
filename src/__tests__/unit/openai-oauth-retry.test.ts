/**
 * Tests for OAuth token exchange retry behavior.
 *
 * Background: Issue #464 reports users hitting "Token exchange failed: 403"
 * on macOS + Windows while the maintainer's machines never reproduce.
 * Strong network-stability dependence — the upstream OpenCode reference
 * implementation handles this with retries on 403/5xx/network errors.
 *
 * These tests pin the retry classification logic so the regression doesn't
 * silently come back when someone tries to "tighten" the retryable set
 * (e.g. removing 403 because "auth errors shouldn't retry") without
 * understanding the practical reason.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isRetryableTokenExchangeFailure, extractReadableErrorMessage } from '../../lib/openai-oauth';
import { fetchOpenAI } from '../../lib/proxy-fetch';

describe('extractReadableErrorMessage', () => {
  it('JSON 错误体保持原样透传（非 HTML）', () => {
    assert.equal(extractReadableErrorMessage('{"error":"invalid_grant"}'), '{"error":"invalid_grant"}');
  });

  it('纯文本错误体直接返回并截断', () => {
    assert.equal(extractReadableErrorMessage('some plain error'), 'some plain error');
  });

  it('HTML 错误页提取 <title>，不再整页源码刷屏', () => {
    const body = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div>cloudflare</div></body></html>';
    const msg = extractReadableErrorMessage(body);
    assert.ok(msg, '应返回可读消息');
    assert.match(msg!, /Just a moment\.\.\./);
    assert.doesNotMatch(msg!, /<!DOCTYPE html>/);
  });

  it('HTML 无 title 时退化为纯文本提取', () => {
    const body = '<html><body><h1>Access Denied</h1><script>alert(1)</script></body></html>';
    const msg = extractReadableErrorMessage(body);
    assert.ok(msg);
    assert.match(msg!, /Access Denied/);
    assert.doesNotMatch(msg!, /alert\(1\)/);
  });

  it('空体返回 null', () => {
    assert.equal(extractReadableErrorMessage('   '), null);
  });
});

describe('isRetryableTokenExchangeFailure', () => {
  describe('network-level failures (status=null)', () => {
    it('retries plain network failures', () => {
      assert.equal(isRetryableTokenExchangeFailure(null), true);
    });

    it('retries ECONNRESET', () => {
      const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries ETIMEDOUT', () => {
      const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries DNS lookup failures', () => {
      const err = Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries connection refused', () => {
      const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });
  });

  describe('HTTP status retry classification', () => {
    it('retries 403 — OpenAI auth-code propagation race (issue #464)', () => {
      assert.equal(isRetryableTokenExchangeFailure(403), true);
    });

    it('retries 408 (request timeout)', () => {
      assert.equal(isRetryableTokenExchangeFailure(408), true);
    });

    it('retries 429 (rate limited)', () => {
      assert.equal(isRetryableTokenExchangeFailure(429), true);
    });

    it('retries 500/502/503/504 (server errors)', () => {
      assert.equal(isRetryableTokenExchangeFailure(500), true);
      assert.equal(isRetryableTokenExchangeFailure(502), true);
      assert.equal(isRetryableTokenExchangeFailure(503), true);
      assert.equal(isRetryableTokenExchangeFailure(504), true);
    });

    it('does NOT retry 200 (would be ok anyway)', () => {
      // (we wouldn't reach this branch for 2xx, but the function still classifies it)
      assert.equal(isRetryableTokenExchangeFailure(200), false);
    });

    it('does NOT retry 400 (bad request — code is malformed, retrying won\'t help)', () => {
      assert.equal(isRetryableTokenExchangeFailure(400), false);
    });

    it('does NOT retry 401 (genuine auth failure)', () => {
      assert.equal(isRetryableTokenExchangeFailure(401), false);
    });

    it('does NOT retry 404 (endpoint wrong — config bug, not transient)', () => {
      assert.equal(isRetryableTokenExchangeFailure(404), false);
    });

    it('does NOT retry 422 (validation error)', () => {
      assert.equal(isRetryableTokenExchangeFailure(422), false);
    });
  });
});

describe('fetchOpenAI', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps a nested socket error code so OAuth retry can classify it', async () => {
    const socketError = Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' });
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed', { cause: socketError });
    };

    await assert.rejects(
      () => fetchOpenAI('https://example.invalid', {}, { phase: 'OAuth token exchange', timeoutMs: 100 }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'OpenAINetworkError');
        assert.equal((error as { code?: string }).code, 'ETIMEDOUT');
        return true;
      },
    );
  });

  it('turns an aborted request into a phase-specific timeout error', async () => {
    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

    await assert.rejects(
      () => fetchOpenAI('https://example.invalid', {}, { phase: 'OAuth token exchange', timeoutMs: 1 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'ETIMEDOUT');
        assert.match(String(error), /OAuth token exchange: timed out after 1ms/);
        return true;
      },
    );
  });
});
