/**
 * Unit tests for context-assembler.
 *
 * Run with: npx tsx --test src/__tests__/unit/context-assembler.test.ts
 *
 * Tests verify:
 * 1. Desktop entry point includes widget prompt
 * 2. Bridge entry point does NOT include widget prompt
 * 3. Workspace prompt only injected for assistant project sessions
 * 4. generative_ui_enabled=false skips widget even on desktop
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSession } from '../../types';

// Isolate the DB before any module reads it. assembleContext pulls settings
// (generative_ui_enabled, assistant_workspace_path, ...) from the real DB at
// ~/.codepilot/codepilot.db otherwise, so assertions would depend on whatever
// the developer happens to have configured locally. Must run before importing
// lib/db, since it resolves its path at module load time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-context-assembler-db-'));
process.env.CLAUDE_GUI_DATA_DIR = dataDir;

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'test-session',
    title: 'Test',
    model: 'sonnet',
    working_directory: '/Users/test/project',
    system_prompt: 'You are a helpful assistant.',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    sdk_session_id: '',
    mode: 'code',
    provider_id: '',
    sdk_cwd: '',
    permission_profile: 'default',
    project_name: '',
    status: 'active',
    provider_name: '',
    runtime_status: 'idle',
    runtime_updated_at: '',
    runtime_error: '',
    ...overrides,
  };
}

describe('assembleContext', () => {

  it('desktop: includes session prompt and enables generativeUI', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.ok(result.systemPrompt?.includes('You are a helpful assistant.'));
    assert.equal(result.generativeUIEnabled, true);
    assert.equal(result.isAssistantProject, false);
  });

  it('bridge: does NOT enable generativeUI or widget MCP', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'bridge',
      userPrompt: 'hello',
    });

    assert.equal(result.generativeUIEnabled, false);
  });

  it('desktop with generative_ui_enabled=false: does not enable generativeUI', async () => {
    const { setSetting } = await import('../../lib/db');
    const { assembleContext } = await import('../../lib/context-assembler');
    setSetting('generative_ui_enabled', 'false');
    try {
      const result = await assembleContext({
        session: makeSession(),
        entryPoint: 'desktop',
        userPrompt: 'hello',
      });

      assert.equal(result.generativeUIEnabled, false);
      assert.ok(!result.systemPrompt?.includes('show-widget'));
    } finally {
      // '' is treated as "not disabled" by the assembler, restoring the default
      setSetting('generative_ui_enabled', '');
    }
  });

  it('includes systemPromptAppend when provided', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: 'hello',
      systemPromptAppend: 'EXTRA INSTRUCTIONS HERE',
    });

    assert.ok(result.systemPrompt?.includes('EXTRA INSTRUCTIONS HERE'));
    assert.ok(result.systemPrompt?.includes('You are a helpful assistant.'));
  });

  it('non-workspace session: isAssistantProject is false', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ working_directory: '/Users/test/project' }),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.equal(result.isAssistantProject, false);
    assert.equal(result.assistantProjectInstructions, '');
  });

  // Widget MCP keyword detection is now handled solely in claude-client.ts.
  // context-assembler no longer computes needsWidgetMcp.

  it('session with empty system_prompt: does not throw', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ system_prompt: '' }),
      entryPoint: 'bridge',
      userPrompt: 'hello',
    });

    // Should not throw — prompt may be undefined or contain only CLI context
    assert.ok(true);
  });

  it('prompt ordering: session prompt present in result', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ system_prompt: '<<SESSION>>' }),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.ok(result.systemPrompt?.includes('<<SESSION>>'));
  });

  it('does not duplicate the OMC priority prefix inside assembled prompt', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: '检查 OMC 行为',
      omcPluginEnabled: true,
    });

    assert.doesNotMatch(result.systemPrompt || '', /## IMPORTANT: Multi-Agent Orchestration Priority/);
  });

  it('injects a strong empty-todo reminder for complex-work bootstrap', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: '调查这个复杂回归并修改代码',
    });

    assert.match(result.systemPrompt || '', /current Todo list is empty/i);
    assert.match(result.systemPrompt || '', /create a TodoWrite list before starting work/i);
    assert.match(result.systemPrompt || '', /you may explore the codebase or dispatch research agents/i);
  });
});
