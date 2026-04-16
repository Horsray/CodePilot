/**
 * 中文注释：功能名称「project mcp injection 单元测试」。
 * 用法：验证按项目目录读取 `.mcp.json` 时，能够正确过滤 disabled、应用 UI override，并解析 `${...}` 占位符。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempDataDir: string;
let tempHome: string;
let tempProjectCwd: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-projmcp-db-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-projmcp-home-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  tempProjectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-projmcp-cwd-'));
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  else delete process.env.CLAUDE_GUI_DATA_DIR;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempProjectCwd, { recursive: true, force: true }); } catch {}
});

function writeProjectMcpJson(content: object) {
  fs.writeFileSync(path.join(tempProjectCwd, '.mcp.json'), JSON.stringify(content, null, 2));
}

function writeUserSettings(content: object) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(content, null, 2));
}

describe('loadProjectMcpServers', () => {
  it('returns project MCP servers from the given cwd', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'team-docs-mcp': { command: 'docs-mcp-server', args: ['--port', '4000'] },
        'team-issues-mcp': { command: '/usr/local/bin/issues-mcp' },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);

    assert.ok(servers);
    assert.equal(Object.keys(servers).length, 2);
    assert.deepEqual(servers['team-docs-mcp'], { command: 'docs-mcp-server', args: ['--port', '4000'] });
    assert.deepEqual(servers['team-issues-mcp'], { command: '/usr/local/bin/issues-mcp' });
  });

  it('returns undefined when cwd has no .mcp.json', async () => {
    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(tempProjectCwd), undefined);
  });

  it('returns undefined for empty or missing cwd', async () => {
    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(undefined), undefined);
    assert.equal(loadProjectMcpServers(''), undefined);
  });

  it('skips disabled servers', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'enabled-server': { command: 'good-mcp' },
        'disabled-server': { command: 'old-mcp', enabled: false },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);

    assert.ok(servers);
    assert.ok('enabled-server' in servers);
    assert.ok(!('disabled-server' in servers));
  });

  it('resolves ${...} env placeholders against CodePilot DB settings', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'team-mcp-with-token': {
          command: 'team-mcp',
          env: {
            FIXED_VAR: 'literal-value',
            TEAM_API_TOKEN: '${team_api_token}',
          },
        },
      },
    });

    const { setSetting } = await import('@/lib/db');
    setSetting('team_api_token', 'sk-team-secret');

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);

    assert.ok(servers);
    assert.equal(servers['team-mcp-with-token'].env?.FIXED_VAR, 'literal-value');
    assert.equal(servers['team-mcp-with-token'].env?.TEAM_API_TOKEN, 'sk-team-secret');
  });

  it('resolves missing placeholder to empty string', async () => {
    writeProjectMcpJson({
      mcpServers: {
        srv: { command: 'foo', env: { MISSING: '${not_in_db_at_all}' } },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);
    assert.equal(servers?.srv.env?.MISSING, '');
  });

  it('returns undefined for malformed .mcp.json', async () => {
    fs.writeFileSync(path.join(tempProjectCwd, '.mcp.json'), '{not valid json{{{');
    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(tempProjectCwd), undefined);
  });

  it('returns undefined when .mcp.json has no mcpServers field', async () => {
    writeProjectMcpJson({ someOtherField: 'value' });
    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(tempProjectCwd), undefined);
  });

  it('returns undefined when mcpServers is empty object', async () => {
    writeProjectMcpJson({ mcpServers: {} });
    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(tempProjectCwd), undefined);
  });
});

describe('loadProjectMcpServers with mcpServerOverrides', () => {
  it('UI override enabled=false disables a project server', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'team-mcp': { command: 'team-mcp' },
      },
    });
    writeUserSettings({
      mcpServerOverrides: {
        'team-mcp': { enabled: false },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    assert.equal(loadProjectMcpServers(tempProjectCwd), undefined);
  });

  it('UI override enabled=true re-enables a project server', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'team-mcp': { command: 'team-mcp', enabled: false },
      },
    });
    writeUserSettings({
      mcpServerOverrides: {
        'team-mcp': { enabled: true },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);
    assert.ok(servers);
    assert.ok(servers['team-mcp']);
  });

  it('mixed overrides only affect named servers', async () => {
    writeProjectMcpJson({
      mcpServers: {
        'a-mcp': { command: 'a' },
        'b-mcp': { command: 'b' },
        'c-mcp': { command: 'c' },
      },
    });
    writeUserSettings({
      mcpServerOverrides: {
        'b-mcp': { enabled: false },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);
    assert.ok(servers);
    assert.ok('a-mcp' in servers);
    assert.ok(!('b-mcp' in servers));
    assert.ok('c-mcp' in servers);
  });

  it('no settings.json means file defaults apply', async () => {
    writeProjectMcpJson({
      mcpServers: {
        foo: { command: 'foo' },
      },
    });

    const { loadProjectMcpServers } = await import('../../lib/mcp-loader');
    const servers = loadProjectMcpServers(tempProjectCwd);
    assert.ok(servers);
    assert.ok('foo' in servers);
  });
});
