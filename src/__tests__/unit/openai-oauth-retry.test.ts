/**
 * 中文注释：功能名称「openai-oauth 重试判定单元测试」。
 * 用法：固定 OAuth token exchange 的重试边界，避免后续把 403/网络抖动误收紧导致登录偶发失败。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isRetryableTokenExchangeFailure } from '../../lib/openai-oauth';

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
    it('retries 403', () => {
      assert.equal(isRetryableTokenExchangeFailure(403), true);
    });

    it('retries 408', () => {
      assert.equal(isRetryableTokenExchangeFailure(408), true);
    });

    it('retries 429', () => {
      assert.equal(isRetryableTokenExchangeFailure(429), true);
    });

    it('retries 500/502/503/504', () => {
      assert.equal(isRetryableTokenExchangeFailure(500), true);
      assert.equal(isRetryableTokenExchangeFailure(502), true);
      assert.equal(isRetryableTokenExchangeFailure(503), true);
      assert.equal(isRetryableTokenExchangeFailure(504), true);
    });

    it('does NOT retry 200', () => {
      assert.equal(isRetryableTokenExchangeFailure(200), false);
    });

    it('does NOT retry 400', () => {
      assert.equal(isRetryableTokenExchangeFailure(400), false);
    });

    it('does NOT retry 401', () => {
      assert.equal(isRetryableTokenExchangeFailure(401), false);
    });

    it('does NOT retry 404', () => {
      assert.equal(isRetryableTokenExchangeFailure(404), false);
    });

    it('does NOT retry 422', () => {
      assert.equal(isRetryableTokenExchangeFailure(422), false);
    });
  });
});
