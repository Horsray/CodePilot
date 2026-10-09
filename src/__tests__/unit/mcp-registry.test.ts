import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempHome = '';
let tempProject = '';
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-mcp-reg-home-'));
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-mcp-reg-proj-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  fs.rmSync(tempHome, { recursive: true, force: true });
  fs.rmSync(tempProject, { recursive: true, force: true });
});

describe('mcp-registry', () => {
  it('migrates legacy settings MCP servers into ~/.claude.json and exposes them as global', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          github: { command: 'github-mcp', args: ['serve'] },
        },
      }, null, 2),
      'utf-8',
    );

    const { migrateLegacyGlobalMcpServers, readEffectiveExternalMcpServers, getClaudeUserConfigPath } = await import('@/lib/mcp-registry');
    const migration = migrateLegacyGlobalMcpServers();
    assert.ok(migration.migratedNames.includes('github'));

    const userConfig = JSON.parse(fs.readFileSync(getClaudeUserConfigPath(), 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
      codepilot_mcp_migrated_from?: Record<string, string[]>;
    };
    assert.ok(userConfig.mcpServers?.github);
    assert.deepEqual(userConfig.codepilot_mcp_migrated_from?.github, ['settings.json']);

    const registry = readEffectiveExternalMcpServers(tempProject);
    assert.equal(registry.github.source, 'claude.json');
    assert.equal(registry.github.scope, 'global');
    assert.deepEqual(registry.github.config.args, ['serve']);
  });

  it('reads project .mcp.json only for the active external project', async () => {
    fs.writeFileSync(
      path.join(tempProject, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          browser: { command: 'browser-mcp' },
        },
      }, null, 2),
      'utf-8',
    );

    const { readEffectiveExternalMcpServers } = await import('@/lib/mcp-registry');
    const registry = readEffectiveExternalMcpServers(tempProject);
    assert.equal(registry.browser.source, 'project-file');
    assert.equal(registry.browser.scope, 'project');
  });
});
