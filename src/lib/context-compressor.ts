/**
 * Context Compressor — automatic conversation compression engine.
 *
 * When estimated context usage exceeds 80% of the window, compresses older
 * messages into a summary stored in the session. Subsequent fallback contexts
 * use "summary + recent messages" instead of raw full history.
 *
 * Model resolution uses `resolveAuxiliaryModel('compact')` from
 * provider-resolver.ts, which gives us the 5-tier fallback chain:
 *   1. Per-task env override (AUXILIARY_COMPACT_PROVIDER/_MODEL)
 *   2. Main provider's roleModels.small (if not sdkProxyOnly)
 *   3. Main provider's roleModels.haiku
 *   4. Other non-sdkProxyOnly provider's small/haiku slot
 *   5. Main provider + main model (ultimate floor — never null)
 *
 * This was upgraded from the simpler `resolveProvider({ useCase: 'small' })`
 * call in an earlier version, which only implemented tier 2 and had no
 * cross-provider fallback for sdkProxyOnly main providers. See
 * docs/research/hermes-agent-analysis.md §3.2 and docs/exec-plans/active/
 * hermes-inspired-runtime-upgrade.md task 3.5b for the rationale.
 */

import { roughTokenEstimate } from './context-estimator';

// ── Types ────────────────────────────────────────────────────────────

export interface CompressionResult {
  summary: string;
  messagesCompressed: number;
  estimatedTokensSaved: number;
}

export interface CompressParams {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  existingSummary?: string;
  providerId?: string;
  /** Session model to use as fallback if small/haiku is unavailable */
  sessionModel?: string;
}

// ── Circuit breaker ─────────────────────────────────────────────────

const compressionFailures = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 3;

export function shouldCompress(sessionId: string): boolean {
  return (compressionFailures.get(sessionId) || 0) < MAX_CONSECUTIVE_FAILURES;
}

function recordFailure(sessionId: string): void {
  compressionFailures.set(sessionId, (compressionFailures.get(sessionId) || 0) + 1);
}

function recordSuccess(sessionId: string): void {
  compressionFailures.delete(sessionId);
}

/** Reset circuit breaker for a session (e.g., on manual /compact). */
export function resetCompressionState(sessionId: string): void {
  compressionFailures.delete(sessionId);
}

// ── Compression threshold check ─────────────────────────────────────

const COMPRESSION_THRESHOLD = 0.8; // 80% of context window

/**
 * Check whether context should be compressed based on estimated usage.
 */
export function needsCompression(
  estimatedTokens: number,
  contextWindow: number,
  sessionId: string,
): boolean {
  if (contextWindow <= 0) return false;
  if (!shouldCompress(sessionId)) return false;
  return (estimatedTokens / contextWindow) >= COMPRESSION_THRESHOLD;
}

// ── Main compression function ───────────────────────────────────────

/**
 * Compress older conversation messages into a concise summary.
 *
 * Takes messages that would be truncated by the token budget and summarizes
 * them. If an existing summary exists, incorporates it as prior context.
 */
export async function compressConversation(params: CompressParams): Promise<CompressionResult> {
  const { sessionId, messages, existingSummary, providerId, sessionModel } = params;

  if (messages.length === 0) {
    return { summary: existingSummary || '', messagesCompressed: 0, estimatedTokensSaved: 0 };
  }

  try {
    const { generateTextViaSdk } = await import('./claude-client');
    const { resolveAuxiliaryModel } = await import('./provider-resolver');
    const { normalizeMessageContent } = await import('./message-normalizer');

    // Resolve auxiliary model via the 5-tier chain introduced in task 3.2.
    // Produces { providerId, modelId, source } — never null.
    // When `source === 'main_floor'`, the chain found no small/haiku slot
    // anywhere, so compression will run on the main model (at main-model
    // cost). This is an intentional floor so compression never silently
    // fails just because no cheap model is configured.
    const auxiliary = resolveAuxiliaryModel('compact');

    // Prefer the task-level override's provider/model when it gave us one
    // that matches neither null nor the main. Otherwise we keep the
    // caller-supplied providerId so SDK subprocess routing stays stable.
    const effectiveModel = auxiliary.modelId || sessionModel || 'haiku';
    const effectiveProviderId = auxiliary.providerId !== 'env' ? auxiliary.providerId : providerId;

    if (auxiliary.source === 'main_floor') {
      console.warn(
        `[context-compressor] No cheap auxiliary model configured — ` +
        `falling back to main provider/model (${effectiveProviderId}/${effectiveModel}). ` +
        `Set AUXILIARY_COMPACT_PROVIDER + AUXILIARY_COMPACT_MODEL or configure ` +
        `roleModels.small on a non-sdkProxyOnly provider to save cost.`,
      );
    }

    // Clean messages before summarizing: strip file metadata, extract tool summaries
    const formatted = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const cleaned = normalizeMessageContent(m.role, m.content);
      const content = cleaned.length > 800 ? cleaned.slice(0, 800) + '...' : cleaned;
      return `${role}: ${content}`;
    }).join('\n\n');

    const existingSummaryBlock = existingSummary
      ? `\n\nPrevious summary of even earlier conversation:\n${existingSummary}\n`
      : '';

    const system = `You are a conversation summarizer. Produce a concise summary that preserves:
- Key decisions and conclusions
- File paths, function names, and code references mentioned
- Open tasks or action items
- Important user preferences or constraints expressed
Do NOT include greetings, filler, or restate obvious context. Write in the same language as the conversation.`;

    const prompt = `Summarize the following conversation excerpt into a concise summary (max 500 words).${existingSummaryBlock}

Conversation to summarize:
${formatted}

Summary:`;

    // SDK subprocess for transport (compatible with third-party proxies),
    // model + provider selected via resolveAuxiliaryModel's 5-tier chain.
    const result = await generateTextViaSdk({
      providerId: effectiveProviderId || undefined,
      model: effectiveModel,
      system,
      prompt,
    });

    if (!result || result.trim().length < 10) {
      console.warn('[context-compressor] Summary too short:', result?.trim().length, 'chars');
      throw new Error('Compression produced empty or too-short summary');
    }

    const summary = result.trim();
    const originalTokens = messages.reduce((sum, m) => sum + roughTokenEstimate(m.content), 0);
    const summaryTokens = roughTokenEstimate(summary);

    recordSuccess(sessionId);

    return {
      summary,
      messagesCompressed: messages.length,
      estimatedTokensSaved: Math.max(0, originalTokens - summaryTokens),
    };
  } catch (error) {
    recordFailure(sessionId);
    console.error('[context-compressor] Compression failed:', error);
    throw error;
  }
}
