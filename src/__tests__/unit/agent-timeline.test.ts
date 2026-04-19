import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTimelineReasoning,
  appendTimelineToolUse,
  createTimelineAccumulator,
  extractTimelineStepsFromBlocks,
  updateTimelineStatus,
} from '@/lib/agent-timeline';
import type { MessageContentBlock } from '@/types';

test('agent timeline keeps final answer out of activity steps', () => {
  const blocks = [
    { type: 'thinking', thinking: 'Need to inspect the file first.' },
    { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
    { type: 'tool_result', tool_use_id: 'tool-1', content: '1\tconst a = 1;' },
    { type: 'text', text: 'Final answer should render below the timeline.' },
  ] satisfies MessageContentBlock[];

  const steps = extractTimelineStepsFromBlocks(blocks);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].reasoning, 'Need to inspect the file first.');
  assert.equal(steps[0].toolCalls.length, 1);
  assert.equal(steps[0].toolCalls[0].name, 'Read');
  assert.deepEqual(steps[0].events?.map((event) => event.type), ['reasoning', 'tool']);
  assert.equal(steps.some((step) => step.output.includes('Final answer')), false);
});

test('agent timeline pairs delayed tool results with their original tool calls', () => {
  const blocks = [
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
    { type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: '/tmp/b.ts' } },
    { type: 'tool_result', tool_use_id: 'read-1', content: 'a.ts content' },
    { type: 'tool_result', tool_use_id: 'read-2', content: 'b.ts content' },
    { type: 'text', text: 'Done.' },
  ] satisfies MessageContentBlock[];

  const steps = extractTimelineStepsFromBlocks(blocks);

  assert.equal(steps.length, 2);
  assert.equal(steps[0].toolCalls[0].id, 'read-1');
  assert.equal(steps[0].toolCalls[0].result, 'a.ts content');
  assert.equal(steps[1].toolCalls[0].id, 'read-2');
  assert.equal(steps[1].toolCalls[0].result, 'b.ts content');
  assert.equal(steps.some((step) => step.toolCalls.some((tool) => tool.name === 'tool_result')), false);
});

test('agent timeline preserves reasoning/tool chronological order inside a step', () => {
  const state = createTimelineAccumulator(0);

  appendTimelineReasoning(state, 'Check the target file first. ', 1);
  appendTimelineToolUse(state, { id: 'read-1', name: 'Read', input: { file_path: '/tmp/a.ts' } }, 2);
  appendTimelineReasoning(state, 'The read returned empty, try ls. ', 3);
  appendTimelineToolUse(state, { id: 'ls-1', name: 'Bash', input: { command: 'ls -la /tmp' } }, 4);

  const steps = extractTimelineStepsFromBlocks([
    { type: 'timeline', steps: state.steps },
  ] as MessageContentBlock[]);

  const eventOrder = steps.flatMap((step) => step.events?.map((event) => (
    event.type === 'tool' ? `tool:${event.toolCallId}` : `reasoning:${event.content.trim()}`
  )) || []);

  assert.deepEqual(eventOrder, [
    'reasoning:Check the target file first.',
    'tool:read-1',
    'reasoning:The read returned empty, try ls.',
    'tool:ls-1',
  ]);
});

test('agent timeline status does not synthesize Thinking as reasoning content', () => {
  const state = createTimelineAccumulator(0);

  updateTimelineStatus(state, { message: 'Thinking', model: 'test-model' }, 1);

  assert.equal(state.steps[0].reasoning, '');
  assert.equal(state.steps[0].events?.length, 0);
});
