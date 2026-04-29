import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;
let tempProject: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-plugin-home-'));
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-plugin-project-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempProject, { recursive: true, force: true }); } catch {}
});

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writePlugin(marketplace: string, pluginName: string) {
  const pluginDir = path.join(tempHome, '.claude', 'plugins', 'marketplaces', marketplace, 'plugins', pluginName);
  writeJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name: pluginName,
    description: `${pluginName} description`,
  });
  return pluginDir;
}

function writeRootMarketplacePlugin(marketplace: string, pluginName: string) {
  const pluginDir = path.join(tempHome, '.claude', 'plugins', 'marketplaces', marketplace);
  writeJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name: pluginName,
    description: `${pluginName} description`,
  });
  return pluginDir;
}

describe('getEnabledPluginConfigs', () => {
  it('returns local sdk plugin configs for enabled plugins only', async () => {
    const enabledDir = writePlugin('local-market', 'plugin-enabled');
    writePlugin('local-market', 'plugin-disabled');

    writeJson(path.join(tempHome, '.claude', 'settings.json'), {
      enabledPlugins: {
        'plugin-enabled@local-market': true,
        'plugin-disabled@local-market': false,
      },
    });

    const { getEnabledPluginConfigs, invalidatePluginCache } = await import('../../lib/plugin-discovery');
    invalidatePluginCache();
    const configs = getEnabledPluginConfigs(tempProject);

    assert.deepEqual(configs, [
      { type: 'local', path: enabledDir },
    ]);
  });

  it('detects the enabled OMC plugin from marketplace paths', async () => {
    const omcDir = writePlugin('omc', 'oh-my-claudecode');
    writeJson(path.join(tempHome, '.claude', 'settings.json'), {
      enabledPlugins: {
        'oh-my-claudecode@omc': true,
      },
    });

    const { getEnabledPluginConfigs, hasEnabledOmcPlugin, invalidatePluginCache } = await import('../../lib/plugin-discovery');
    invalidatePluginCache();
    const configs = getEnabledPluginConfigs(tempProject);

    // 中文注释：功能名称「OMC 插件识别回归校验」，用法是确保 marketplace/omc
    // 路径下的 oh-my-claudecode 插件会被识别为 OMC，从而让聊天主链路和 warmup
    // 一致地切换到更接近终端版的原生 query 路径。
    assert.deepEqual(configs, [
      { type: 'local', path: omcDir },
    ]);
    assert.equal(hasEnabledOmcPlugin(configs), true);
  });

  it('supports marketplace root plugin layouts like the installed OMC plugin', async () => {
    const omcDir = writeRootMarketplacePlugin('omc', 'oh-my-claudecode');
    writeJson(path.join(tempHome, '.claude', 'settings.json'), {
      enabledPlugins: {
        'oh-my-claudecode@omc': true,
      },
    });

    const { getEnabledPluginConfigs, hasEnabledOmcPlugin, invalidatePluginCache } = await import('../../lib/plugin-discovery');
    invalidatePluginCache();
    const configs = getEnabledPluginConfigs(tempProject);

    assert.deepEqual(configs, [
      { type: 'local', path: omcDir },
    ]);
    assert.equal(hasEnabledOmcPlugin(configs), true);
  });
});
