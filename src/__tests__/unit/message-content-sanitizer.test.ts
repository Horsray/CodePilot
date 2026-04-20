import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractVisibleTextFromStructuredContent,
  stripLeakedTransportContent,
} from '../../lib/message-content-sanitizer';

describe('message content sanitizer', () => {
  it('keeps only user-visible text from structured message blocks', () => {
    const content = JSON.stringify([
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'src/app.ts' } },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
      { type: 'text', text: '完成：已检查入口文件。' },
    ]);

    assert.equal(extractVisibleTextFromStructuredContent(content), '完成：已检查入口文件。');
  });

  it('removes leaked SSE transport objects line-by-line', () => {
    const content = [
      '我会继续处理。',
      '{"type":"tool_result","data":"{\\"tool_use_id\\":\\"1\\"}"}',
      'data: {"type":"status","data":"{\\"message\\":\\"Running\\"}"}',
      '最终结论。',
    ].join('\n');

    assert.equal(stripLeakedTransportContent(content), '我会继续处理。\n最终结论。');
  });

  it('does not strip arbitrary JSON answers that merely contain a type field', () => {
    const content = JSON.stringify([
      { type: 'invoice', amount: 12 },
      { type: 'receipt', amount: 12 },
    ]);

    assert.equal(stripLeakedTransportContent(content), content);
  });
});
