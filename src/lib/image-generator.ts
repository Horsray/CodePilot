import { generateImage, NoImageGeneratedError } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getDb, getSession } from '@/lib/db';
import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  getDefaultConfiguredImageModel,
  getMediaRelayProtocol,
  isOfficialGeminiImageProvider,
  resolveMediaRelayEndpoint,
} from '@/lib/image-provider-utils';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

export interface GenerateSingleImageParams {
  prompt: string;
  model?: string;
  providerId?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
  abortSignal?: AbortSignal;
  /** When true, skip disk write / project copy / DB insert — caller (MCP pipeline) handles persistence */
  skipSave?: boolean;
  /** Working directory for resolving relative referenceImagePaths */
  cwd?: string;
}

export interface GenerateSingleImageResult {
  mediaGenerationId: string;
  images: Array<{ mimeType: string; localPath: string; rawData?: Buffer }>;
  elapsedMs: number;
  providerId: string;
  providerName: string;
  providerLabel: string;
  model: string;
}

interface ImageProviderRecord {
  id: string;
  name: string;
  provider_type: string;
  protocol: string;
  api_key: string;
  base_url?: string;
  extra_env?: string;
  env_overrides_json?: string;
  role_models_json?: string;
  options_json?: string;
}

function isConfiguredMediaProvider(provider: ImageProviderRecord): boolean {
  return !!provider.api_key && (
    provider.protocol === 'gemini-image' ||
    provider.provider_type === 'gemini-image' ||
    provider.provider_type === 'generic-image'
  );
}

function getProviderLabel(provider: ImageProviderRecord): string {
  return isOfficialGeminiImageProvider(provider)
    ? `${provider.name} (Google)`
    : `${provider.name} (Relay)`;
}

function resolveImageProvider(db: ReturnType<typeof getDb>, providerId?: string): ImageProviderRecord {
  const providers = db.prepare(
    'SELECT id, name, provider_type, protocol, api_key, base_url, extra_env, env_overrides_json, role_models_json, options_json FROM api_providers ORDER BY sort_order ASC, created_at ASC'
  ).all() as ImageProviderRecord[];
  const mediaProviders = providers.filter(isConfiguredMediaProvider);

  if (mediaProviders.length === 0) {
    throw new Error('No image provider configured. Please add a media provider in Settings.');
  }

  if (!providerId) {
    return mediaProviders[0];
  }

  const selected = mediaProviders.find(provider => provider.id === providerId);
  if (!selected) {
    throw new Error('Selected image provider is unavailable. Please choose another media provider.');
  }
  return selected;
}

function getOpenAiCompatibleImageSize(aspectRatio: string, imageSize: string): string {
  const orientation = (() => {
    const match = aspectRatio.match(/^(\d+):(\d+)$/);
    if (!match) return 'square';
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width === height) return 'square';
    return width > height ? 'landscape' : 'portrait';
  })();

  const sizeMap = {
    '1K': {
      square: '1024x1024',
      landscape: '1536x1024',
      portrait: '1024x1536',
    },
    '2K': {
      square: '1536x1536',
      landscape: '2048x1536',
      portrait: '1536x2048',
    },
    '4K': {
      square: '2048x2048',
      landscape: '3072x2048',
      portrait: '2048x3072',
    },
  } as const;

  const normalizedSize = imageSize === '4K' ? '4K' : imageSize === '2K' ? '2K' : '1K';
  return sizeMap[normalizedSize][orientation];
}

function parseRelayJson<T>(rawBody: string, contentType: string, errorMessage: string): T {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`${errorMessage} (content-type: ${contentType || 'unknown'})`);
  }
}

async function downloadRemoteImage(url: string, abortSignal?: AbortSignal) {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || '';
  return {
    mediaType: contentType.startsWith('image/') ? contentType : 'image/png',
    uint8Array: Buffer.from(arrayBuffer),
  };
}

async function parseOpenAiImagesResponse(
  provider: ImageProviderRecord,
  relayUrl: string,
  rawBody: string,
  contentType: string,
  abortSignal?: AbortSignal,
) {
  const data = parseRelayJson<{
    data?: Array<{ b64_json?: string; url?: string }>;
  }>(
    rawBody,
    contentType,
    `[${provider.name}] Relay response is not valid JSON. Check the configured endpoint: ${relayUrl}`
  );

  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error(`[${provider.name}] Invalid OpenAI image response from relay`);
  }

  return Promise.all(data.data.map(async (item) => {
    if (item.b64_json) {
      const base64 = item.b64_json.replace(/^data:[^;]+;base64,/, '');
      return {
        mediaType: 'image/png',
        uint8Array: Buffer.from(base64, 'base64'),
      };
    }
    if (item.url) {
      return downloadRemoteImage(item.url, abortSignal);
    }
    throw new Error(`[${provider.name}] OpenAI image response is missing image data`);
  }));
}

