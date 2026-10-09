import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectRecentMessagesToKeep } from '../../lib/context-compressor';
import { repairOrphanUserMessages } from '../../lib/message-normalizer';

describe('selectRecentMessagesToKeep', () => {
  const msg = (role: 'user' | 'assistant', cost: number) => ({ role, cost });

  it('keeps recent messages within budget, oldest-first order', () => {
    const history = [
      msg('user', 100),
      msg('assistant', 100),
      msg('user', 40),
      msg('assistant', 40),
    ];
    const kept = selectRecentMessagesToKeep({
      history,
      tokensOf: (m) => m.cost,
      budget: 100,
    });
    assert.deepEqual(kept, history.slice(2));
  });

  it('falls back to the most recent turn when nothing fits the budget', () => {
    // 退化场景：最近一条消息本身就超过预算 —— 不能把 keep 集留空，
    // 否则「最近一轮」会被整段吞进摘要（用户可感知的上下文丢失）。
    const history = [
      msg('user', 10),
      msg('assistant', 10),
      msg('user', 900),
      msg('assistant', 1200),
    ];
    const kept = selectRecentMessagesToKeep({
      history,
      tokensOf: (m) => m.cost,
      budget: 100,
    });
    assert.equal(kept.length, 2);
    assert.deepEqual(kept, history.slice(-2));
  });

  it('respects a custom floorMessages', () => {
    const history = [msg('user', 999), msg('assistant', 999), msg('user', 999)];
    const kept = selectRecentMessagesToKeep({
      history,
      tokensOf: (m) => m.cost,
      budget: 1,
      floorMessages: 1,
    });
    assert.deepEqual(kept, [history[2]]);
  });

  it('returns empty for empty history', () => {
    const kept = selectRecentMessagesToKeep({
      history: [] as Array<{ role: string; cost: number }>,
      tokensOf: (m) => m.cost,
      budget: 100,
    });
    assert.deepEqual(kept, []);
  });

  it('keeps everything when budget is generous', () => {
    const history = [msg('user', 10), msg('assistant', 10)];
    const kept = selectRecentMessagesToKeep({
      history,
      tokensOf: (m) => m.cost,
      budget: 10000,
    });
    assert.deepEqual(kept, history);
  });
});

describe('repairOrphanUserMessages', () => {
  it('passes through alternating history unchanged (same reference)', () => {
    const history = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ];
    const out = repairOrphanUserMessages(history);
    assert.equal(out, history);
  });

  it('inserts an interruption placeholder between consecutive user messages', () => {
    const history = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2-orphan' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
    ];
    const out = repairOrphanUserMessages(history);
    assert.equal(out.length, 6);
    assert.equal(out[3].role, 'assistant');
    assert.match(out[3].content, /中断/);
    // 原始消息保持顺序不变
    assert.deepEqual(out.filter((m) => m.role === 'user').map((m) => m.content), ['u1', 'u2-orphan', 'u3']);
  });

  it('handles multiple orphan runs', () => {
    const history = [
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
      { role: 'user', content: 'u3' },
    ];
    const out = repairOrphanUserMessages(history);
    assert.equal(out.length, 5);
    assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('returns empty history', () => {
    assert.deepEqual(repairOrphanUserMessages([]), []);
  });
});
