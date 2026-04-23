import { generateImage, NoImageGeneratedError } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getDb, getSession } from '@/lib/db';
import { getDefaultConfiguredImageModel, getMediaRelayProtocol, resolveMediaRelayEndpoint } from '@/lib/image-provider-utils';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

export interface GenerateSingleImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
  providerId?: string;
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
}

/**
 * Shared image generation function.
 * Handles: Provider lookup → Gemini API call → file save → project dir copy → DB record.
 */
export async function generateSingleImage(params: GenerateSingleImageParams): Promise<GenerateSingleImageResult> {
  const startTime = Date.now();

  const db = getDb();

  // Helper to get a provider by ID
  const getProviderById = (id: string) => db.prepare(
    "SELECT id, name, provider_type, api_key, base_url, extra_env, env_overrides_json, role_models_json, options_json FROM api_providers WHERE id = ? LIMIT 1"
  ).get(id) as {
    id: string;
    name: string;
    provider_type: string;
    api_key: string;
    base_url?: string;
    extra_env?: string;
    env_overrides_json?: string;
    role_models_json?: string;
    options_json?: string;
  } | undefined;

  // When providerId is explicitly specified, use it directly
  if (params.providerId) {
    const provider = getProviderById(params.providerId);
    if (!provider) {
      throw new Error('Specified provider not found.');
    }
    return generateWithProvider(provider, params, startTime);
  }

  // No provider specified: check which providers are enabled and select based on user preference
  // Priority: if gemini-image is enabled, use it; otherwise use generic-image (relay)
  const geminiProvider = db.prepare(
    "SELECT id, name, provider_type, api_key, base_url, extra_env, env_overrides_json, role_models_json, options_json FROM api_providers WHERE provider_type = 'gemini-image' AND api_key != '' LIMIT 1"
  ).get() as {
    id: string;
    name: string;
    provider_type: string;
    api_key: string;
    base_url?: string;
    extra_env?: string;
    env_overrides_json?: string;
    role_models_json?: string;
    options_json?: string;
  } | undefined;

  // If gemini-image is enabled, use it (respects user's explicit enable/disable choice)
  if (geminiProvider) {
    return generateWithProvider(geminiProvider, params, startTime);
  }

  // Otherwise, fall back to generic-image (relay) if enabled
  const genericProvider = db.prepare(
    "SELECT id, name, provider_type, api_key, base_url, extra_env, env_overrides_json, role_models_json, options_json FROM api_providers WHERE provider_type = 'generic-image' AND api_key != '' LIMIT 1"
  ).get() as {
    id: string;
    name: string;
    provider_type: string;
    api_key: string;
    base_url?: string;
    extra_env?: string;
    env_overrides_json?: string;
    role_models_json?: string;
    options_json?: string;
  } | undefined;

  if (!genericProvider) {
    throw new Error('No image provider configured. Please add a media provider in Settings.');
  }

  return generateWithProvider(genericProvider, params, startTime);
}

/**
 * Generate image with a specific provider
 */
