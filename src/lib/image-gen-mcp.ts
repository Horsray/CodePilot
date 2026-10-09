/**
 * codepilot-image-gen MCP — in-process MCP server for Gemini image generation.
 *
 * The MCP tool calls generateSingleImage() which saves images to disk and DB.
 * It returns a text result with localPaths — the frontend renders them via
 * the tool_result media field that claude-client.ts injects from the paths.
 *
 * Keyword-gated: co-registered with codepilot-media when the conversation
 * involves media/image/video generation tasks.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { generateSingleImage, NoImageGeneratedError } from '@/lib/image-generator';

/**
 * Marker prefix in tool result text that claude-client.ts detects to construct
 * MediaBlock[] for the SSE event. Format: __MEDIA_RESULT__<JSON array of {type, mimeType, localPath}>
 */
export const MEDIA_RESULT_MARKER = '__MEDIA_RESULT__';

export function createImageGenMcpServer(sessionId?: string, workingDirectory?: string, imageAgentMode?: boolean) {
  return createSdkMcpServer({
    name: 'codepilot-image-gen',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_generate_image',
        'Generate an image using Gemini. The generated image will automatically appear inline in the chat and be saved to the media library. Use this when the user asks you to create, draw, or generate an image. Write prompts in English for best results.',
        {
          prompt: z.string().describe('Detailed image generation prompt in English'),
          aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().describe('Aspect ratio. Only pass if user explicitly requests a specific ratio. Do NOT default to 1:1 — omit to let backend decide.'),
          imageSize: z.enum(['1K', '2K', '4K']).optional().describe('Output resolution — parameter name is "imageSize" (NOT "resolution"). Only pass if user explicitly requests. Do NOT default to 1K.'),
          referenceImagePaths: z.array(z.string()).optional().describe('Paths to reference images for style/content guidance'),
          count: z.number().min(1).max(4).optional().describe('Number of images to generate in parallel (1-4). Default 1. Use when user requests multiple images.'),
        },
        async ({ prompt, aspectRatio, imageSize, referenceImagePaths, count }) => {
          // Double safety: if imageAgentMode is on, reject tool calls
          if (imageAgentMode) {
            return {
              content: [{ type: 'text' as const, text: 'Image Agent mode is active. Use image-gen-request code block instead of calling this tool.' }],
              isError: true,
            };
          }
          try {
            const numImages = Math.min(Math.max(count || 1, 1), 4);
            const genParams = {
              prompt,
              aspectRatio: aspectRatio || undefined,
              imageSize: imageSize || '4K',
              referenceImagePaths,
              sessionId,
              cwd: workingDirectory,
            };

            if (numImages === 1) {
              // Single image — original logic
              const result = await generateSingleImage(genParams);

              const mediaInfo = result.images.map(img => ({
                type: 'image' as const,
                mimeType: img.mimeType,
                localPath: img.localPath,
                mediaId: result.mediaGenerationId,
              }));

              const textResult = [
                `Image generated successfully (${result.elapsedMs}ms).`,
                `Local paths: ${result.images.map(img => img.localPath).join(', ')}`,
                `${MEDIA_RESULT_MARKER}${JSON.stringify(mediaInfo)}`,
              ].join('\n');

              return {
                content: [{ type: 'text' as const, text: textResult }],
              };
            }

            // Multiple images — parallel execution
            const results = await Promise.allSettled(
              Array.from({ length: numImages }, () => generateSingleImage(genParams))
            );

            const allMediaInfo: Array<{ type: 'image'; mimeType: string; localPath: string; mediaId: string }> = [];
            const allPaths: string[] = [];
            const errors: string[] = [];

            for (const r of results) {
              if (r.status === 'fulfilled') {
                for (const img of r.value.images) {
                  allMediaInfo.push({
                    type: 'image',
                    mimeType: img.mimeType,
                    localPath: img.localPath,
                    mediaId: r.value.mediaGenerationId,
                  });
                  allPaths.push(img.localPath);
                }
              } else {
                errors.push(r.reason?.message || 'Generation failed');
              }
            }

            if (allMediaInfo.length === 0) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: errors.join('; ') || 'No images generated' }) }],
                isError: true,
              };
            }

            const textResult = [
              `${allMediaInfo.length}/${numImages} images generated successfully.`,
              `Local paths: ${allPaths.join(', ')}`,
              `${MEDIA_RESULT_MARKER}${JSON.stringify(allMediaInfo)}`,
            ].join('\n');

            return {
              content: [{ type: 'text' as const, text: textResult }],
            };
          } catch (error) {
            const message = NoImageGeneratedError.isInstance(error)
              ? 'Image generation succeeded but no image was returned by the model. Try a different prompt.'
              : error instanceof Error ? error.message : 'Image generation failed';
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
