import type { ProviderOptions } from '@/types';

export type ImageInputRoute =
  | { mode: 'direct' }
  | { mode: 'ocr'; ocrProviderId: string; ocrModel: string }
  | { mode: 'blocked'; reason: 'IMAGE_INPUT_CAPABILITY_UNKNOWN' | 'OCR_NOT_CONFIGURED' };

/**
 * Decides whether a model receives image bytes or an OCR transcription.
 * A user override is intentionally evaluated before catalog metadata: it is
 * the escape hatch for private relays and newly released models.
 */
export function resolveImageInputRoute(input: {
  modelVision?: boolean;
  options?: ProviderOptions;
}): ImageInputRoute {
  const support = input.options?.image_input_support || 'auto';
  const supportsImages = support === 'supported'
    ? true
    : support === 'unsupported'
      ? false
      : input.modelVision;

  if (supportsImages === true) return { mode: 'direct' };

  if (supportsImages === false) {
    const ocrProviderId = input.options?.ocr_provider_id?.trim();
    const ocrModel = input.options?.ocr_model?.trim();
    if (ocrProviderId && ocrModel) {
      return { mode: 'ocr', ocrProviderId, ocrModel };
    }
    return { mode: 'blocked', reason: 'OCR_NOT_CONFIGURED' };
  }

  return { mode: 'blocked', reason: 'IMAGE_INPUT_CAPABILITY_UNKNOWN' };
}