async function generateWithProvider(
  provider: {
    id: string;
    name: string;
    provider_type: string;
    api_key: string;
    base_url?: string;
    extra_env?: string;
    env_overrides_json?: string;
    role_models_json?: string;
    options_json?: string;
  },
  params: GenerateSingleImageParams,
  startTime: number
): Promise<GenerateSingleImageResult> {
  const configuredModel = getDefaultConfiguredImageModel(provider);

  const requestedModel = params.model || configuredModel;
  const aspectRatio = (params.aspectRatio || '1:1') as `${number}:${number}`;
  const imageSize = params.imageSize || '1K';
  const google = createGoogleGenerativeAI({ apiKey: provider.api_key });

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

  const images = await (async () => {
    const relayProtocol = getMediaRelayProtocol(provider);
    const useRelay = provider.provider_type === 'generic-image' || relayProtocol === 'openai-images';
    if (useRelay) {
      const endpoint = resolveMediaRelayEndpoint(provider);
      // Support for relay platforms that use Chat Completion API for image generation
      // This is common for Gemini models or certain DALL-E 3 relay implementations
      // We check for /chat/completions or if the model name suggests a chat-based generator
      const isChatEndpoint = endpoint.includes('/chat/completions') || 
                            endpoint.includes('/v1/chat') || 
                            requestedModel.toLowerCase().includes('gemini') || 
                            requestedModel.toLowerCase().includes('gpt-4');
      
      const requestBody = isChatEndpoint ? {
        model: requestedModel,
        messages: [{ role: 'user', content: params.prompt }],
      } : {
        model: requestedModel,
        prompt: params.prompt,
        size: imageSize === '2K' ? '1536x1536' : '1024x1024',
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify(requestBody),
        signal: params.abortSignal || AbortSignal.timeout(300_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        throw new Error(`Image relay request failed: ${message}`);
      }

      let b64: string | undefined;
      if (isChatEndpoint) {
        // Handle Chat Completion response: extract image URL or base64 from message content
        // Some relays return markdown: ![image](data:image/png;base64,...)
        // or just the raw base64/URL
        const content = payload?.choices?.[0]?.message?.content || '';
        
        // Try to find a URL in the content
        const urlMatch = content.match(/https?:\/\/[^\s\)]+/);
        // Try to find base64 in the content
        const b64Match = content.match(/base64,([a-zA-Z0-9+/=]+)/);
        
        if (b64Match) {
          b64 = b64Match[1];
        } else if (urlMatch) {
          b64 = urlMatch[0];
        } else {
          // Fallback: check if the whole content is base64 or a URL
          const trimmed = content.trim();
          if (trimmed.startsWith('http') || /^[a-zA-Z0-9+/=]+$/.test(trimmed)) {
            b64 = trimmed;
          }
        }

        // If still not found, check if it returned a standard data array even though it was a chat endpoint
        if (!b64 && payload?.data?.[0]?.url) {
          b64 = payload.data[0].url;
        }
        if (!b64 && payload?.data?.[0]?.b64_json) {
          b64 = payload.data[0].b64_json;
        }
      } else {
        b64 = payload?.data?.[0]?.b64_json || payload?.data?.[0]?.url;
      }

      if (!b64 || typeof b64 !== 'string') {
        throw new Error('Image relay did not return valid image data');
      }

      // If it's a URL or a data URI instead of base64, we need to handle it
      if (b64.startsWith('http') || b64.startsWith('data:')) {
        let buf: ArrayBuffer;
        let mimeType = 'image/png';

        if (b64.startsWith('data:')) {
          const match = b64.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            buf = Buffer.from(match[2], 'base64').buffer;
          } else {
            throw new Error('Invalid data URI format from image relay');
          }
        } else {
          const imgRes = await fetch(b64);
          if (!imgRes.ok) {
            throw new Error(`Failed to download image from relay URL: ${imgRes.statusText}`);
          }
          buf = await imgRes.arrayBuffer();
          const contentType = imgRes.headers.get('content-type');
          if (contentType) mimeType = contentType;
        }

        return [{ mediaType: mimeType, uint8Array: new Uint8Array(buf) }];
      }

      return [{ mediaType: 'image/png', uint8Array: Uint8Array.from(Buffer.from(b64, 'base64')) }];
    }
    const generated = await generateImage({
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
    return generated.images;
  })();

  const elapsed = Date.now() - startTime;
  console.log(`[image-generator] ${requestedModel} ${imageSize} completed in ${elapsed}ms`);

  // skipSave mode: return raw image data without writing to disk or DB.
  // The MCP media pipeline (collectStreamResponse → saveMediaToLibrary) handles persistence.
  if (params.skipSave) {
    const rawImages = images.map(img => ({
      mimeType: img.mediaType,
      localPath: '',
      rawData: Buffer.from(img.uint8Array),
    }));
    return { mediaGenerationId: '', images: rawImages, elapsedMs: elapsed };
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

  const dbForInsert = getDb();
  dbForInsert.prepare(
    `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, 'image', 'completed', 'gemini', requestedModel, params.prompt,
    aspectRatio, imageSize, localPath, '',
    params.sessionId || null, null,
    '[]', JSON.stringify(metadata),
    null, now, now
  );

  return {
    mediaGenerationId: id,
    images: savedImages,
    elapsedMs: elapsed,
  };
}

// Re-export for backward compatibility in error handling
export { NoImageGeneratedError };
