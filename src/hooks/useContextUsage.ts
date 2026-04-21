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
  /**
   * Data source the caller should render next to the number.
   * Phase 5 of agent-sdk-0-2-111:
   *   - 'snapshot': SDK.getContextUsage() capture <60s old (📌)
   *     — extension point, currently has no producer in the codebase;
   *     see claude-client.ts b65c6ac for why.
   *   - 'result_usage': computed from SDKResultMessage.usage's real
   *     input_tokens + cache_read + cache_creation fields (authoritative
   *     API numbers, not char-based estimation). This is the primary
   *     source on the chat page today (📌 accuracy, not ~ estimate).
   *   - 'none': no token data yet
   */
  source: 'snapshot' | 'result_usage' | 'none';
  /** When the snapshot was taken (epoch ms). Undefined for result_usage source. */
  snapshotCapturedAt?: number;
}

const SNAPSHOT_FRESHNESS_MS = 60_000;

export function useContextUsage(
  messages: Message[],
  modelName: string,
  options?: {
    context1m?: boolean;
    hasSummary?: boolean;
    /** Explicit provider/catalog context window. Prefer this over the
     *  hardcoded alias table when the selected model already carries
     *  authoritative metadata. */
    contextWindow?: number;
    /** Resolved upstream model ID from the catalog (e.g. 'claude-opus-4-7').
     *  Required for aliases whose window depends on provider (first-party
     *  opus = 1M, Bedrock/Vertex opus = 200K). */
    upstreamModelId?: string;
    /**
     * Phase 5: SDK-authoritative snapshot from Query.getContextUsage().
     * When fresh (<60s), its totalTokens / maxTokens win over the
     * char-based estimator.
     */
    snapshot?: {
      totalTokens: number;
      maxTokens: number;
      capturedAt: number;
    };
  },
): ContextUsageData {
  return useMemo(() => {
    const explicitContextWindow =
      typeof options?.contextWindow === 'number' &&
      Number.isFinite(options.contextWindow) &&
      options.contextWindow > 0
        ? options.contextWindow
        : undefined;
    const baseContextWindow = explicitContextWindow ?? getContextWindow(modelName, {
      upstream: options?.upstreamModelId,
    });
    const contextWindow = baseContextWindow != null && options?.context1m
      ? 1_000_000
      : baseContextWindow;

    // Phase 5 — prefer a fresh SDK snapshot over the char:token estimator.
    // Freshness window matches the plan (60s). Beyond that, the estimator
    // takes over and the `source` flag flips so the UI can signal the
    // change to the user.
    const snap = options?.snapshot;
    // Date.now() is technically impure inside useMemo, but the freshness
    // check is a one-shot snapshot-vs-now comparison that naturally
    // re-evaluates on the next render when `messages` / `modelName` /
    // snapshot identity changes — which is exactly when staleness matters.
    const snapFresh = snap && (Date.now() - snap.capturedAt) < SNAPSHOT_FRESHNESS_MS;
    if (snap && snapFresh) {
      const used = snap.totalTokens;
      const max = snap.maxTokens || contextWindow || used;
      const ratio = max ? used / max : 0;
      // No estimated-next-turn from the snapshot — we assume next turn is
      // similar to current (snapshot is authoritative on "used now" but
      // can't project future output).
      return {
        modelName,
        contextWindow: max,
        used,
        ratio,
        estimatedNextTurn: used,
        estimatedNextRatio: ratio,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        hasData: true,
        state: ratio >= 0.95 ? 'critical' : ratio >= 0.8 ? 'warning' : 'normal',
        hasSummary: options?.hasSummary || false,
        source: 'snapshot',
        snapshotCapturedAt: snap.capturedAt,
      };
    }

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
      source: 'none' as const,
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
        
        // Calculate the total cumulative tokens from all steps in the API response
        const totalCumulativeInput = inputTokens + cacheRead + cacheCreation;
        
        // Use the estimated single-turn context tokens if provided by the backend (claude-client.ts)
        // This prevents massive over-reporting when an agent loop runs for 20+ steps and sums up
        // the cache reads for every single step.
        const contextInputTokens = usage.context_input_tokens !== undefined 
          ? usage.context_input_tokens 
          : totalCumulativeInput;
          
        const used = contextInputTokens;
        const ratio = contextWindow ? used / contextWindow : 0;
        
        // Scale down the display numbers for cache reads/creations so the dropdown 
        // panel numbers match the scaled single-turn context, rather than the raw 
        // 4.4M multi-step accumulation.
        let displayCacheRead = cacheRead;
        let displayCacheCreation = cacheCreation;
        
        if (usage.context_input_tokens !== undefined && totalCumulativeInput > 0 && usage.context_input_tokens < totalCumulativeInput) {
          const scale = usage.context_input_tokens / totalCumulativeInput;
          displayCacheRead = Math.round(cacheRead * scale);
          displayCacheCreation = Math.round(cacheCreation * scale);
        }

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
          cacheReadTokens: displayCacheRead,
          cacheCreationTokens: displayCacheCreation,
          outputTokens,
          hasData: true,
          state,
          hasSummary: options?.hasSummary || false,
          source: 'result_usage',
        };
      } catch {
        continue;
      }
    }

    return noData;
  }, [messages, modelName, options?.context1m, options?.hasSummary, options?.contextWindow, options?.upstreamModelId, options?.snapshot]);
}
