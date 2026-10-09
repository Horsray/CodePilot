/**
 * Unit tests for session pinning (收藏会话).
 *
 * Run with: npx tsx --test src/__tests__/unit/session-pin.test.ts
 *
 * Tests verify that:
 * 1. New sessions default to unpinned (pinned_at = '')
 * 2. updateSessionPinned(true) writes a timestamp, updateSessionPinned(false) clears it
 * 3. Timestamp uses the project-wide 'YYYY-MM-DD HH:MM:SS' format (sortable for the pinned section)
 * 4. Pinned sessions stay in getAllSessions() — the sidebar filters them client-side, so
 *    other consumers (bridge, global search) keep seeing the full list
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set a temp data dir before importing db module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-pin-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

// Use require to avoid top-level await issues with CJS output
/* eslint-disable @typescript-eslint/no-require-imports */
const { closeDb, createSession, getSession, getAllSessions, updateSessionPinned } =
  require('../../lib/db') as typeof import('../../lib/db');

describe('session pinning', () => {
  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('new sessions default to unpinned', () => {
    const session = createSession('Pin Test Default');
    assert.equal(session.pinned_at, '');
  });

  it('pins a session with a sortable timestamp and unpins it back to empty', () => {
    const session = createSession('Pin Test Toggle');
    const now = new Date('2026-10-09T10:00:00Z');

    updateSessionPinned(session.id, true, now);
    const pinned = getSession(session.id);
    // 与服务端其它时间字段一致：'YYYY-MM-DD HH:MM:SS'（按字符串排序即为时间序）
    assert.equal(pinned?.pinned_at, '2026-10-09 10:00:00');

    updateSessionPinned(session.id, false);
    const unpinned = getSession(session.id);
    assert.equal(unpinned?.pinned_at, '');
  });

  it('keeps pinned sessions in getAllSessions() for non-sidebar consumers', () => {
    const session = createSession('Pin Test List');
    updateSessionPinned(session.id, true);

    const all = getAllSessions();
    const found = all.find((s) => s.id === session.id);
    assert.ok(found, 'pinned session should still be returned by getAllSessions');
    assert.ok(found!.pinned_at, 'pinned_at should be populated');
  });

  it('re-pinning refreshes the timestamp (most recently pinned first)', () => {
    const session = createSession('Pin Test Refresh');

    updateSessionPinned(session.id, true, new Date('2026-10-09T08:00:00Z'));
    assert.equal(getSession(session.id)?.pinned_at, '2026-10-09 08:00:00');

    updateSessionPinned(session.id, true, new Date('2026-10-09T12:30:00Z'));
    assert.equal(getSession(session.id)?.pinned_at, '2026-10-09 12:30:00');
  });
});
