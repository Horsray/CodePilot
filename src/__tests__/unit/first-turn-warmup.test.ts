import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingSessionMessage } from '@/lib/pending-session-message';
import {
  FIRST_TURN_WARMUP_IDLE_GRACE_MS,
  FIRST_TURN_WARMUP_TIMEOUT_MS,
  getPendingFirstTurnStatusText,
  getPendingFirstTurnRemainingDelayMs,
  shouldReleasePendingFirstTurn,
} from '@/lib/first-turn-warmup';

function createPending(createdAt: number): PendingSessionMessage {
  return {
    sessionId: 'session-1',
    clientMessageId: 'temp-1',
    content: 'hello',
    createdAt,
  };
}

describe('shouldReleasePendingFirstTurn', () => {
  it('releases immediately when warmup is ready', () => {
    const pending = createPending(Date.now());
    assert.equal(shouldReleasePendingFirstTurn(pending, 'ready'), true);
  });

  it('releases immediately when warmup failed', () => {
    const pending = createPending(Date.now());
    assert.equal(shouldReleasePendingFirstTurn(pending, 'failed'), true);
  });

  it('waits while warmup is still in progress within timeout budget', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'warming', createdAt + FIRST_TURN_WARMUP_TIMEOUT_MS - 1),
      false,
    );
  });

  it('falls back to direct send after timeout budget', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'warming', createdAt + FIRST_TURN_WARMUP_TIMEOUT_MS),
      true,
    );
  });

  it('only waits for a short grace window while warmup is still idle', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'idle', createdAt + FIRST_TURN_WARMUP_IDLE_GRACE_MS - 1),
      false,
    );
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'idle', createdAt + FIRST_TURN_WARMUP_IDLE_GRACE_MS),
      true,
    );
  });
});

describe('getPendingFirstTurnStatusText', () => {
  it('returns session bootstrap status while warmup is still idle', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnStatusText(pending, 'idle', createdAt + 100),
      '正在建立新会话...',
    );
  });

  it('returns preparing status while waiting for warmup', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnStatusText(pending, 'warming', createdAt + 1000),
      '正在准备 Claude Code 环境...',
    );
  });

  it('returns fallback send status after timeout', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnStatusText(pending, 'warming', createdAt + FIRST_TURN_WARMUP_TIMEOUT_MS + 1),
      '正在直接发送首条消息...',
    );
  });
});

describe('getPendingFirstTurnRemainingDelayMs', () => {
  it('uses the short idle grace window before warmup actually starts', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnRemainingDelayMs(pending, 'idle', createdAt),
      FIRST_TURN_WARMUP_IDLE_GRACE_MS,
    );
  });

  it('returns zero when the pending message should be released immediately', () => {
    const pending = createPending(Date.now());
    assert.equal(getPendingFirstTurnRemainingDelayMs(pending, 'ready'), 0);
    assert.equal(getPendingFirstTurnRemainingDelayMs(null, 'warming'), 0);
  });
});
