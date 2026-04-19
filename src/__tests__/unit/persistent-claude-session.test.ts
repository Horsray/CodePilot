import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import {
  buildPersistentClaudeSignature,
  canReusePersistentClaudeSession,
  closeAllPersistentClaudeSessions,
  getPersistentClaudeSessionCount,
} from '@/lib/persistent-claude-session';

describe('persistent-claude-session', () => {
  it('builds deterministic signatures for semantically equivalent options', () => {
    const base: Options = {
      cwd: '/tmp/project',
      model: 'sonnet',
      settingSources: [],
      allowedTools: ['Bash', 'Read'],
      mcpServers: {
        fetch: {
          type: 'stdio',
          command: 'uvx',
          args: ['mcp-server-fetch'],
          env: { SECRET_TOKEN: 'first-secret' },
        },
      },
      env: {
        ANTHROPIC_BASE_URL: 'https://api.example.test',
        ANTHROPIC_API_KEY: 'sk-test-one',
      },
    };
    const reordered: Options = {
      env: {
        ANTHROPIC_API_KEY: 'sk-test-two',
        ANTHROPIC_BASE_URL: 'https://api.example.test',
      },
      mcpServers: {
        fetch: {
          env: { SECRET_TOKEN: 'different-secret' },
          args: ['mcp-server-fetch'],
          command: 'uvx',
          type: 'stdio',
        },
      },
      allowedTools: ['Bash', 'Read'],
      settingSources: [],
      model: 'sonnet',
      cwd: '/tmp/project',
    };

    assert.equal(
      buildPersistentClaudeSignature({ providerKey: 'provider-a', options: base }),
      buildPersistentClaudeSignature({ providerKey: 'provider-a', options: reordered }),
    );
  });

  it('changes signatures when process-affecting options change', () => {
    const options: Options = {
      cwd: '/tmp/project-a',
      model: 'sonnet',
      settingSources: [],
      mcpServers: {
        fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      },
    };

    const cwdChanged: Options = { ...options, cwd: '/tmp/project-b' };
    const modelChanged: Options = { ...options, model: 'opus' };
    const mcpChanged: Options = {
      ...options,
      mcpServers: {
        github: { type: 'stdio', command: 'github-mcp-server', args: [] },
      },
    };

    const original = buildPersistentClaudeSignature({ providerKey: 'provider-a', options });
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: cwdChanged }));
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: modelChanged }));
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: mcpChanged }));
    assert.notEqual(
      original,
      buildPersistentClaudeSignature({ providerKey: 'provider-b', options }),
    );
  });

  it('does not include credential values in signatures', () => {
    const signature = buildPersistentClaudeSignature({
      providerKey: 'provider-a',
      options: {
        cwd: '/tmp/project',
        model: 'sonnet',
        settingSources: [],
        mcpServers: {
          fetch: {
            type: 'stdio',
            command: 'uvx',
            args: ['mcp-server-fetch'],
            env: { SECRET_TOKEN: 'mcp-secret-value' },
          },
        },
        env: {
          ANTHROPIC_API_KEY: 'anthropic-secret-value',
          ANTHROPIC_AUTH_TOKEN: 'auth-secret-value',
        },
      },
    });

    assert.equal(signature.includes('mcp-secret-value'), false);
    assert.equal(signature.includes('anthropic-secret-value'), false);
    assert.equal(signature.includes('auth-secret-value'), false);
    assert.match(signature, /auth_token/);
  });

  it('can clear the persistent session store without an active subprocess', () => {
    closeAllPersistentClaudeSessions();
    assert.equal(getPersistentClaudeSessionCount(), 0);
    assert.equal(canReusePersistentClaudeSession('missing-session', 'missing-signature'), false);
  });
});
