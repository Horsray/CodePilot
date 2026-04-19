import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getContextWindow } from '../../lib/model-context';

describe('getContextWindow', () => {
  it('returns known Claude model windows', () => {
    assert.equal(getContextWindow('sonnet'), 200000);
  });

  it('matches Qwen model IDs case-insensitively', () => {
    assert.equal(getContextWindow('qwen3.6-plus'), 1000000);
    assert.equal(getContextWindow('Qwen3-Coder-Plus'), 1000000);
  });

  it('returns null for unknown models', () => {
    assert.equal(getContextWindow('unknown-model'), null);
  });
});
