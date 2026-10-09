import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOcrUserContent } from '@/lib/ocr-service';

describe('buildOcrUserContent', () => {
  it('keeps only image bytes and asks the vision model for a literal transcription', () => {
    assert.deepEqual(buildOcrUserContent([
      { id: 'image-1', name: 'receipt.png', type: 'image/png', size: 3, data: 'YWJj' },
      { id: 'file-1', name: 'notes.txt', type: 'text/plain', size: 3, data: 'bm90' },
    ]), [
      { type: 'file', data: 'YWJj', mediaType: 'image/png' },
      { type: 'text', text: 'Transcribe every visible word in the attached image(s). Preserve reading order and line breaks. Do not describe the image, infer missing text, or answer the user.' },
    ]);
  });
});
