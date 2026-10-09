import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCoreMessages } from '../../lib/message-builder';
import type { Message } from '../../types';

describe('buildCoreMessages tool_result mapping', () => {
  it('should map tool_result blocks to ToolModelMessage with output:text', () => {
    const dbMessages: Message[] = [
      {
        id: 'm1',
        session_id: 's1',
        role: 'user',
        content: 'hi',
        created_at: '2026-01-01 00:00:00',
        token_usage: null,
      },
      {
        id: 'm2',
        session_id: 's1',
        role: 'assistant',
        content: JSON.stringify([
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'tu_1', name: 'WebFetch', input: { url: 'https://example.com' } },
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'done', is_error: false },
          { type: 'text', text: 'finished' },
        ]),
        created_at: '2026-01-01 00:00:01',
        token_usage: null,
      },
    ];

    const messages = buildCoreMessages(dbMessages);
    const toolMsg = messages.find(m => m.role === 'tool') as any;
    assert.ok(toolMsg, 'should include a tool message');
    assert.ok(Array.isArray(toolMsg.content), 'tool message content should be an array');
    assert.equal(toolMsg.content[0].type, 'tool-result');
    assert.deepEqual(toolMsg.content[0].output, { type: 'text', value: 'done' });
  });

  it('should map error tool_result blocks to output:error-text', () => {
    const dbMessages: Message[] = [
      {
        id: 'm1',
        session_id: 's1',
        role: 'assistant',
        content: JSON.stringify([
          { type: 'tool_use', id: 'tu_1', name: 'WebFetch', input: { url: 'https://example.com' } },
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'fetch failed', is_error: true },
        ]),
        created_at: '2026-01-01 00:00:01',
        token_usage: null,
      },
    ];

    const messages = buildCoreMessages(dbMessages);
    const toolMsg = messages.find(m => m.role === 'tool') as any;
    assert.ok(toolMsg, 'should include a tool message');
    assert.deepEqual(toolMsg.content[0].output, { type: 'text', value: 'fetch failed' });
  });
});

