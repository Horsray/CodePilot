import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillNudgePayload,
  buildSkillNudgeStatusEvent,
  shouldSuggestSkill,
} from '@/lib/skill-nudge';

describe('skill-nudge', () => {
  it('does not suggest for short workflows', () => {
    assert.equal(
      shouldSuggestSkill({ step: 4, distinctTools: new Set(['Read', 'Edit', 'Write']) }),
      false,
    );
  });

  it('does not suggest when distinct tool count is too low', () => {
    assert.equal(
      shouldSuggestSkill({ step: 10, distinctTools: new Set(['Read', 'Write']) }),
      false,
    );
  });

  it('suggests for long enough multi-tool workflows', () => {
    assert.equal(
      shouldSuggestSkill({ step: 10, distinctTools: new Set(['Read', 'Write', 'Edit']) }),
      true,
    );
  });

  it('builds payload with sorted tool names', () => {
    const payload = buildSkillNudgePayload({
      step: 9,
      distinctTools: new Set(['Write', 'Bash', 'Edit']),
    });

    assert.equal(payload.type, 'skill_nudge');
    assert.equal(payload.reason.step, 9);
    assert.equal(payload.reason.distinctToolCount, 3);
    assert.deepEqual(payload.reason.toolNames, ['Bash', 'Edit', 'Write']);
  });

  it('builds status event with subtype for UI handlers', () => {
    const event = buildSkillNudgeStatusEvent({
      step: 10,
      distinctTools: new Set(['Grep', 'Read', 'Write']),
    });

    assert.equal(event.notification, true);
    assert.equal(event.subtype, 'skill_nudge');
    assert.equal(event.payload.type, 'skill_nudge');
    assert.equal(event.payload.reason.distinctToolCount, 3);
    assert.deepEqual(event.payload.reason.toolNames, ['Grep', 'Read', 'Write']);
  });
});

