/**
 * Tests for agent-loop message handling and message-builder logic.
 *
 * message-builder tests import the REAL module to lock actual implementation.
 * agent-loop dedup logic is inlined because agent-loop.ts depends on
 * DB/streaming infrastructure that can't run in pure unit test context.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MessageContentBlock } from '@/types';

// ── Suite 1: message dedup (inlined — agent-loop needs DB to test directly) ──

function shouldAppendPrompt(
  historyMessages: Array<{ role: string; content: unknown }>,
  autoTrigger: boolean,
): boolean {
  if (autoTrigger) return true;
  if (historyMessages.length === 0) return true;
  if (historyMessages[historyMessages.length - 1]?.role !== 'user') return true;
  return false;
}

describe('agent-loop message dedup (inlined)', () => {
  it('does not append when last message is user (normal flow)', () => {
    assert.equal(shouldAppendPrompt([{ role: 'user', content: 'hi' }], false), false);
  });

  it('always appends for autoTrigger even if last is user', () => {
    assert.equal(shouldAppendPrompt([{ role: 'user', content: 'hi' }], true), true);
  });

  it('appends when history is empty', () => {
    assert.equal(shouldAppendPrompt([], false), true);
  });

  it('appends when last message is assistant', () => {
    assert.equal(shouldAppendPrompt([{ role: 'assistant', content: 'ok' }], false), true);
  });

  it('does not append when last is user with multipart content', () => {
    const multipart = [{ type: 'text', text: 'hi' }, { type: 'file', data: 'abc' }];
    assert.equal(shouldAppendPrompt([{ role: 'user', content: multipart }], false), false);
  });
});

// ── Suite 2: buildCoreMessages (REAL import from @/lib/message-builder) ──

describe('message-builder buildCoreMessages (real import)', () => {
  it('converts plain user messages', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'hello', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, 'hello');
  });

  it('rebuilds user message with image attachment', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-test-'));
    const imgPath = path.join(tmpDir, 'test.png');
    fs.writeFileSync(imgPath, Buffer.from('fakepng'));
    try {
      const fileMeta = JSON.stringify([{ id: '1', name: 'test.png', type: 'image/png', size: 7, filePath: imgPath }]);
      const content = `<!--files:${fileMeta}-->describe the image`;
      const result = buildCoreMessages([
        { id: '1', session_id: 's', role: 'user', content, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      ]);
      assert.equal(result.length, 1);
      assert.ok(Array.isArray(result[0].content), 'content should be multipart array');
      const parts = result[0].content as Array<{ type: string }>;
      assert.ok(parts.some(p => p.type === 'text'));
      assert.ok(parts.some(p => p.type === 'file'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back when attached file is missing', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const fileMeta = JSON.stringify([{ id: '1', name: 'gone.png', type: 'image/png', size: 0, filePath: '/nonexistent/gone.png' }]);
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: `<!--files:${fileMeta}-->text`, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result[0].role, 'user');
  });

  it('skips heartbeat-ack messages', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'hello', created_at: '', is_heartbeat_ack: 1, token_usage: '' },
    ]);
    assert.equal(result.length, 0);
  });

  it('merges consecutive user messages to string', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'first', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      { id: '2', session_id: 's', role: 'user', content: 'second', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result.length, 1);
    assert.ok(typeof result[0].content === 'string');
    assert.ok((result[0].content as string).includes('first'));
    assert.ok((result[0].content as string).includes('second'));
  });

  it('merges consecutive user messages preserving multipart', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-merge-'));
    const imgPath = path.join(tmpDir, 'img.png');
    fs.writeFileSync(imgPath, Buffer.from('png'));
    try {
      const fileMeta = JSON.stringify([{ id: '1', name: 'img.png', type: 'image/png', size: 3, filePath: imgPath }]);
      const result = buildCoreMessages([
        { id: '1', session_id: 's', role: 'user', content: 'plain text', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
        { id: '2', session_id: 's', role: 'user', content: `<!--files:${fileMeta}-->with image`, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      ]);
      assert.equal(result.length, 1);
      // Merged content should be array (has file part)
      assert.ok(Array.isArray(result[0].content), 'merged with file should be array');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('tool-call recovery helpers', () => {
  it('sanitizes orphaned tool_use blocks with synthetic tool_result blocks', async () => {
    const { sanitizeToolCallBlocks } = await import('@/lib/tool-call-recovery');
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Running command' },
      { type: 'tool_use', id: 'call_123', name: 'Bash', input: { command: 'sleep 10' } },
    ];

    const result = sanitizeToolCallBlocks(blocks, 'Timed out');
    assert.equal(result.length, 3);
    assert.equal(result[2]?.type, 'tool_result');
    assert.equal(result[2]?.tool_use_id, 'call_123');
    assert.equal(result[2]?.is_error, true);
    assert.match(result[2]?.content || '', /Timed out/);
  });

  it('hoists misplaced tool_result blocks before later assistant text for compat APIs', async () => {
    const { sanitizeToolCallBlocks } = await import('@/lib/tool-call-recovery');
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Running command' },
      { type: 'tool_use', id: 'call_123', name: 'Bash', input: { command: 'sleep 10' } },
      { type: 'text', text: 'This text was persisted before the tool result.' },
      { type: 'tool_result', tool_use_id: 'call_123', content: 'done', is_error: false },
    ];

    const result = sanitizeToolCallBlocks(blocks, 'Timed out');
    assert.deepEqual(
      result.map((block) => block.type),
      ['text', 'tool_use', 'tool_result', 'text'],
    );
    assert.equal(result[2]?.type, 'tool_result');
    assert.equal(result[2]?.tool_use_id, 'call_123');
  });

  it('inserts synthetic tool_result before later assistant text when none exists', async () => {
    const { sanitizeToolCallBlocks } = await import('@/lib/tool-call-recovery');
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Running command' },
      { type: 'tool_use', id: 'call_123', name: 'Bash', input: { command: 'sleep 10' } },
      { type: 'text', text: 'Assistant resumed speaking without a real tool result.' },
    ];

    const result = sanitizeToolCallBlocks(blocks, 'Timed out');
    assert.deepEqual(
      result.map((block) => block.type),
      ['text', 'tool_use', 'tool_result', 'text'],
    );
    assert.equal(result[2]?.type, 'tool_result');
    assert.equal(result[2]?.tool_use_id, 'call_123');
    assert.match(result[2]?.content || '', /Timed out/);
  });

  it('extracts missing tool ids from structured AI SDK errors', async () => {
    const { extractMissingToolCallIds } = await import('@/lib/tool-call-recovery');
    const ids = extractMissingToolCallIds(
      '{"userMessage":"AI_MissingToolResultsError: Tool results are missing for tool calls call_function_x89yazecd8hu_1, call_function_revb5vk89w7j_1."}',
    );

    assert.deepEqual(ids, [
      'call_function_x89yazecd8hu_1',
      'call_function_revb5vk89w7j_1',
    ]);
  });
});
