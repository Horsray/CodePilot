import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { NextRequest } from 'next/server';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-collab-check-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { createProvider, deleteProvider, setSetting, closeDb } = require('../../lib/db') as typeof import('../../lib/db');
const { GET } = require('../../app/api/providers/collaboration-check/route') as typeof import('../../app/api/providers/collaboration-check/route');

describe('GET /api/providers/collaboration-check', () => {
  const createdProviderIds: string[] = [];

  before(() => {
    const lead = createProvider({
      name: 'Leader Provider',
      provider_type: 'anthropic',
      base_url: 'https://leader.example.com',
      api_key: 'leader-key',
      role_models_json: JSON.stringify({ default: 'leader-default' }),
    });
    const search = createProvider({
      name: 'Search Provider',
      provider_type: 'anthropic',
      base_url: 'https://search.example.com',
      api_key: 'search-key',
      role_models_json: JSON.stringify({ default: 'search-default' }),
    });
    createdProviderIds.push(lead.id, search.id);

    setSetting('collaboration_strategy_json', JSON.stringify({
      defaultProfileId: 'low-cost',
      profiles: [
        {
          id: 'low-cost',
          name: '低成本',
          roles: {
            'team-leader': { providerId: lead.id, model: 'leader-lite' },
            'knowledge-searcher': { providerId: search.id, model: 'search-lite' },
            'vision-understanding': {},
            'worker-executor': { providerId: lead.id, model: 'execute-lite' },
            'quality-inspector': { providerId: lead.id, model: 'verify-lite' },
            'expert-consultant': { providerId: lead.id, model: 'expert-lite' },
          },
        },
        {
          id: 'high-performance',
          name: '高性能',
          roles: {
            'team-leader': { providerId: lead.id, model: 'leader-pro' },
            'knowledge-searcher': { providerId: search.id, model: 'search-pro' },
            'vision-understanding': {},
            'worker-executor': { providerId: lead.id, model: 'execute-pro' },
            'quality-inspector': { providerId: lead.id, model: 'verify-pro' },
            'expert-consultant': { providerId: lead.id, model: 'expert-pro' },
          },
        },
      ],
    }));
    setSetting('global_default_model_provider', lead.id);
    setSetting('global_default_model', 'leader-default');
  });

  after(() => {
    for (const id of createdProviderIds) deleteProvider(id);
    closeDb();
  });

  it('returns different routed api models for different profiles', async () => {
    const lowReq = new NextRequest(`http://localhost/api/providers/collaboration-check?providerId=${createdProviderIds[0]}&profileId=low-cost`);
    const highReq = new NextRequest(`http://localhost/api/providers/collaboration-check?providerId=${createdProviderIds[0]}&profileId=high-performance`);

    const lowRes = await GET(lowReq);
    const highRes = await GET(highReq);
    const lowJson = await lowRes.json();
    const highJson = await highRes.json();

    const lowSearch = lowJson.matrix.multi.find((row: { role: string }) => row.role === '知识检索');
    const highSearch = highJson.matrix.multi.find((row: { role: string }) => row.role === '知识检索');
    const lowExpert = lowJson.matrix.multi.find((row: { role: string }) => row.role === '专家顾问');
    const highExpert = highJson.matrix.multi.find((row: { role: string }) => row.role === '专家顾问');

    assert.equal(lowSearch.profileName, '低成本');
    assert.equal(highSearch.profileName, '高性能');
    assert.equal(lowSearch.apiModel, 'search-lite');
    assert.equal(highSearch.apiModel, 'search-pro');
    assert.equal(lowExpert.apiModel, 'expert-lite');
    assert.equal(highExpert.apiModel, 'expert-pro');
  });
});

