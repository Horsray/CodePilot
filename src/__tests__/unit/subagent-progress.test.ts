import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('subagent progress tracker', () => {
  it('emits SLA warning and timeout when idle', async () => {
    const { createSubAgentProgressTracker } = await import('../../lib/subagent-progress');
    const events: string[] = [];
    const tracker = createSubAgentProgressTracker({
      id: 'sub-1',
      initialStage: '等待模型响应',
      heartbeatMs: 10,
      sla: { softMs: 15, hardMs: 35 },
      emitSSE: (event) => {
        const parsed = JSON.parse(event.data) as { detail: string };
        events.push(parsed.detail);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 45));
    tracker.close();

    assert.equal(events[0].trim(), '等待模型响应');
    assert.ok(events.some((detail) => detail.includes('SLA 预警')), 'should emit soft SLA warning');
    assert.ok(events.some((detail) => detail.includes('SLA 超时')), 'should emit hard SLA timeout');
  });
});
