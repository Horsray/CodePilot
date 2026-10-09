import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-search-history-tool-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { createSearchHistoryTool } = require('../../lib/tools/search-history') as typeof import('../../lib/tools/search-history');
const { createSession, addMessage, closeDb } = require('../../lib/db') as typeof import('../../lib/db');

describe('SearchHistory tool', () => {
  afterEach(() => {
    closeDb();
  });

  it('returns formatted matches across sessions', async () => {
    const s1 = createSession('Alpha', 'sonnet');
    const s2 = createSession('Beta', 'sonnet');

    addMessage(s1.id, 'user', 'Please revisit provider fallback behavior.');
    addMessage(s2.id, 'assistant', 'We already changed fallback behavior for compact routing.');

    const tool = createSearchHistoryTool({ workingDirectory: process.cwd() } as any) as any;
    const output = await tool.execute({ query: 'fallback', limit: 10 });

    assert.match(output, /1\. Beta/);
    assert.match(output, /2\. Alpha/);
    assert.match(output, /snippet:/);
  });

  it('supports restricting results to a specific session', async () => {
    const s1 = createSession('Only Session', 'sonnet');
    const s2 = createSession('Other Session', 'sonnet');

    addMessage(s1.id, 'assistant', 'Search this collaboration note.');
    addMessage(s2.id, 'assistant', 'Another collaboration note elsewhere.');

    const tool = createSearchHistoryTool({ workingDirectory: process.cwd() } as any) as any;
    const output = await tool.execute({ query: 'collaboration', session_id: s1.id, limit: 10 });

    assert.match(output, /Only Session/);
    assert.doesNotMatch(output, /Other Session/);
  });

  it('returns a clear message when nothing matches', async () => {
    const tool = createSearchHistoryTool({ workingDirectory: process.cwd() } as any) as any;
    const output = await tool.execute({ query: 'non-existent-keyword', limit: 10 });

    assert.equal(output, 'No local chat history matched "non-existent-keyword".');
  });
});

