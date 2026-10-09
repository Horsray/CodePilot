import { generateTextFromProvider } from './text-generator';
import { resolveAuxiliaryModel } from './provider-resolver';
import { updateSessionTitle, getSession, getSetting } from './db';

const TITLE_SYSTEM_PROMPT =
  'You are a title generator. Output ONLY a short title (5-20 chars). No explanations, no reasoning, no thinking process, no quotes, no punctuation at end. Write in the same language as the user message.\n' +
  'BAD: "Here is a title: Help with cat images"\n' +
  'BAD: "The user wants to generate a cat photo"\n' +
  'BAD: "Let me think... Cat Image Generation"\n' +
  'GOOD: 帮助生成猫咪图片\n' +
  'GOOD: Generate cat photos';
const TITLE_CALL_TIMEOUT_MS = 30_000;

/**
 * Try to generate text using a specific provider/model pair.
 * Returns the generated text, or empty string on failure.
 */
/**
 * Strip thinking/reasoning content that may leak into the text output.
 * Some models prepend their reasoning before the actual title.
 * Heuristic: if the text looks like reasoning (long, contains thinking patterns),
 * try to extract the actual title from the output.
 */
function stripThinkingContent(text: string): string {
  const trimmed = text.trim();
  // If short enough (≤50 chars) and doesn't start with thinking patterns, it's likely the actual title
  if (trimmed.length <= 50 && !trimmed.startsWith('Here')) return trimmed;

  // Detect thinking/reasoning patterns (multilingual)
  const thinkingPatterns = /I need to|The user|Let me|I should|I'll|I will|My task|Given|First,|Looking at|Here's a think|Let's think|I'll generate|I'll create|The task|分析|用户|我需要|让我|首先|思考/i;
  const hasThinking = thinkingPatterns.test(trimmed);

  if (hasThinking) {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    // Look for a quoted title first (e.g., "猫咪图片生成")
    for (const line of lines) {
      const quoted = line.match(/[""「]([^""」]{2,30})[""」]/);
      if (quoted) return quoted[1];
    }
    // Take the last line that's short enough to be a title, skip numbered/bulleted lines
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].replace(/^[*•]\s*/, '').replace(/^\d+\.\s*/, '');
      if (line.length >= 2 && line.length <= 50 && !/^[-*•]\s/.test(lines[i])) {
        return line;
      }
    }
  }

  // If text is long but no thinking patterns detected, take first line up to 50 chars
  const firstLine = trimmed.split('\n')[0]?.trim() || '';
  if (firstLine.length <= 50) return firstLine;

  // Last resort: take first 50 chars
  return trimmed.slice(0, 50);
}

async function tryGenerate(
  providerId: string,
  model: string,
  prompt: string,
  source: string,
): Promise<{ text: string; source: string } | null> {
  if (!model) {
    console.warn(`[title-generator] ${source}: model is empty, skipping`);
    return null;
  }
  try {
    console.log(`[title-generator] Trying ${source}:`, { providerId: providerId || 'env', model, timeoutMs: TITLE_CALL_TIMEOUT_MS });
    const result = await generateTextFromProvider({
      providerId,
      model,
      system: TITLE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 200,
      abortSignal: AbortSignal.timeout(TITLE_CALL_TIMEOUT_MS),
    });
    console.log(`[title-generator] ${source} raw result:`, JSON.stringify(result?.slice(0, 200)));
    if (result.trim()) {
      const cleaned = stripThinkingContent(result);
      console.log(`[title-generator] ${source} cleaned:`, JSON.stringify(cleaned));
      if (cleaned) {
        return { text: cleaned, source: `${source}(${providerId || 'env'}:${model})` };
      }
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
  const startTime = Date.now();

  console.log('[title-generator] ═══ START ═══', {
    sessionId,
    messageLength: firstUserMessage.length,
    promptPreview: prompt.slice(0, 80),
    fallbackTitle: fallbackTitle?.slice(0, 50),
  });

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
    const langOptProviderId = getSetting('lang_opt_provider_id') || '';
    const langOptModel = getSetting('lang_opt_model') || '';
    console.log('[title-generator] Tier 1 (lang_opt):', {
      configured: !!(langOptProviderId && langOptModel),
      providerId: langOptProviderId || '(not set)',
      model: langOptModel || '(not set)',
    });
    if (langOptProviderId && langOptModel) {
      const result = await tryGenerate(langOptProviderId, langOptModel, prompt, 'lang_opt');
      if (result) {
        title = result.text;
        titleSource = result.source;
      }
    }

    // ── Tier 2: Auxiliary small/haiku model ──────────────────────
    if (!title.trim()) {
      console.log('[title-generator] Tier 2 (auxiliary): attempting resolution...');
      try {
        const auxiliary = resolveAuxiliaryModel('summarize', {
          providerId: session.provider_id || undefined,
          sessionModel: session.model || undefined,
        });
        console.log('[title-generator] Auxiliary resolved:', {
          providerId: auxiliary.providerId || '(empty)',
          modelId: auxiliary.modelId || '(empty)',
          source: auxiliary.source,
        });
        if (auxiliary.modelId) {
          const result = await tryGenerate(auxiliary.providerId, auxiliary.modelId, prompt, `auxiliary(${auxiliary.source})`);
          if (result) {
            title = result.text;
            titleSource = result.source;
          }
        } else {
          console.warn('[title-generator] Tier 2 skipped: auxiliary modelId is empty');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.warn('[title-generator] Tier 2 failed:', errMsg);
      }
    }

    // ── Tier 3: Session's main model ────────────────────────────
    if (!title.trim() && mainModel) {
      console.log('[title-generator] Tier 3 (main):', { providerId: mainProviderId || 'env', model: mainModel });
      const result = await tryGenerate(mainProviderId, mainModel, prompt, 'main');
      if (result) {
        title = result.text;
        titleSource = result.source;
      }
    } else if (!title.trim() && !mainModel) {
      console.warn('[title-generator] Tier 3 skipped: mainModel is empty');
    }

    // ── Clean and persist ────────────────────────────────────────
    const cleaned = title.trim().replace(/^["']|["']$/g, '').slice(0, 50);
    const finalTitle = cleaned || fallbackTitle || 'New Chat';
    const isAi = !!cleaned;
    const elapsed = Date.now() - startTime;

    console.log('[title-generator] ═══ RESULT ═══', {
      sessionId,
      aiTitle: cleaned || '(empty)',
      fallbackTitle: fallbackTitle?.slice(0, 50) || '(empty)',
      finalTitle,
      isAi,
      titleSource: isAi ? titleSource : 'fallback(fallbackTitle)',
      elapsedMs: elapsed,
    });

    if (finalTitle !== session.title) {
      updateSessionTitle(sessionId, finalTitle);
    }

    return isAi;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const elapsed = Date.now() - startTime;
    console.error('[title-generator] ═══ UNEXPECTED ERROR ═══', { sessionId, error: errMsg, elapsedMs: elapsed });
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
