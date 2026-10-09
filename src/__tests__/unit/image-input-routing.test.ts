import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveImageInputRoute } from '@/lib/image-input-routing';

describe('resolveImageInputRoute', () => {
  it('sends images directly when the selected model is marked vision-capable', () => {
    assert.deepEqual(resolveImageInputRoute({ modelVision: true }), { mode: 'direct' });
  });

  it('routes a known text-only model to configured OCR', () => {
    assert.deepEqual(resolveImageInputRoute({
      modelVision: false,
      options: { ocr_provider_id: 'mimo', ocr_model: 'mimo-v2.6-flash' },
    }), {
      mode: 'ocr',
      ocrProviderId: 'mimo',
      ocrModel: 'mimo-v2.6-flash',
    });
  });

  it('lets a user override an unknown model as vision-capable', () => {
    assert.deepEqual(resolveImageInputRoute({
      modelVision: undefined,
      options: { image_input_support: 'supported' },
    }), { mode: 'direct' });
  });

  it('blocks image submission when vision capability is unknown', () => {
    assert.deepEqual(resolveImageInputRoute({ modelVision: undefined }), {
      mode: 'blocked',
      reason: 'IMAGE_INPUT_CAPABILITY_UNKNOWN',
    });
  });
});
