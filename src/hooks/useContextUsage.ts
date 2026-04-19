import { useMemo } from 'react';
import type { Message } from '@/types';
import { getContextWindow } from '@/lib/model-context';

export interface ContextUsageData {
  modelName: string;
  contextWindow: number | null;
  /** Actual token usage from the last API response */
  used: number;
  /** Ratio of actual usage to context window */
  ratio: number;
  /** Estimated next-turn token usage (input + output + ~200 for new message overhead) */
  estimatedNextTurn: number;
  /** Ratio of estimated next-turn usage to context window */
  estimatedNextRatio: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  hasData: boolean;
  /** Warning state based on the higher of actual/estimated ratio */
  state: 'normal' | 'warning' | 'critical';
  /** Whether a session summary (compression) is active */
  hasSummary: boolean;
}

export function useContextUsage(
  messages: Message[],
  modelName: string,
  options?: { context1m?: boolean; hasSummary?: boolean },
): ContextUsageData {
  return useMemo(() => {
    const contextWindow = getContextWindow(modelName, { context1m: options?.context1m });
    const noData: ContextUsageData = {
      modelName,
      contextWindow,
      used: 0,
      ratio: 0,
      estimatedNextTurn: 0,
      estimatedNextRatio: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      hasData: false,
      state: 'normal',
      hasSummary: options?.hasSummary || false,
    };

    // Find the last assistant message with token_usage
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant' || !msg.token_usage) continue;

      try {
        const usage = typeof msg.token_usage === 'string'
          ? JSON.parse(msg.token_usage)
          : msg.token_usage;

        const inputTokens = usage.input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreation = usage.cache_creation_input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const contextInputTokens = usage.context_input_tokens || inputTokens;
        const used = contextInputTokens + cacheRead + cacheCreation;
        const ratio = contextWindow ? used / contextWindow : 0;

        // Estimate next turn: current input context + this turn's output + ~200 token overhead for a new user message
        const estimatedNextTurn = used + outputTokens + 200;
        const estimatedNextRatio = contextWindow ? estimatedNextTurn / contextWindow : 0;

        // Warning state uses the higher of actual and estimated ratios
        const effectiveRatio = Math.max(ratio, estimatedNextRatio);
        let state: 'normal' | 'warning' | 'critical' = 'normal';
        if (effectiveRatio >= 0.95) state = 'critical';
        else if (effectiveRatio >= 0.8) state = 'warning';

        return {
          modelName,
          contextWindow,
          used,
          ratio,
          estimatedNextTurn,
          estimatedNextRatio,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          outputTokens,
          hasData: true,
          state,
          hasSummary: options?.hasSummary || false,
        };
      } catch {
        continue;
      }
    }

    return noData;
  }, [messages, modelName, options?.context1m, options?.hasSummary]);
}
