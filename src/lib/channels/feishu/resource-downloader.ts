/**
 * Feishu message resource downloader.
 *
 * Downloads images/files/audio/video sent by users via the im.messageResource API,
 * with retry on transient failures. Produces FileAttachment objects ready for the
 * bridge attachments field.
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { FileAttachment } from '@/types';
import crypto from 'crypto';

const LOG_TAG = '[feishu/resource]';
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DOWNLOAD_MAX_RETRIES = 2;
const DOWNLOAD_RETRY_DELAY_MS = 1000;

export type FeishuResourceType = 'image' | 'file' | 'audio' | 'video';

const MIME_BY_TYPE: Record<FeishuResourceType, string> = {
  image: 'image/png',
  file: 'application/octet-stream',
  audio: 'audio/ogg',
  video: 'video/mp4',
};

const EXT_BY_TYPE: Record<FeishuResourceType, string> = {
  image: 'png',
  file: 'bin',
  audio: 'ogg',
  video: 'mp4',
};

interface MessageResourceResponse {
  getReadableStream(): AsyncIterable<Buffer | Uint8Array>;
}

function getMessageResourceApi(client: lark.Client): {
  get(payload: { path: { message_id: string; file_key: string }; params: { type: string } }): Promise<MessageResourceResponse>;
} {
  return (client as unknown as {
    im: {
      messageResource: {
        get(payload: { path: { message_id: string; file_key: string }; params: { type: string } }): Promise<MessageResourceResponse>;
      };
    };
  }).im.messageResource;
}

export async function downloadResource(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  resourceType: FeishuResourceType,
): Promise<FileAttachment | null> {
  if (!messageId || !fileKey) return null;

  for (let attempt = 0; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = DOWNLOAD_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        console.log(LOG_TAG, `Download retry ${attempt}/${DOWNLOAD_MAX_RETRIES}: key=${fileKey}`);
      }

      const res = await getMessageResourceApi(client).get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: resourceType === 'image' ? 'image' : 'file' },
      });

      const chunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of res.getReadableStream()) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += buf.length;
        if (totalSize > MAX_FILE_SIZE) {
          console.warn(LOG_TAG, `Resource too large (>${MAX_FILE_SIZE}): key=${fileKey}`);
          return null;
        }
        chunks.push(buf);
      }

      if (totalSize === 0) {
        console.warn(LOG_TAG, `Empty resource: key=${fileKey}`);
        continue;
      }

      const buffer = Buffer.concat(chunks);
      return {
        id: crypto.randomUUID(),
        name: `${fileKey}.${EXT_BY_TYPE[resourceType]}`,
        type: MIME_BY_TYPE[resourceType],
        size: buffer.length,
        data: buffer.toString('base64'),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('permission')) {
        console.error(LOG_TAG, `Permanent download failure: ${msg}`);
        return null;
      }
      console.warn(LOG_TAG, `Download attempt ${attempt + 1} failed: ${msg}`);
    }
  }

  return null;
}
