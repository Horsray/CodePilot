/**
 * Unit tests for searchMessages (db) and session-search related behavior.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-session-search-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  clearSessionMessages,
  searchMessages,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

describe('searchMessages (db)', () => {
  let sessionA: string;
  let sessionB: string;

  before(() => {
    const a = createSession('Planning session', 'sonnet', '', tmpDir);
    const b = createSession('Bug triage', 'sonnet', '', tmpDir);
    sessionA = a.id;
    sessionB = b.id;

    addMessage(sessionA, 'user', 'Let us plan the authentication rewrite');
    addMessage(sessionA, 'assistant', 'Here is the proposed authentication approach with PKCE flow');
    addMessage(sessionA, 'user', 'What about refresh tokens?');
    addMessage(sessionA, 'assistant', 'Refresh tokens should be rotated every session');

    addMessage(sessionB, 'user', 'I hit a bug in authentication when token expires');
    addMessage(sessionB, 'assistant', 'That sounds like a PKCE state mismatch');
  });

  after(() => {
    try {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 中文注释：测试清理失败时忽略，避免因为临时目录状态影响断言结果。
    }
  });

  it('returns results matching the query across all sessions', () => {
    const results = searchMessages('authentication');
    assert.ok(results.length >= 3, `expected at least 3 results, got ${results.length}`);
    assert.ok(results.every((r) => r.snippet.toLowerCase().includes('authentication')));
  });

  it('results include session title from chat_sessions join', () => {
    const results = searchMessages('PKCE');
    assert.ok(results.length >= 1);
    const titles = new Set(results.map((r) => r.sessionTitle));
    assert.ok(
      titles.has('Planning session') || titles.has('Bug triage'),
      `expected to find titled sessions, got ${[...titles]}`,
    );
  });

  it('sessionId filter restricts results to one session', () => {
    const results = searchMessages('authentication', { sessionId: sessionA });
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.sessionId === sessionA));
  });

  it('limit is respected', () => {
    const results = searchMessages('authentication', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('limit default is 5', () => {
    for (let i = 0; i < 10; i++) {
      addMessage(sessionA, 'user', `authentication test message ${i}`);
    }
    try {
      const results = searchMessages('authentication');
      assert.ok(results.length <= 5, `expected <=5 with default limit, got ${results.length}`);
    } finally {
      clearSessionMessages(sessionA);
      addMessage(sessionA, 'user', 'Let us plan the authentication rewrite');
      addMessage(sessionA, 'assistant', 'Here is the proposed authentication approach with PKCE flow');
    }
  });

  it('empty query returns empty results', () => {
    assert.equal(searchMessages('').length, 0);
    assert.equal(searchMessages('   ').length, 0);
  });

  it('no-match query returns empty array', () => {
    const results = searchMessages('totallyuniquestringnowayitsinmessages');
    assert.equal(results.length, 0);
  });

  it('most recent results come first', () => {
    const results = searchMessages('authentication');
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].createdAt >= results[i + 1].createdAt);
    }
  });

  it('snippet contains the match', () => {
    const results = searchMessages('PKCE');
    assert.ok(results.length >= 1);
    assert.ok(results[0].snippet.includes('PKCE'));
  });

  it('LIKE wildcards in query are treated as literals', () => {
    addMessage(sessionB, 'user', 'The progress was 80% complete');
    const results = searchMessages('80%');
    assert.ok(results.some((r) => r.snippet.includes('80%')));
    const wildcardOnly = searchMessages('100%');
    assert.equal(wildcardOnly.length, 0);
  });

  it('returns role and timestamps as documented fields', () => {
    const results = searchMessages('authentication', { limit: 1 });
    assert.equal(results.length, 1);
    const r = results[0];
    assert.ok(['user', 'assistant'].includes(r.role));
    assert.ok(typeof r.createdAt === 'string');
    assert.ok(typeof r.messageId === 'string');
    assert.ok(typeof r.sessionId === 'string');
    assert.ok(typeof r.sessionTitle === 'string');
  });
});
