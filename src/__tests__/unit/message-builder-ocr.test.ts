import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCoreMessages } from '@/lib/message-builder';

describe('OCR-routed attachment history', () => {
  it('does not resend an OCR-only image while retaining its extracted text', () => {
    const messages = buildCoreMessages([{
      id: 'user-1', session_id: 'session-1', role: 'user',
      content: '<!--files:[{"id":"image-1","name":"scan.png","type":"image/png","size":12,"filePath":"/not-read","modelVisible":false}]-->Please read this\n\n[以下为附件图片的 OCR 文字，按原始图片阅读顺序]\nhello world',
      created_at: '', token_usage: null,
    }]);
    assert.deepEqual(messages, [{
      role: 'user',
      content: 'Please read this\n\n[以下为附件图片的 OCR 文字，按原始图片阅读顺序]\nhello world',
    }]);
  });
});
