import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting, setSetting } from '../../lib/db';
import { resolveProvider, toClaudeCodeEnv } from '../../lib/provider-resolver';

describe('cc-switch gating', () => {
  it('does not let cc-switch override env-mode resolution when disabled', () => {
    const snapshot = {
      ccSwitchEnabled: getSetting('cc_switch_enabled'),
      anthropicAuthToken: getSetting('anthropic_auth_token'),
      anthropicBaseUrl: getSetting('anthropic_base_url'),
    };

    try {
      setSetting('cc_switch_enabled', '');
      setSetting('anthropic_auth_token', 'host-token');
      setSetting('anthropic_base_url', 'https://api.minimaxi.com/anthropic');

      const resolved = resolveProvider({ providerId: 'env' });
      const env = toClaudeCodeEnv({ PATH: '/usr/bin' }, resolved);

      assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'host-token');
      assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.minimaxi.com/anthropic');
      assert.equal(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, '1');
    } finally {
      setSetting('cc_switch_enabled', snapshot.ccSwitchEnabled || '');
      setSetting('anthropic_auth_token', snapshot.anthropicAuthToken || '');
      setSetting('anthropic_base_url', snapshot.anthropicBaseUrl || '');
    }
  });
});
