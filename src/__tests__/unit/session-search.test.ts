import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-session-search-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  closeDb,
  searchMessages,
} = require('../../lib/db') as typeof import('../../lib/db');

describe('searchMessages', () => {
  afterEach(() => {
    closeDb();
  });

  it('finds matching messages across sessions ordered by newest first', () => {
    const s1 = createSession('Alpha Session', 'sonnet');
    const s2 = createSession('Beta Session', 'sonnet');

    addMessage(s1.id, 'user', 'Please investigate provider fallback logic');
    addMessage(s2.id, 'assistant', 'The provider fallback logic now prefers the compact helper model.');

    const results = searchMessages('fallback', { limit: 10 });

    assert.equal(results.length, 2);
    assert.equal(results[0].sessionTitle, 'Beta Session');
    assert.equal(results[1].sessionTitle, 'Alpha Session');
  });

  it('supports filtering by sessionId', () => {
    const s1 = createSession('Only This Session', 'sonnet');
    const s2 = createSession('Other Session', 'sonnet');

    addMessage(s1.id, 'assistant', 'Searchable note about collaboration strategy.');
    addMessage(s2.id, 'assistant', 'Another collaboration strategy note elsewhere.');

    const results = searchMessages('collaboration', { sessionId: s1.id, limit: 10 });

    assert.equal(results.length, 1);
    assert.equal(results[0].sessionId, s1.id);
    assert.equal(results[0].sessionTitle, 'Only This Session');
  });

  it('returns a contextual snippet around the first match', () => {
    const session = createSession('Snippet Session', 'sonnet');
    const content = '0123456789 '.repeat(12) + 'keyword-hit' + ' abcdefghij'.repeat(12);
    addMessage(session.id, 'assistant', content);

    const [result] = searchMessages('keyword-hit', { limit: 1 });

    assert.ok(result.snippet.includes('keyword-hit'));
    assert.ok(result.snippet.length <= 220);
  });
});

