import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { urlToFileAttachment } from '@/lib/file-utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('urlToFileAttachment', () => {
  it('reads a blob URL into base64 image data instead of serializing the URL itself', async () => {
    globalThis.fetch = async (input) => {
      assert.equal(input, 'blob:preview-image');
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' },
      });
    };

    const attachment = await urlToFileAttachment('blob:preview-image', 'screen.png', 'image/png');

    assert.equal(attachment.name, 'screen.png');
    assert.equal(attachment.type, 'image/png');
    assert.equal(attachment.data, 'iVBORw==');
    assert.notEqual(attachment.data, 'blob:preview-image');
  });
});
