import { generateTextFromProvider } from './text-generator';
import { resolveAuxiliaryModel } from './provider-resolver';
import { updateSessionTitle, getSession, getSetting } from './db';

const TITLE_SYSTEM_PROMPT =
  'You are a title generator. Given a user message, generate a concise title (5-15 characters, no quotes, no punctuation at the end). Reply with ONLY the title text, nothing else. Write in the same language as the user message.';
const TITLE_CALL_TIMEOUT_MS = 15_000;

/**
 * Try to generate text using a specific provider/model pair.
 * Returns the generated text, or empty string on failure.
 */
async function tryGenerate(
  providerId: string,
  model: string,
  prompt: string,
  source: string,
): Promise<{ text: string; source: string } | null> {
  if (!model) return null;
  try {
    console.log(`[title-generator] Trying ${source}:`, { providerId: providerId || 'env', model });
    const result = await generateTextFromProvider({
      providerId,
      model,
      system: TITLE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 30,
      abortSignal: AbortSignal.timeout(TITLE_CALL_TIMEOUT_MS),
    });
    if (result.trim()) {
      return { text: result, source: `${source}(${providerId || 'env'}:${model})` };
    }
    console.warn(`[title-generator] ${source} returned empty response`);
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[title-generator] ${source} failed:`, errMsg);
  }
  return null;
}

/**
 * Generate a concise conversation title using a lightweight model.
 * Called fire-and-forget before the main stream starts so the title is
 * available by the time the client fetches the session post-stream.
 *
 * Fallback chain (in priority order):
 * 1. User-configured lang_opt model (Settings → 提示词优化模型, proven reliable)
 * 2. Auxiliary small/haiku model (auto-resolved from provider config)
 * 3. Session's main model (same model the user chose for chat)
 * 4. First ~50 chars of the user message (always works)
 *
 * Returns true if an AI-generated title was written to DB, false otherwise.
 */
export async function generateConversationTitle(
  sessionId: string,
  firstUserMessage: string,
): Promise<boolean> {
  const fallbackTitle = firstUserMessage.trim().slice(0, 50) || undefined;
  const prompt = firstUserMessage.slice(0, 500);

  try {
    const session = getSession(sessionId);
    if (!session) {
      console.warn('[title-generator] Session not found:', sessionId);
      if (fallbackTitle) updateSessionTitle(sessionId, fallbackTitle);
      return false;
    }

    const mainProviderId = session.provider_id || '';
    const mainModel = session.model || '';

    let title = '';
    let titleSource = '';

    // ── Tier 1: User-configured lang_opt model ──────────────────
    // This is the same model used for prompt optimization (提示词优化).
    // Users configure it explicitly in Settings, so it's proven to work.
    const langOptProviderId = getSetting('lang_opt_provider_id') || '';
    const langOptModel = getSetting('lang_opt_model') || '';
    if (langOptProviderId && langOptModel) {
      const result = await tryGenerate(langOptProviderId, langOptModel, prompt, 'lang_opt');
      if (result) {
        title = result.text;
        titleSource = result.source;
      }
    }

    // ── Tier 2: Auxiliary small/haiku model ──────────────────────
    if (!title.trim()) {
      try {
        const auxiliary = resolveAuxiliaryModel('summarize', {
          providerId: session.provider_id || undefined,
          sessionModel: session.model || undefined,
        });
        console.log('[title-generator] Auxiliary resolution:', {
          providerId: auxiliary.providerId,
          modelId: auxiliary.modelId || '(empty)',
          source: auxiliary.source,
        });
        if (auxiliary.modelId) {
          const result = await tryGenerate(auxiliary.providerId, auxiliary.modelId, prompt, `auxiliary(${auxiliary.source})`);
          if (result) {
            title = result.text;
            titleSource = result.source;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.warn('[title-generator] Auxiliary resolution failed:', errMsg);
      }
    }

    // ── Tier 3: Session's main model ────────────────────────────
    if (!title.trim() && mainModel) {
      const result = await tryGenerate(mainProviderId, mainModel, prompt, 'main');
      if (result) {
        title = result.text;
        titleSource = result.source;
      }
    }

    // ── Clean and persist ────────────────────────────────────────
    const cleaned = title.trim().replace(/^["']|["']$/g, '').slice(0, 50);
    const finalTitle = cleaned || fallbackTitle || 'New Chat';
    const isAi = !!cleaned;

    if (finalTitle !== session.title) {
      updateSessionTitle(sessionId, finalTitle);
      console.log('[title-generator] Title updated:', {
        sessionId,
        from: session.title,
        to: finalTitle,
        source: isAi ? titleSource : 'fallback',
      });
    }

    return isAi;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[title-generator] Unexpected error:', errMsg);
    if (fallbackTitle) {
      try {
        updateSessionTitle(sessionId, fallbackTitle);
      } catch { /* final safety net */ }
    }
    return false;
  }
}

/**
 * Extract a title from the assistant's response text.
 * Used as a guaranteed fallback when the model-based title generation fails.
 * Takes the first meaningful sentence (up to 50 chars), strips markdown.
 */
export function extractTitleFromResponse(assistantText: string): string | null {
  if (!assistantText?.trim()) return null;

  // Strip markdown formatting
  let text = assistantText
    .replace(/^#{1,6}\s+/gm, '')    // headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold
    .replace(/\*(.*?)\*/g, '$1')     // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^\s*[-*+]\s+/gm, '')   // list markers
    .replace(/^\s*\d+\.\s+/gm, '')   // numbered lists
    .trim();

  if (!text) return null;

  // Take the first line that has meaningful content
  const lines = text.split('\n').filter(l => l.trim());
  const firstLine = lines[0]?.trim();
  if (!firstLine) return null;

  // Take first sentence or up to 50 chars
  const sentenceMatch = firstLine.match(/^(.{5,50})[。！？.!?\n]/);
  if (sentenceMatch) return sentenceMatch[1].trim();

  // Just take first 50 chars
  return firstLine.slice(0, 50).trim() || null;
}
