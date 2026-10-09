import { NextRequest } from 'next/server';
import { generateSingleImage, NoImageGeneratedError } from '@/lib/image-generator';

interface GenerateRequest {
  prompt: string;
  model?: string;
  /** Optional explicit provider row id; overrides the model-family + active-setting fallback chain. */
  providerId?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
  /** Number of images to generate in parallel (1-4). Default 1. */
  count?: number;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();

    if (!body.prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const count = Math.min(Math.max(body.count || 1, 1), 4);
    const startTime = Date.now();

    if (count === 1) {
      // Single image — original logic, untouched
      const result = await generateSingleImage({
        prompt: body.prompt,
        model: body.model,
        providerId: body.providerId,
        aspectRatio: body.aspectRatio,
        imageSize: body.imageSize,
        referenceImages: body.referenceImages,
        referenceImagePaths: body.referenceImagePaths,
        sessionId: body.sessionId,
      });

      return new Response(
        JSON.stringify({
          id: result.mediaGenerationId,
          text: '',
          images: result.images,
          model: result.model,
          family: result.family,
          imageSize: body.imageSize || '1K',
          elapsedMs: result.elapsedMs,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Multiple images — parallel execution
    const results = await Promise.allSettled(
      Array.from({ length: count }, () =>
        generateSingleImage({
          prompt: body.prompt,
          model: body.model,
          providerId: body.providerId,
          aspectRatio: body.aspectRatio,
          imageSize: body.imageSize,
          referenceImages: body.referenceImages,
          referenceImagePaths: body.referenceImagePaths,
          sessionId: body.sessionId,
        })
      )
    );

    const allImages: { mimeType: string; localPath: string; width?: number; height?: number }[] = [];
    const errors: string[] = [];
    let model = '';
    let family = '';

    for (const r of results) {
      if (r.status === 'fulfilled') {
        allImages.push(...r.value.images);
        if (!model && r.value.model) model = r.value.model;
        if (!family && r.value.family) family = r.value.family;
      } else {
        errors.push(r.reason?.message || 'Generation failed');
      }
    }

    if (allImages.length === 0) {
      const errMsg = errors.join('; ') || 'No images were generated';
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        text: '',
        images: allImages,
        model,
        family,
        imageSize: body.imageSize || '1K',
        elapsedMs: Date.now() - startTime,
        totalRequested: count,
        totalSucceeded: allImages.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[media/generate] Failed:', error);

    if (NoImageGeneratedError.isInstance(error)) {
      return new Response(
        JSON.stringify({ error: 'No images were generated. Try a different prompt.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate image';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