function parseCustomRelayResponse(
  provider: ImageProviderRecord,
  relayUrl: string,
  rawBody: string,
  contentType: string,
) {
  const data = parseRelayJson<{
    images?: Array<{ mimeType?: string; data: string }>;
  }>(
    rawBody,
    contentType,
    `[${provider.name}] Relay response is not valid JSON. Check the configured endpoint: ${relayUrl}`
  );

  if (!Array.isArray(data.images)) {
    throw new Error(`[${provider.name}] Invalid response from image provider`);
  }

  return data.images.map((img) => ({
    mediaType: img.mimeType || 'image/png',
    uint8Array: Buffer.from(img.data, 'base64'),
  }));
}

/**
 * Shared image generation function.
 * Handles: Provider lookup → Gemini API call → file save → project dir copy → DB record.
 */
export async function generateSingleImage(params: GenerateSingleImageParams): Promise<GenerateSingleImageResult> {
  const startTime = Date.now();

  const db = getDb();
  const provider = resolveImageProvider(db, params.providerId);
  const configuredModel = getDefaultConfiguredImageModel(provider);
  const requestedModel = params.model || configuredModel || DEFAULT_GEMINI_IMAGE_MODEL;
  const aspectRatio = (params.aspectRatio || '1:1') as `${number}:${number}`;
  const imageSize = params.imageSize || '1K';

  // Build prompt: plain string or { text, images } for reference images
  // Combine both base64 data and file paths — both can be provided simultaneously
  const refImageData: string[] = [];
  if (params.referenceImagePaths && params.referenceImagePaths.length > 0) {
    for (const fp of params.referenceImagePaths) {
      // Resolve relative paths against session working directory
      const resolved = path.isAbsolute(fp) ? fp : path.resolve(params.cwd || process.cwd(), fp);
      if (fs.existsSync(resolved)) {
        const buf = fs.readFileSync(resolved);
        refImageData.push(buf.toString('base64'));
      }
    }
  }
  if (params.referenceImages && params.referenceImages.length > 0) {
    refImageData.push(...params.referenceImages.map(img => img.data));
  }
  const prompt = refImageData.length > 0
    ? { text: params.prompt, images: refImageData }
    : params.prompt;

  let images;
  if (!isOfficialGeminiImageProvider(provider)) {
    const relayProtocol = getMediaRelayProtocol(provider);
    const relayUrl = resolveMediaRelayEndpoint(provider);
    if (!relayUrl) {
      throw new Error(`[${provider.name}] Relay provider is missing a usable endpoint`);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    const requestSignal = params.abortSignal
      ? AbortSignal.any([controller.signal, params.abortSignal])
      : controller.signal;

    try {
      if (relayProtocol === 'openai-images' && refImageData.length > 0) {
        throw new Error(
          `[${provider.name}] OpenAI Images relay currently supports text-to-image only. Use Gemini official or a custom image relay for reference-image editing.`
        );
      }

      const requestBody = relayProtocol === 'openai-images'
        ? {
          model: requestedModel,
          prompt: params.prompt,
          n: 1,
          response_format: 'b64_json',
          size: getOpenAiCompatibleImageSize(aspectRatio, imageSize),
        }
        : {
          model: requestedModel,
          prompt: params.prompt,
          aspectRatio,
          imageSize,
          referenceImages: refImageData.length > 0 ? refImageData : undefined,
        };

      const response = await fetch(relayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify(requestBody),
        signal: requestSignal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();

      if (!response.ok) {
        if (contentType.includes('text/html') || rawBody.trim().startsWith('<')) {
          throw new Error(
            `[${provider.name}] Relay returned HTML instead of JSON (HTTP ${response.status}). Check whether the configured endpoint points to a web page instead of an image API endpoint: ${relayUrl}`
          );
        }

        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(rawBody) as { error?: string; message?: string };
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          const snippet = rawBody.trim().slice(0, 160);
          if (snippet) {
            errorMessage = `${errorMessage}: ${snippet}`;
          }
        }
        throw new Error(`[${provider.name}] ${errorMessage}`);
      }

      if (contentType.includes('text/html') || rawBody.trim().startsWith('<')) {
        throw new Error(
          `[${provider.name}] Relay returned HTML instead of JSON. Check whether the configured endpoint points to a dashboard page instead of an image API endpoint: ${relayUrl}`
        );
      }

      images = relayProtocol === 'openai-images'
        ? await parseOpenAiImagesResponse(provider, relayUrl, rawBody, contentType, requestSignal)
        : parseCustomRelayResponse(provider, relayUrl, rawBody, contentType);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        throw new Error(`[${provider.name}] ${error.message.replace(/^\[[^\]]+\]\s*/, '')}`);
      }
      throw error;
    }
  } else {
    // 使用 Google Gemini 官方 API
    try {
      const google = createGoogleGenerativeAI({ apiKey: provider.api_key });

      const result = await generateImage({
        model: google.image(requestedModel),
        prompt,
        providerOptions: {
          google: {
            imageConfig: { aspectRatio, imageSize },
          },
        },
        maxRetries: 3,
        abortSignal: params.abortSignal || AbortSignal.timeout(300_000),
      });

      images = result.images;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`[${provider.name}] ${error.message}`);
      }
      throw error;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[image-generator] ${requestedModel} ${imageSize} completed in ${elapsed}ms`);

  // skipSave mode: return raw image data without writing to disk or DB.
  // The MCP media pipeline (collectStreamResponse → saveMediaToLibrary) handles persistence.
  if (params.skipSave) {
    const rawImages = images.map((img: { mediaType: string; uint8Array: Uint8Array }) => ({
      mimeType: img.mediaType,
      localPath: '',
      rawData: Buffer.from(img.uint8Array),
    }));
    return {
      mediaGenerationId: '',
      images: rawImages,
      elapsedMs: elapsed,
      providerId: provider.id,
      providerName: provider.name,
      providerLabel: getProviderLabel(provider),
      model: requestedModel,
    };
  }

  // Ensure media directory exists
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }

  // Write images to disk
  const savedImages: Array<{ mimeType: string; localPath: string }> = [];
  for (const img of images) {
    const ext = img.mediaType === 'image/jpeg' ? '.jpg'
      : img.mediaType === 'image/webp' ? '.webp'
      : '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(img.uint8Array));
    savedImages.push({ mimeType: img.mediaType, localPath: filePath });
  }

  // Copy images to project directory if sessionId is provided
  if (params.sessionId) {
    try {
      const session = getSession(params.sessionId);
      if (session?.working_directory) {
        const projectImgDir = path.join(session.working_directory, '.codepilot-images');
        if (!fs.existsSync(projectImgDir)) {
          fs.mkdirSync(projectImgDir, { recursive: true });
        }
        for (const saved of savedImages) {
          const destPath = path.join(projectImgDir, path.basename(saved.localPath));
          fs.copyFileSync(saved.localPath, destPath);
        }
        console.log(`[image-generator] Copied ${savedImages.length} image(s) to ${projectImgDir}`);
      }
    } catch (copyErr) {
      console.warn('[image-generator] Failed to copy images to project directory:', copyErr);
    }
  }

  // Save reference images to disk for gallery display
  const savedRefImages: Array<{ mimeType: string; localPath: string }> = [];
  if (refImageData.length > 0) {
    const refMimeTypes = params.referenceImages
      ? params.referenceImages.map(img => img.mimeType)
      : params.referenceImagePaths
        ? params.referenceImagePaths.map(() => 'image/png')
        : [];
    for (let i = 0; i < refImageData.length; i++) {
      const mime = refMimeTypes[i] || 'image/png';
      const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
      const filename = `ref-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(MEDIA_DIR, filename);
      fs.writeFileSync(filePath, Buffer.from(refImageData[i], 'base64'));
      savedRefImages.push({ mimeType: mime, localPath: filePath });
    }
  }

  // DB record
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const localPath = savedImages.length > 0 ? savedImages[0].localPath : '';

  const metadata: Record<string, unknown> = {
    imageCount: savedImages.length,
    elapsedMs: elapsed,
    model: requestedModel,
  };
  if (savedRefImages.length > 0) {
    metadata.referenceImages = savedRefImages;
  }

  db.prepare(
    `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, 'image', 'completed', provider.name, requestedModel, params.prompt,
    aspectRatio, imageSize, localPath, '',
    params.sessionId || null, null,
    '[]', JSON.stringify({
      ...metadata,
      providerId: provider.id,
      providerName: provider.name,
      providerLabel: getProviderLabel(provider),
    }),
    null, now, now
  );

  return {
    mediaGenerationId: id,
    images: savedImages,
    elapsedMs: elapsed,
    providerId: provider.id,
    providerName: provider.name,
    providerLabel: getProviderLabel(provider),
    model: requestedModel,
  };
}

// Re-export for backward compatibility in error handling
export { NoImageGeneratedError };
