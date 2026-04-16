import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hasClaudeSettingsCredentials, readClaudeSettingsCredentials } from '../../lib/claude-settings';

afterEach(() => {
  mock.restoreAll();
});

describe('claude-settings credentials', () => {
  it('returns null when no config file exists', () => {
    mock.method(fs, 'existsSync', () => false);
    assert.equal(readClaudeSettingsCredentials(), null);
    assert.equal(hasClaudeSettingsCredentials(), false);
  });

  it('reads credentials from settings.json env block', () => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    mock.method(fs, 'existsSync', (filePath: fs.PathLike) => String(filePath) === settingsPath);
    mock.method(fs, 'readFileSync', () => JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'sk-test',
        ANTHROPIC_AUTH_TOKEN: 'tok-test',
        ANTHROPIC_BASE_URL: 'https://example.com',
      },
    }));

    const result = readClaudeSettingsCredentials();
    assert.deepEqual(result, {
      apiKey: 'sk-test',
      authToken: 'tok-test',
      baseUrl: 'https://example.com',
    });
    assert.equal(hasClaudeSettingsCredentials(), true);
  });

  it('falls back to legacy claude.json', () => {
    const claudeJsonPath = path.join(os.homedir(), '.claude', 'claude.json');
    mock.method(fs, 'existsSync', (filePath: fs.PathLike) => String(filePath) === claudeJsonPath);
    mock.method(fs, 'readFileSync', () => JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'legacy-token' },
    }));

    assert.deepEqual(readClaudeSettingsCredentials(), {
      authToken: 'legacy-token',
      apiKey: undefined,
      baseUrl: undefined,
    });
  });

  it('ignores malformed json', () => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    mock.method(fs, 'existsSync', (filePath: fs.PathLike) => String(filePath) === settingsPath);
    mock.method(fs, 'readFileSync', () => '{bad json');
    assert.equal(readClaudeSettingsCredentials(), null);
  });
});
