import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import {
  adoptPersistentClaudeSessionBySignature,
  buildPersistentClaudeSignature,
  canReusePersistentClaudeSession,
  closeAllPersistentClaudeSessions,
  extractWarmupInitData,
  getPersistentClaudeSessionCount,
  isWarmupSkippableSystemMessage,
} from '@/lib/persistent-claude-session';

describe('persistent-claude-session', () => {
  beforeEach(() => {
    closeAllPersistentClaudeSessions();
  });

  it('builds deterministic signatures for semantically equivalent options', () => {
    const base: Options = {
      cwd: '/tmp/project',
      model: 'sonnet',
      settingSources: [],
      plugins: [
        { type: 'local', path: '/tmp/plugins/beta' },
        { type: 'local', path: '/tmp/plugins/alpha' },
      ],
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
      plugins: [
        { type: 'local', path: '/tmp/plugins/alpha' },
        { type: 'local', path: '/tmp/plugins/beta' },
      ],
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
    const pluginsChanged: Options = {
      ...options,
      plugins: [{ type: 'local', path: '/tmp/plugins/omc' }],
    };

    const original = buildPersistentClaudeSignature({ providerKey: 'provider-a', options });
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: cwdChanged }));
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: modelChanged }));
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: pluginsChanged }));
    assert.notEqual(
      original,
      buildPersistentClaudeSignature({ providerKey: 'provider-b', options }),
    );
  });

  it('keeps signatures stable across MCP set changes but changes for baked systemPrompt identity', () => {
    const options: Options = {
      cwd: '/tmp/project-a',
      model: 'sonnet',
      settingSources: [],
      mcpServers: {
        fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'base prompt',
      },
    };

    const mcpChanged: Options = {
      ...options,
      mcpServers: {
        github: { type: 'stdio', command: 'github-mcp-server', args: [] },
      },
    };
    // 中文注释：append 内容是 volatile 的（包含 Todo 状态、Dashboard、memory hint 等），
    // 不应纳入签名，否则持久化 session 每轮都会重建。
    const appendChanged: Options = {
      ...options,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'different prompt',
      },
    };
    const presetChanged: Options = {
      ...options,
      systemPrompt: 'custom prompt identity',
    };

    const original = buildPersistentClaudeSignature({ providerKey: 'provider-a', options });
    // Warmup intentionally loads a superset of MCP servers while chat may load a subset.
    // MCP object differences must not invalidate the warmed persistent session.
    assert.equal(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: mcpChanged }));
    // append changes should NOT change signature (volatile content)
    assert.equal(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: appendChanged }));
    // preset changes SHOULD change signature
    assert.notEqual(original, buildPersistentClaudeSignature({ providerKey: 'provider-a', options: presetChanged }));
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

  it('can adopt a warmed session by signature into the real session id', async () => {
    const options: Options = {
      cwd: '/tmp/project-a',
      model: 'sonnet',
      settingSources: [],
    };
    const signature = buildPersistentClaudeSignature({
      providerKey: 'provider-a',
      options,
    });

    const store = ((globalThis as Record<string, unknown>).__persistentClaudeSessions__
      ??= new Map()) as Map<string, Record<string, unknown>>;

    store.set('warmup:provider-a:sonnet:/tmp/project-a', {
      codepilotSessionId: 'warmup:provider-a:sonnet:/tmp/project-a',
      signature,
      warmedUp: true,
      initData: { model: 'sonnet', session_id: 'sdk-session-1' },
      input: { close() {} },
      query: { close() {} },
      releaseTurn: null,
      shadowHandle: undefined,
    });

    // 中文注释：功能名称「预热接力回归校验」，用法是先确认同签名的通用 warmup 会话存在，
    // 再验证 adopt 后真实 session id 能直接复用该会话，不会二次冷启动。
    assert.equal(adoptPersistentClaudeSessionBySignature(signature, 'real-session-id'), true);
    assert.equal(canReusePersistentClaudeSession('real-session-id', signature), true);
    assert.equal(canReusePersistentClaudeSession('warmup:provider-a:sonnet:/tmp/project-a', signature), false);
    assert.equal(getPersistentClaudeSessionCount(), 1);
  });

  it('extracts warmup init data from system/init messages', () => {
    const initData = extractWarmupInitData({
      type: 'system',
      subtype: 'init',
      model: 'sonnet',
      session_id: 'sdk-session-1',
      tools: ['Read'],
      slash_commands: ['/test'],
      skills: [{ name: 'demo' }],
      plugins: [{ name: 'plugin-a' }],
      mcp_servers: [{ name: 'fetch' }],
    } as never);

    assert.deepEqual(initData, {
      model: 'sonnet',
      session_id: 'sdk-session-1',
      tools: ['Read'],
      slash_commands: ['/test'],
      skills: [{ name: 'demo' }],
      agents: undefined,
      plugins: [{ name: 'plugin-a' }],
      mcp_servers: [{ name: 'fetch' }],
    });
  });

  it('skips non-init system messages during warmup', () => {
    assert.equal(
      isWarmupSkippableSystemMessage({
        type: 'system',
        subtype: 'hook_started',
      } as never),
      true,
    );
    assert.equal(
      isWarmupSkippableSystemMessage({
        type: 'system',
        subtype: 'init',
      } as never),
      false,
    );
    assert.equal(
      extractWarmupInitData({
        type: 'system',
        subtype: 'hook_started',
      } as never),
      null,
    );
  });
});
