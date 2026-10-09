import type { AnthropicResponse, OpenAIResponsesResponse } from './types'

type OpenAIResponsesUsage = NonNullable<OpenAIResponsesResponse['usage']>

/**
 * 中文注释：OpenAI Responses 的 input_tokens 已包含 cached_tokens；转成 Anthropic 结构时拆开，
 * 避免后续上下文统计把缓存命中 token 重复相加。
 */
export function mapOpenAIResponsesUsage(
  usage?: OpenAIResponsesUsage | Record<string, unknown>,
): AnthropicResponse['usage'] {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  }

  const source = usage as Record<string, unknown>
  const inputTokens = readNumber(source, 'input_tokens')
  const outputTokens = readNumber(source, 'output_tokens')
  const details = readObject(source, 'input_tokens_details')
  const cachedTokens = details ? readNumber(details, 'cached_tokens') : 0

  return {
    input_tokens: Math.max(0, inputTokens - cachedTokens),
    output_tokens: outputTokens,
    cache_read_input_tokens: cachedTokens,
    cache_creation_input_tokens: 0,
  }
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function readObject(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
