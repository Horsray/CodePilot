import { streamText, generateText } from 'ai';
import { createModel } from './ai-provider';

export interface StreamTextParams {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

/**
 * Stream text from the user's current provider.
 * Returns an async iterable of text chunks.
 *
 * Provider resolution is fully delegated to ai-provider.ts → provider-resolver.ts.
 * No fallback logic here — the resolver's chain (explicit → session → global default → env)
 * is the single source of truth.
 *
 * NOTE: Do NOT expand model aliases (sonnet/opus/haiku) here.
 * toAiSdkConfig() resolves model IDs through the provider's availableModels catalog,
 * which uses the short alias as modelId. Expanding aliases would break that lookup
 * for SDK proxy providers (Kimi, GLM, MiniMax, etc.) that expect short aliases.
 */
export async function* streamTextFromProvider(params: StreamTextParams): AsyncIterable<string> {
  let languageModel: ReturnType<typeof createModel>['languageModel'];
  try {
    const result = createModel({
      providerId: params.providerId,
      model: params.model,
    });
    languageModel = result.languageModel;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[text-generator] createModel failed:', {
      providerId: params.providerId || '(env)',
      model: params.model,
      error: errMsg,
    });
    throw err;
  }

  const result = streamText({
    model: languageModel,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Uses generateText() instead of streamText() to get the full result including
 * text, reasoning, finishReason, and usage — avoiding the issue where textStream
 * is empty when the model outputs only thinking/reasoning tokens.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  let languageModel: ReturnType<typeof createModel>['languageModel'];
  try {
    const result = createModel({
      providerId: params.providerId,
      model: params.model,
    });
    languageModel = result.languageModel;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[text-generator] createModel failed:', {
      providerId: params.providerId || '(env)',
      model: params.model,
      error: errMsg,
    });
    throw err;
  }

  const result = await generateText({
    model: languageModel,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  // 中文注释：通过 unknown 中间层访问 reasoning 属性，
  // 不同版本 AI SDK 的 GenerateTextResult 类型定义可能不包含 reasoning。
  const resultAny = result as unknown as Record<string, unknown>;

  // Debug: log full result metadata to diagnose empty responses
  if (!result.text?.trim()) {
    console.warn('[text-generator] generateText returned empty text:', {
      providerId: params.providerId || '(env)',
      model: params.model,
      finishReason: result.finishReason,
      textLength: result.text?.length || 0,
      reasoningLength: typeof resultAny.reasoning === 'string' ? resultAny.reasoning.length : 0,
      usage: result.usage,
    });
  }

  // Prefer text; fall back to reasoning if text is empty
  // (some models put everything in reasoning when thinking is enabled)
  const text = result.text?.trim();
  if (text) return text;

  if (typeof resultAny.reasoning === 'string' && resultAny.reasoning.trim()) {
    console.log('[text-generator] Using reasoning as fallback text');
    return resultAny.reasoning.trim();
  }

  return '';
}
