/**
 * 中文注释：功能名称「claude-home-shadow 单元测试」。
 * 用法：验证 DB Provider 请求使用影子 HOME 时，会剥离认证 env，但保留用户级技能、插件和 MCP 配置。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-shadow-test-home-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
});

function writeRealClaudeDir(layout: {
  settings?: Record<string, unknown>;
  rootClaudeJson?: Record<string, unknown>;
  files?: Record<string, string>;
  dirs?: Record<string, Record<string, string>>;
}) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  if (layout.settings !== undefined) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(layout.settings, null, 2));
  }
  if (layout.rootClaudeJson !== undefined) {
    fs.writeFileSync(path.join(tempHome, '.claude.json'), JSON.stringify(layout.rootClaudeJson, null, 2));
  }
  for (const [name, content] of Object.entries(layout.files || {})) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  for (const [dirName, contents] of Object.entries(layout.dirs || {})) {
    const subdir = path.join(dir, dirName);
    fs.mkdirSync(subdir, { recursive: true });
    for (const [filePath, body] of Object.entries(contents)) {
      const target = path.join(subdir, filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
  }
}

async function loadModule() {
  return await import('../../lib/claude-home-shadow');
}

describe('createShadowClaudeHome', () => {
  it('env 组请求保持真实 HOME，不创建影子目录', async () => {
    writeRealClaudeDir({
      settings: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch',
          ANTHROPIC_BASE_URL: 'https://relay.example.com',
        },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: false });
    try {
      assert.equal(shadow.isShadow, false);
      assert.equal(shadow.home, tempHome);
    } finally {
      shadow.cleanup();
    }
  });

  it('DB Provider 请求会创建影子 HOME，并剥离 ANTHROPIC_* env', async () => {
    writeRealClaudeDir({
      settings: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch-leak',
          ANTHROPIC_BASE_URL: 'https://relay.example.com',
          ANTHROPIC_MODEL: 'claude-sonnet-4-5',
          DEBUG: '1',
          MY_CUSTOM_VAR: 'preserved',
        },
        mcpServers: {
          'user-mcp-foo': { command: 'foo', args: ['--bar'] },
        },
        enabledPlugins: { 'plugin-x': true },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] },
        permissions: { allow: ['Read(*)'], deny: [] },
        apiKeyHelper: '/usr/local/bin/my-key-helper',
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);
      assert.notEqual(shadow.home, tempHome);

      const shadowSettingsPath = path.join(shadow.home, '.claude', 'settings.json');
      assert.ok(fs.existsSync(shadowSettingsPath));
      const shadowSettings = JSON.parse(fs.readFileSync(shadowSettingsPath, 'utf-8')) as {
        env?: Record<string, string>;
        mcpServers?: Record<string, unknown>;
        enabledPlugins?: Record<string, unknown>;
        hooks?: unknown;
        permissions?: unknown;
        apiKeyHelper?: string;
      };

      assert.equal(shadowSettings.env?.ANTHROPIC_AUTH_TOKEN, undefined);
      assert.equal(shadowSettings.env?.ANTHROPIC_BASE_URL, undefined);
      assert.equal(shadowSettings.env?.ANTHROPIC_MODEL, undefined);
      assert.equal(shadowSettings.env?.DEBUG, '1');
      assert.equal(shadowSettings.env?.MY_CUSTOM_VAR, 'preserved');
      assert.deepEqual(shadowSettings.mcpServers, {
        'user-mcp-foo': { command: 'foo', args: ['--bar'] },
      });
      assert.deepEqual(shadowSettings.enabledPlugins, { 'plugin-x': true });
      assert.ok(shadowSettings.hooks);
      assert.ok(shadowSettings.permissions);
      assert.equal(shadowSettings.apiKeyHelper, '/usr/local/bin/my-key-helper');
    } finally {
      shadow.cleanup();
    }
  });

  it('影子 HOME 仍能访问用户级 skills、agents、commands 和 plugins', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
      dirs: {
        skills: { 'verifier-x/SKILL.md': '# Verifier X skill' },
        agents: { 'planner.md': '# Planner agent' },
        commands: { 'do-thing.md': '# /do-thing command' },
        plugins: { 'foo/manifest.json': '{}' },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);

      const shadowClaude = path.join(shadow.home, '.claude');
      assert.ok(fs.existsSync(path.join(shadowClaude, 'skills', 'verifier-x', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(shadowClaude, 'agents', 'planner.md')));
      assert.ok(fs.existsSync(path.join(shadowClaude, 'commands', 'do-thing.md')));
      assert.ok(fs.existsSync(path.join(shadowClaude, 'plugins', 'foo', 'manifest.json')));
      assert.equal(
        fs.readFileSync(path.join(shadowClaude, 'skills', 'verifier-x', 'SKILL.md'), 'utf-8'),
        '# Verifier X skill',
      );
    } finally {
      shadow.cleanup();
    }
  });

  it('settings.json 没有认证字段时直接透传真实 HOME', async () => {
    writeRealClaudeDir({
      settings: {
        env: { DEBUG: '1' },
        mcpServers: { foo: { command: 'foo' } },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, false);
      assert.equal(shadow.home, tempHome);
    } finally {
      shadow.cleanup();
    }
  });

  it('settings.json 缺失时直接透传真实 HOME', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, false);
      assert.equal(shadow.home, tempHome);
    } finally {
      shadow.cleanup();
    }
  });

  it('cleanup 会删除影子目录，重复调用也安全', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    const shadowDir = shadow.home;
    assert.equal(shadow.isShadow, true);
    assert.ok(fs.existsSync(shadowDir));
    shadow.cleanup();
    assert.ok(!fs.existsSync(shadowDir));
    shadow.cleanup();
  });
});
