import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PendingSessionMessage } from '@/lib/pending-session-message';
import {
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

const ROOT = process.cwd();
function read(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
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

  it('releases immediately while warmup is still in progress', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'warming', createdAt + 60_000),
      true,
    );
  });

  it('releases immediately while warmup is still idle', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      shouldReleasePendingFirstTurn(pending, 'idle', createdAt + 60_000),
      true,
    );
  });
});

describe('getPendingFirstTurnStatusText', () => {
  it('does not show a blocking warmup status while warmup is still idle', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnStatusText(pending, 'idle', createdAt + 100),
      null,
    );
  });

  it('does not show a blocking warmup status while warmup is running', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnStatusText(pending, 'warming', createdAt + 1000),
      null,
    );
  });

});

describe('getPendingFirstTurnRemainingDelayMs', () => {
  it('always returns zero because warmup must not block sending', () => {
    const createdAt = Date.now();
    const pending = createPending(createdAt);
    assert.equal(
      getPendingFirstTurnRemainingDelayMs(pending, 'idle', createdAt),
      0,
    );
    assert.equal(
      getPendingFirstTurnRemainingDelayMs(pending, 'warming', createdAt + 60_000),
      0,
    );
  });

  it('returns zero when the pending message should be released immediately', () => {
    const pending = createPending(Date.now());
    assert.equal(getPendingFirstTurnRemainingDelayMs(pending, 'ready'), 0);
    assert.equal(getPendingFirstTurnRemainingDelayMs(null, 'warming'), 0);
  });
});

describe('ChatView warmup input behavior', () => {
  it('does not disable prompt input while background warmup is running', () => {
    const chatView = read('src/components/chat/ChatView.tsx');
    assert.match(chatView, /<MessageInput[\s\S]*disabled=\{false\}/);
    assert.doesNotMatch(chatView, /disabled=\{!isStreaming && .*runtimeWarmupState/);
  });
});
