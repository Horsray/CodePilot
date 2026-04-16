/**
 * 中文注释：功能名称「sdk-subprocess-env 单元测试」。
 * 用法：验证所有 SDK 子进程入口统一走环境构建器，确保 Provider 鉴权归属和影子 HOME 逻辑一致。
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
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-sdkenv-test-'));
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

function writeUserSettingsAuth(creds: Record<string, string>) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: creds }));
}

describe('prepareSdkSubprocessEnv', () => {
  it('env 模式保持真实 HOME，让 cc-switch 设置继续生效', async () => {
    writeUserSettingsAuth({ ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch' });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: undefined,
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: undefined,
      modelDisplayName: undefined,
      upstreamModel: undefined,
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });
    try {
      assert.equal(setup.shadow.isShadow, false);
      assert.equal(setup.env.HOME, tempHome);
      assert.equal(setup.env.USERPROFILE, tempHome);
    } finally {
      setup.shadow.cleanup();
    }
  });

  it('显式 DB Provider 会创建影子 HOME，并注入 Provider 认证', async () => {
    writeUserSettingsAuth({
      ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch-leak',
      ANTHROPIC_BASE_URL: 'https://leak.example.com',
    });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: {
        id: 'kimi',
        name: 'Kimi',
        provider_type: 'anthropic',
        protocol: 'anthropic',
        base_url: 'https://kimi.example.com',
        api_key: 'sk-real-kimi',
        is_active: 1,
        sort_order: 0,
        extra_env: '{}',
        headers_json: '{}',
        env_overrides_json: '',
        role_models_json: '{}',
        notes: '',
        options_json: '{}',
        created_at: '',
        updated_at: '',
      },
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: 'sonnet',
      modelDisplayName: undefined,
      upstreamModel: 'sonnet',
      headers: {},
      envOverrides: {},
      roleModels: { default: 'sonnet' },
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });
    try {
      assert.equal(setup.shadow.isShadow, true);
      assert.notEqual(setup.env.HOME, tempHome);
      assert.equal(setup.env.HOME, setup.shadow.home);
      assert.equal(setup.env.USERPROFILE, setup.shadow.home);
      assert.equal(setup.env.ANTHROPIC_API_KEY, 'sk-real-kimi');
      assert.equal(setup.env.ANTHROPIC_BASE_URL, 'https://kimi.example.com');
      assert.equal(setup.env.CLAUDECODE, undefined);
      assert.ok(setup.env.PATH && setup.env.PATH.length > 0);
    } finally {
      setup.shadow.cleanup();
    }
  });

  it('cleanup 重复调用保持幂等', async () => {
    writeUserSettingsAuth({ ANTHROPIC_AUTH_TOKEN: 'sk-leak' });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: {
        id: 'p1',
        name: 'P',
        provider_type: 'anthropic',
        protocol: 'anthropic',
        base_url: 'https://p.example.com',
        api_key: 'sk-p',
        is_active: 1,
        sort_order: 0,
        extra_env: '{}',
        headers_json: '{}',
        env_overrides_json: '',
        role_models_json: '{}',
        notes: '',
        options_json: '{}',
        created_at: '',
        updated_at: '',
      },
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: 'sonnet',
      modelDisplayName: undefined,
      upstreamModel: 'sonnet',
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });

    const dir = setup.shadow.home;
    assert.ok(fs.existsSync(dir));
    setup.shadow.cleanup();
    assert.ok(!fs.existsSync(dir));
    setup.shadow.cleanup();
  });
});
