import fs from 'fs';
import { generateText } from 'ai';
import { createModel } from '@/lib/ai-provider';
import { isImageFile, type FileAttachment } from '@/types';

const OCR_INSTRUCTION = 'Transcribe every visible word in the attached image(s). Preserve reading order and line breaks. Do not describe the image, infer missing text, or answer the user.';

type OcrContentPart =
  | { type: 'file'; data: string; mediaType: string }
  | { type: 'text'; text: string };

/** Builds the multimodal user content sent only to the configured OCR model. */
export function buildOcrUserContent(files: FileAttachment[]): OcrContentPart[] {
  const images = files
    .filter(file => isImageFile(file.type) && file.data)
    .map(file => ({ type: 'file' as const, data: file.data, mediaType: file.type }));
  return [...images, { type: 'text', text: OCR_INSTRUCTION }];
}

/**
 * Extract text with a user-selected vision model. This deliberately does not
 * use the conversation model: callers select an OCR model that was validated
 * as vision-capable before calling it.
 */
export async function extractTextFromImages(params: {
  files: FileAttachment[];
  providerId: string;
  model: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const hydratedFiles = params.files.map(file => {
    if (file.data || !file.filePath || !isImageFile(file.type)) return file;
    return { ...file, data: fs.readFileSync(file.filePath).toString('base64') };
  });
  const content = buildOcrUserContent(hydratedFiles);
  if (content.length === 1) return '';

  const { languageModel } = createModel({ providerId: params.providerId, model: params.model });
  const result = await generateText({
    model: languageModel,
    messages: [{ role: 'user', content }],
    maxOutputTokens: 8192,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });
  return result.text.trim();
}
