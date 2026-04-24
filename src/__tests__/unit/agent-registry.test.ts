import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('agent registry', () => {
  it('normalizes common planner role aliases to registered agents', async () => {
    const { getAgent, normalizeAgentId } = await import('../../lib/agent-registry');

    assert.equal(normalizeAgentId('tester'), 'qa-tester');
    assert.equal(getAgent('tester')?.id, 'qa-tester');
    assert.equal(getAgent('reviewer')?.id, 'code-reviewer');
    assert.equal(getAgent('developer')?.id, 'executor');
  });
});
