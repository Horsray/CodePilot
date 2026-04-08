import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTotalInputUsage, shouldBypassSessionResume } from '../../lib/context-estimator';

describe('context-estimator resume guard', () => {
  it('sums input, cache read, and cache creation tokens', () => {
    assert.equal(getTotalInputUsage({
      input_tokens: 18000,
      cache_read_input_tokens: 216800,
      cache_creation_input_tokens: 0,
    }), 234800);
  });

  it('bypasses resume when compression already happened', () => {
    assert.equal(shouldBypassSessionResume({
      compressionOccurred: true,
      contextWindow: 200000,
      lastTurnUsage: {
        input_tokens: 1000,
        cache_read_input_tokens: 1000,
      },
    }), true);
  });

  it('bypasses resume when last turn usage is near the context window', () => {
    assert.equal(shouldBypassSessionResume({
      compressionOccurred: false,
      contextWindow: 200000,
      lastTurnUsage: {
        input_tokens: 25000,
        cache_read_input_tokens: 150000,
      },
    }), true);
  });

  it('keeps resume enabled when last turn usage is comfortably below threshold', () => {
    assert.equal(shouldBypassSessionResume({
      compressionOccurred: false,
      contextWindow: 200000,
      lastTurnUsage: {
        input_tokens: 12000,
        cache_read_input_tokens: 20000,
      },
    }), false);
  });
});
