import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VENDOR_PRESETS, PresetSchema } from '../../lib/provider-catalog';

describe('Preset Schema Validation', () => {
  for (const preset of VENDOR_PRESETS) {
    describe(`preset: ${preset.key}`, () => {
      it('passes Zod schema validation', () => {
        const result = PresetSchema.safeParse(preset);
        if (!result.success) {
          assert.fail(`Schema validation failed for ${preset.key}: ${result.error.message}`);
        }
      });

      it('has at least one default model (or is volcengine/ollama/cc-switch)', () => {
        if (preset.key === 'volcengine' || preset.key === 'ollama' || preset.key === 'cc-switch') return;
        assert.ok(preset.defaultModels.length > 0, `Preset ${preset.key} expected at least one default model`);
      });

      it('authStyle and defaultEnvOverrides do not conflict', () => {
        if (preset.authStyle === 'auth_token') {
          assert.equal(
            preset.defaultEnvOverrides.ANTHROPIC_API_KEY,
            undefined,
            `auth_token preset ${preset.key} should not have ANTHROPIC_API_KEY in envOverrides`,
          );
        }
        if (preset.authStyle === 'api_key') {
          assert.equal(
            preset.defaultEnvOverrides.ANTHROPIC_AUTH_TOKEN,
            undefined,
            `api_key preset ${preset.key} should not have ANTHROPIC_AUTH_TOKEN in envOverrides`,
          );
        }
      });
    });
  }

  // ── Regression tests for the authStyle fixes ──

  it('OpenRouter uses auth_token', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'openrouter')!;
    assert.equal(p.authStyle, 'auth_token');
  });

  it('GLM CN uses auth_token', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'glm-cn')!;
    assert.equal(p.authStyle, 'auth_token');
  });

  it('GLM Global uses auth_token', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'glm-global')!;
    assert.equal(p.authStyle, 'auth_token');
  });

  it('Moonshot uses auth_token with ENABLE_TOOL_SEARCH disabled', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'moonshot')!;
    assert.equal(p.authStyle, 'auth_token');
    assert.equal(p.defaultEnvOverrides.ENABLE_TOOL_SEARCH, 'false');
  });

  it('Kimi uses api_key with ENABLE_TOOL_SEARCH disabled', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'kimi')!;
    assert.equal(p.authStyle, 'api_key');
    assert.equal(p.defaultEnvOverrides.ENABLE_TOOL_SEARCH, 'false');
  });

  it('Bailian uses auth_token', () => {
    const p = VENDOR_PRESETS.find(v => v.key === 'bailian')!;
    assert.equal(p.authStyle, 'auth_token');
  });
});

describe('PROVIDER_MANAGED_BY_HOST', () => {
  it('toClaudeCodeEnv always sets CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', async () => {
    const { toClaudeCodeEnv } = await import('../../lib/provider-resolver');
    const { VENDOR_PRESETS: presets } = await import('../../lib/provider-catalog');
    const anthropic = presets.find(p => p.key === 'anthropic-official')!;

    // With a provider
    const resolvedWithProvider = {
      provider: {
        id: 'test', name: 'Test', provider_type: 'anthropic', protocol: 'anthropic',
        base_url: 'https://api.anthropic.com', api_key: 'sk-test',
        is_active: 1, sort_order: 0, extra_env: '{}', headers_json: '{}',
        env_overrides_json: '', role_models_json: '{}', notes: '', options_json: '{}',
        created_at: '', updated_at: '',
      },
      protocol: 'anthropic' as const,
      authStyle: 'api_key' as const,
      model: 'sonnet',
      modelDisplayName: 'Sonnet 4.6',
      upstreamModel: 'sonnet',
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['project', 'local'],
    };
    const env = toClaudeCodeEnv({ PATH: '/usr/bin' }, resolvedWithProvider);
    assert.equal(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, '1');

    // Without a provider (env mode)
    const resolvedWithoutProvider = {
      provider: undefined,
      protocol: 'anthropic' as const,
      authStyle: 'api_key' as const,
      model: undefined,
      modelDisplayName: undefined,
      upstreamModel: undefined,
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: false,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    };
    const env2 = toClaudeCodeEnv({ PATH: '/usr/bin' }, resolvedWithoutProvider);
    assert.equal(env2.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, '1');
  });
});
