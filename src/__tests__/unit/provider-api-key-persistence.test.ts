import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, deleteProvider, getAllProviders, getProvider } from '../../lib/db';
import { PUT } from '../../app/api/providers/[id]/route';

function cleanupTestProviders() {
  const all = getAllProviders();
  for (const p of all) {
    if (p.name.startsWith('__test_')) {
      deleteProvider(p.id);
    }
  }
}

describe('Provider API key persistence (masked key update safety)', () => {
  let providerId = '';
  const originalKey = 'sk-test-1234567890';
  const masked = '***' + originalKey.slice(-8);

  beforeEach(() => {
    cleanupTestProviders();
    providerId = createProvider({
      name: '__test_masked_key_provider',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://api.test.com',
      api_key: originalKey,
      extra_env: '{}',
    }).id;
  });

  afterEach(() => {
    cleanupTestProviders();
  });

  it('PUT ignores exact masked sentinel (*** + last8) and keeps stored key', async () => {
    const res = await PUT(
      { json: async () => ({ api_key: masked }) } as never,
      { params: Promise.resolve({ id: providerId }) } as never,
    );
    assert.equal(res.status, 200);
    assert.equal(getProvider(providerId)?.api_key, originalKey);
  });

  it('PUT rejects masked-prefix appends (***xxxxxxxx...) to avoid silent failures', async () => {
    const res = await PUT(
      { json: async () => ({ api_key: masked + 'NEW' }) } as never,
      { params: Promise.resolve({ id: providerId }) } as never,
    );
    assert.equal(res.status, 400);
    assert.equal(getProvider(providerId)?.api_key, originalKey);
  });
});

