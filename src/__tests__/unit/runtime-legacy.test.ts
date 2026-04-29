/**
 * runtime/legacy coercion now only exists to absorb old persisted values.
 * The product path is fixed to Claude Code CLI, so every legacy value should
 * converge to `claude-code-sdk`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyRuntimeForDisplay, isConcreteRuntime } from '@/lib/runtime/legacy';

describe('resolveLegacyRuntimeForDisplay', () => {
  it('preserves explicit claude-code-sdk regardless of CLI state', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', false), 'claude-code-sdk');
  });

  it('treats stored native as deprecated and converges to Claude Code', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('native', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('native', false), 'claude-code-sdk');
  });

  it('migrates legacy auto to claude-code-sdk', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('auto', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('auto', false), 'claude-code-sdk');
  });

  it('treats null / undefined / empty as legacy and applies the same rule', () => {
    assert.equal(resolveLegacyRuntimeForDisplay(null, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(null, false), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(undefined, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('', false), 'claude-code-sdk');
  });

  it('treats unknown garbage values as legacy (defensive)', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', false), 'claude-code-sdk');
  });
});

describe('isConcreteRuntime', () => {
  it('accepts the historical concrete runtime ids', () => {
    assert.equal(isConcreteRuntime('claude-code-sdk'), true);
    assert.equal(isConcreteRuntime('native'), true);
  });

  it('rejects legacy auto and everything else', () => {
    assert.equal(isConcreteRuntime('auto'), false);
    assert.equal(isConcreteRuntime(null), false);
    assert.equal(isConcreteRuntime(undefined), false);
    assert.equal(isConcreteRuntime(''), false);
    assert.equal(isConcreteRuntime('Claude Code'), false);
  });
});
