import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-retention-'));
process.env.CLAUDE_GUI_DATA_DIR = dataDir;
const legacy = new Database(path.join(dataDir, 'codepilot.db'));
legacy.exec(`CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, working_directory TEXT NOT NULL
);
INSERT INTO chat_sessions VALUES ('legacy', 'Legacy', '2000-01-01', '2000-01-01', '/legacy');`);
legacy.close();

// Explicit .ts avoids unrelated generated JS files in local development trees.
const store: typeof import('../../lib/db') = require('../../lib/db.ts');
const now = new Date('2026-10-09T12:00:00Z');
const stale = '2026-10-01 12:00:00';

after(() => {
  store.getDb().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

it('migrates old sessions with a fresh seven-day grace period', () => {
  const startedAt = Date.now();
  const session = store.getSession('legacy');
  assert.ok(session?.last_opened_at, 'migration must record last opened time');
  assert.ok(Date.parse(session.last_opened_at.replace(' ', 'T') + 'Z') >= startedAt - 2000);
});

it('marks explicit opens, validates IDs, and throttles cleanup on background list reads', async () => {
  // Route imports should use this same isolated real database even when a local
  // generated db.js would otherwise shadow db.ts. Only count cleanup invocations.
  const Module = require('node:module');
  const dbPath = require.resolve('@/lib/db');
  const previousModule = require.cache[dbPath];
  const routeDbModule = new Module(dbPath);
  let cleanups = 0;
  routeDbModule.exports = {
    ...store,
    cleanupStaleSessions() {
      cleanups++;
      return store.cleanupStaleSessions();
    },
  };
  routeDbModule.loaded = true;
  require.cache[dbPath] = routeDbModule;
  const { GET, PATCH } = require('../../app/api/chat/sessions/route.ts');
  const session = store.createSession('Visited', '', '', '/visited');
  store.getDb().prepare('UPDATE chat_sessions SET last_opened_at = ? WHERE id = ?').run(stale, session.id);
  try {
    assert.equal((await GET()).status, 200);
    assert.equal((await GET()).status, 200);
    assert.equal(cleanups, 1);
    assert.equal(store.getSession(session.id)!.last_opened_at, stale);
    const patch = (body: unknown) => PATCH(new Request('http://localhost/api/chat/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    assert.equal((await patch({})).status, 400);
    assert.equal((await patch({ opened_session_id: 'missing' })).status, 404);
    assert.equal((await patch({ opened_session_id: session.id })).status, 200);
    assert.notEqual(store.getSession(session.id)!.last_opened_at, stale);
  } finally {
    if (previousModule) require.cache[dbPath] = previousModule;
    else delete require.cache[dbPath];
  }
});

it('only actual route entries renew retention; detail polling stays read-only', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/chat/[id]/page.tsx'), 'utf8');
  assert.match(page, /opened_session_id: id/);
  assert.match(page, /method: 'PATCH'/);
  const detailRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/chat/sessions/[id]/route.ts'), 'utf8');
  assert.doesNotMatch(detailRoute, /markSessionOpened/);
});

describe('session retention', () => {
  beforeEach(() => {
    const db = store.getDb();
    db.prepare('DELETE FROM scheduled_tasks').run();
    db.prepare('DELETE FROM channel_outbound_refs').run();
    db.prepare('DELETE FROM chat_sessions').run();
  });

  function project(directory: string, count = 12) {
    return Array.from({ length: count }, (_, index) => {
      const session = store.createSession(`Session ${index}`, '', '', directory);
      store.getDb().prepare('UPDATE chat_sessions SET updated_at = ?, last_opened_at = ? WHERE id = ?')
        .run(`2026-10-08 ${String(23 - index).padStart(2, '0')}:00:00`, stale, session.id);
      return session.id;
    });
  }

  it('retains the newest ten independently for each project and cascades stale messages', () => {
    const a = project('/a');
    const b = project('/b');
    store.addMessage(a[10], 'user', 'old message');
    store.getDb().prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?')
      .run('2026-10-08 13:00:00', a[10]);
    assert.equal(store.cleanupStaleSessions(now), 4);
    assert.equal(store.getAllSessions().length, 20);
    assert.ok(a.slice(0, 10).every(id => store.getSession(id)));
    assert.ok(b.slice(0, 10).every(id => store.getSession(id)));
    assert.equal(store.getMessages(a[10]).messages.length, 0);
  });

  it('keeps the exact seven-day boundary but deletes anything older', () => {
    const ids = project('/boundary');
    store.getDb().prepare('UPDATE chat_sessions SET last_opened_at = ? WHERE id = ?')
      .run('2026-10-02 12:00:00', ids[10]);
    assert.equal(store.cleanupStaleSessions(now), 1);
    assert.ok(store.getSession(ids[10]));
    assert.equal(store.getSession(ids[11]), undefined);
  });

  it('explicit opens renew retention without changing project ordering', () => {
    const ids = project('/opened');
    const previousUpdatedAt = store.getSession(ids[10])!.updated_at;
    assert.equal(store.markSessionOpened(ids[10], now), true);
    assert.equal(store.markSessionOpened('missing', now), false);
    assert.equal(store.getSession(ids[10])!.updated_at, previousUpdatedAt);
    assert.equal(store.cleanupStaleSessions(now), 1);
    assert.ok(store.getSession(ids[10]));
    // Background detail reads do not extend retention.
    store.getSession(ids[11]);
    assert.equal(store.getSession(ids[11]), undefined);
  });

  it('protects running, waiting, runtime locks, pending permissions, schedules and channels', () => {
    const ids = project('/protected', 19);
    const db = store.getDb();
    db.prepare('UPDATE chat_sessions SET runtime_status = ? WHERE id = ?').run('running', ids[10]);
    db.prepare('UPDATE chat_sessions SET runtime_status = ? WHERE id = ?').run('waiting_permission', ids[11]);
    db.prepare('INSERT INTO session_runtime_locks VALUES (?, ?, ?, ?, ?, ?)')
      .run(ids[12], 'lock', 'test', '2026-10-10 00:00:00', stale, stale);
    db.prepare("INSERT INTO permission_requests (id, session_id, tool_name, tool_input, expires_at, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .run('permission', ids[13], 'bash', '{}', '2026-10-10 00:00:00');
    const task = db.prepare(`INSERT INTO scheduled_tasks
      (id, name, prompt, schedule_type, schedule_value, next_run, session_id, session_binding)
      VALUES (?, 'task', 'prompt', 'once', '', ?, ?, ?)`);
    task.run('direct', '2026-10-10 00:00:00', ids[14], null);
    task.run('binding', '2026-10-10 00:00:00', null, JSON.stringify({ session_id: ids[15] }));
    db.prepare('INSERT INTO channel_bindings (id, channel_type, chat_id, codepilot_session_id) VALUES (?, ?, ?, ?)')
      .run('binding', 'telegram', 'chat', ids[16]);
    // An expired runtime lock should not retain a stale session indefinitely.
    db.prepare('INSERT INTO session_runtime_locks VALUES (?, ?, ?, ?, ?, ?)')
      .run(ids[17], 'expired', 'test', stale, stale, stale);
    assert.equal(store.cleanupStaleSessions(now), 2);
    assert.ok(ids.slice(10, 17).every(id => store.getSession(id)));
    assert.equal(store.getSession(ids[17]), undefined);
    assert.equal(store.getSession(ids[18]), undefined);
  });
});
