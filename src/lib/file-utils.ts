import { nanoid } from 'nanoid';
import type { FileAttachment } from '@/types';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Convert a data URL to a FileAttachment object.
 */
export async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
  };
}

/**
 * Convert the URL emitted by PromptInput into transportable attachment data.
 * PromptInput uses `blob:` object URLs for local file selection, while pasted
 * content may use a `data:` URL. Sending the URL string as base64 corrupts
 * the attachment and leaves the model without the image bytes.
 */
export async function urlToFileAttachment(
  url: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  if (url.startsWith('data:')) {
    return dataUrlToFileAttachment(url, filename, mediaType);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read attachment: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return {
    id: nanoid(),
    name: filename,
    type: response.headers.get('content-type') || mediaType || 'application/octet-stream',
    size: buffer.byteLength,
    data: arrayBufferToBase64(buffer),
  };
}
