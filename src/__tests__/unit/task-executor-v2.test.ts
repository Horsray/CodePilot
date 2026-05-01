/**
 * Unit tests for task-executor-v2 — context management.
 *
 * The executor's API-calling path is tested via smoke/integration tests.
 * This file tests the synchronous infrastructure (context store).
 *
 * Run with: npx tsx --test src/__tests__/unit/task-executor-v2.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('task-executor-v2 context store', () => {
  it('context count starts at 0 after reset', async () => {
    const { resetAllContexts, contextCount } = await import('../../lib/task-executor-v2');
    resetAllContexts();
    assert.equal(contextCount(), 0);
  });

  it('resetAllContexts is idempotent', async () => {
    const { resetAllContexts, contextCount } = await import('../../lib/task-executor-v2');
    resetAllContexts();
    resetAllContexts();
    resetAllContexts();
    assert.equal(contextCount(), 0);
  });
});

describe('task-executor-v2 API integration', () => {
  it('can execute a text-only task (requires default provider)', { timeout: 60000 }, async () => {
    const { resetAllContexts, executeTaskV2 } = await import('../../lib/task-executor-v2');
    resetAllContexts();

    const result = await executeTaskV2({
      task: {
        id: 'test-api-task',
        name: 'API Test',
        prompt: 'Respond with exactly: HELLO_WORLD and nothing else.',
        schedule_type: 'once',
        schedule_value: '',
        next_run: '2026-05-01 00:00:00',
        last_run: undefined,
        last_status: undefined,
        last_error: undefined,
        last_result: undefined,
        consecutive_errors: 0,
        status: 'active' as const,
        priority: 'normal' as const,
        notify_on_complete: 0,
        session_id: undefined,
        notification_channels: ['toast'],
        session_binding: undefined,
        tool_authorization: undefined,
        working_directory: undefined,
        permanent: 0,
        group_id: undefined,
        group_name: undefined,
        active_hours_start: undefined,
        active_hours_end: undefined,
        created_at: '2026-05-01 00:00:00',
        updated_at: '2026-05-01 00:00:00',
      },
      prompt: 'Respond with exactly: HELLO_WORLD',
      providerId: '',
      model: 'haiku',
      baseSystem: 'You are a helpful assistant. Be concise.',
      workingDirectory: '/tmp',
      hasTools: false,
      currentTime: '2026-05-01 12:00:00',
    });

    assert.equal(typeof result.success, 'boolean');
    assert.equal(typeof result.output, 'string');
    assert.equal(typeof result.cleanOutput, 'string');
    assert.equal(result.toolCallCount, 0);
    assert.ok(result.output.length > 0);
    assert.ok(result.cleanOutput.length > 0);
    assert.ok(result.output.includes('定时任务结果'), 'output should contain result header');

    // Cleanup
    resetAllContexts();
  });
});
