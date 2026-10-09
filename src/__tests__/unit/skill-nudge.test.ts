import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideNudge,
  buildSkillNudgePayload,
  buildSkillNudgeStatusEvent,
  buildLearningExtractionPrompt,
  buildCrystallizationPrompt,
  type AgentRunStats,
} from '../../lib/skill-nudge';

// Helper to create minimal stats
function stats(overrides: Partial<AgentRunStats> = {}): AgentRunStats {
  return {
    step: 5,
    distinctTools: new Set(['Read', 'Write', 'Bash']),
    hasErrors: false,
    toolNames: ['Read', 'Write', 'Bash'],
    ...overrides,
  };
}

describe('decideNudge', () => {
  it('returns no-op for search-only sessions without errors', () => {
    const decision = decideNudge(stats({
      step: 10,
      distinctTools: new Set(['Read', 'Grep']),
      toolNames: ['Read', 'Grep'],
    }));
    assert.equal(decision.recordLearning, false);
    assert.ok(decision.reason.includes('Search-only'));
  });

  it('returns no-op for trivial sessions', () => {
    const decision = decideNudge(stats({
      step: 1,
      distinctTools: new Set(['Edit']),
      toolNames: ['Edit'],
    }));
    assert.equal(decision.recordLearning, false);
    assert.ok(decision.reason.includes('trivial'));
  });

  it('triggers learning for complex workflows with diverse tools', () => {
    const decision = decideNudge(stats({
      step: 5,
      distinctTools: new Set(['Read', 'Write', 'Bash', 'Edit']),
      toolNames: ['Read', 'Write', 'Bash', 'Edit'],
    }));
    assert.equal(decision.recordLearning, true);
    assert.equal(decision.evaluatePatterns, true);
  });

  it('triggers learning when errors occurred', () => {
    const decision = decideNudge(stats({
      step: 3,
      distinctTools: new Set(['Bash']),
      hasErrors: true,
      toolNames: ['Bash'],
    }));
    assert.equal(decision.recordLearning, true);
    assert.ok(decision.reason.includes('failure'));
  });

  it('triggers learning when user corrected the AI', () => {
    const decision = decideNudge(stats({
      step: 4,
      distinctTools: new Set(['Read', 'Edit']),
      hadUserCorrection: true,
      toolNames: ['Read', 'Edit'],
    }));
    assert.equal(decision.recordLearning, true);
    assert.ok(decision.reason.includes('correction'));
  });

  it('does not trigger crystallize directly (only after pattern evaluation)', () => {
    const decision = decideNudge(stats({
      step: 20,
      distinctTools: new Set(['Read', 'Write', 'Bash', 'Edit', 'Grep']),
      toolNames: ['Read', 'Write', 'Bash', 'Edit', 'Grep'],
    }));
    assert.equal(decision.crystallizeSkill, false);
  });
});

describe('buildSkillNudgePayload', () => {
  it('returns a skill_nudge payload with message and reason', () => {
    const s = stats({ step: 10, distinctTools: new Set(['Read', 'Write', 'Grep', 'Bash']) });
    const payload = buildSkillNudgePayload(s, 'learning', 'test message');
    assert.equal(payload.type, 'skill_nudge');
    assert.ok(payload.message.length > 0);
    assert.equal(payload.reason.step, 10);
    assert.equal(payload.reason.distinctToolCount, 4);
    assert.equal(payload.reason.layer, 'learning');
  });

  it('tool names are sorted for deterministic telemetry', () => {
    const s = stats({ step: 8, distinctTools: new Set(['Write', 'Bash', 'Edit']) });
    const payload = buildSkillNudgePayload(s, 'learning', 'test');
    assert.deepEqual(payload.reason.toolNames, ['Bash', 'Edit', 'Write']);
  });

  it('includes layer info', () => {
    const s = stats();
    const payload = buildSkillNudgePayload(s, 'pattern', 'pattern detected');
    assert.equal(payload.reason.layer, 'pattern');
  });
});

describe('buildSkillNudgeStatusEvent', () => {
  const s = stats({ step: 10, distinctTools: new Set(['Read', 'Write', 'Grep']) });

  it('sets notification: true for web SSE parser branch', () => {
    const event = buildSkillNudgeStatusEvent(s);
    assert.equal(event.notification, true);
  });

  it('includes a human-readable message at top level', () => {
    const event = buildSkillNudgeStatusEvent(s);
    assert.ok(typeof event.message === 'string');
    assert.ok(event.message.length > 0);
  });

  it('includes subtype: skill_nudge for bridge and future UI handlers', () => {
    const event = buildSkillNudgeStatusEvent(s);
    assert.equal(event.subtype, 'skill_nudge');
  });

  it('embeds the full structured payload for telemetry/rich UIs', () => {
    const event = buildSkillNudgeStatusEvent(s, 'learning', 'custom message');
    assert.ok(event.payload);
    assert.equal(event.payload.type, 'skill_nudge');
    assert.equal(event.payload.reason.step, 10);
    assert.equal(event.payload.reason.distinctToolCount, 3);
  });

  it('top-level message matches payload.message', () => {
    const event = buildSkillNudgeStatusEvent(s);
    assert.equal(event.message, event.payload.message);
  });
});

describe('buildLearningExtractionPrompt', () => {
  it('includes tool summary and step count', () => {
    const s = stats({ step: 7, distinctTools: new Set(['Bash', 'Read']) });
    const prompt = buildLearningExtractionPrompt(s);
    assert.ok(prompt.includes('7'));
    assert.ok(prompt.includes('Bash'));
    assert.ok(prompt.includes('Read'));
  });

  it('includes error status', () => {
    const s = stats({ hasErrors: true });
    const prompt = buildLearningExtractionPrompt(s);
    assert.ok(prompt.includes('true'));
  });
});

describe('buildCrystallizationPrompt', () => {
  it('includes pattern info and evidence', () => {
    const prompt = buildCrystallizationPrompt(
      {
        patternKey: 'build.electron.rebuild',
        description: 'Electron native module rebuild',
        evidence: ['Rebuild better-sqlite3', 'Rebuild native modules'],
      },
      'recent conversation history'
    );
    assert.ok(prompt.includes('build.electron.rebuild'));
    assert.ok(prompt.includes('Electron native module rebuild'));
    assert.ok(prompt.includes('Rebuild better-sqlite3'));
  });
});
