import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-collab-probe-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { createProvider, deleteProvider, setSetting, closeDb } = require('../../lib/db') as typeof import('../../lib/db');
const { resolveCollaborationProbePlan } = require('../../lib/collaboration-probe') as typeof import('../../lib/collaboration-probe');

describe('resolveCollaborationProbePlan', () => {
  const createdProviderIds: string[] = [];

  before(() => {
    const lead = createProvider({
      name: 'Leader Provider',
      provider_type: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: 'leader-key',
      role_models_json: JSON.stringify({ default: 'leader-default' }),
    });
    createdProviderIds.push(lead.id);

    setSetting('collaboration_strategy_json', JSON.stringify({
      defaultProfileId: 'custom',
      profiles: [
        {
          id: 'custom',
          name: '自定义配置',
          roles: {
            'team-leader': { providerId: lead.id, model: 'leader-model' },
            'worker-executor': { providerId: lead.id, model: 'exec-model' },
            'quality-inspector': { providerId: lead.id, model: 'verify-model' },
            'expert-consultant': {},
          },
        },
      ],
    }));
  });

  after(() => {
    for (const id of createdProviderIds) deleteProvider(id);
    closeDb();
  });

  it('marks missing role bindings as unconfigured and preserves configured rows', () => {
    const result = resolveCollaborationProbePlan({
      profileId: 'custom',
      fallbackProviderId: createdProviderIds[0],
    });

    const leader = result.rows.find((row) => row.roleKey === 'team-leader');
    const executor = result.rows.find((row) => row.roleKey === 'worker-executor');
    const expert = result.rows.find((row) => row.roleKey === 'expert-consultant');

    assert.equal(result.profileName, '自定义配置');
    assert.equal(leader?.status, 'ready');
    assert.equal(executor?.status, 'ready');
    assert.equal(expert?.status, 'unconfigured');
    assert.equal(leader?.providerName, 'Leader Provider');
    assert.equal(leader?.apiModel, 'leader-model');
  });
});
