import { NextRequest, NextResponse } from 'next/server';
import { resolveProvider } from '@/lib/provider-resolver';
import { getSetting } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * System prompt for optimizing user prompts into structured, AI-friendly format.
 */
const PROMPT_OPTIMIZER_SYSTEM = `You are a prompt optimization expert. Your task is to transform user input into well-structured, highly detailed prompts that AI models can understand and respond to more effectively.

Follow these principles:
1. Clarify the core intent - what does the user actually want to accomplish?
2. Add specific context and constraints - background info, deadlines, quality bar, etc.
3. Define clear output format expectations - what should the response look like?
4. Include relevant role or perspective if applicable
5. Break down complex tasks into structured steps if needed
6. Add edge case handling for ambiguous situations

IMPORTANT: Output ONLY the optimized prompt in the target language (match the input language), with no preamble, explanation, or markdown formatting. Just the raw optimized prompt text.

Structure your optimization using these sections when helpful:
- 任务目标 (Task Objective)
- 背景信息 (Background Context)
- 具体要求 (Specific Requirements)
- 输出格式 (Output Format)
- 约束条件 (Constraints)

But keep it natural and conversational - don't force rigid formatting on simple requests.`;

const PROMPT_OPTIMIZER_USER_TEMPLATE_ZH = `请将以下提示词优化为 AI 更容易理解的结构化格式：

---

{{PROMPT}}

---

优化后的提示词：`;

const PROMPT_OPTIMIZER_USER_TEMPLATE_EN = `Please optimize the following prompt into a structured, AI-friendly format:

---

{{PROMPT}}

---

Optimized prompt：`;

/**
 * POST /api/prompt-optimize
 * Optimize a user prompt using AI to make it more structured and AI-friendly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, language = 'zh' } = body as {
      prompt: string;
      language?: 'zh' | 'en';
    };

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'prompt is required and must be a string' },
        { status: 400 },
      );
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
      return NextResponse.json(
        { error: 'prompt cannot be empty' },
        { status: 400 },
      );
    }

    if (trimmedPrompt.length > 10000) {
      return NextResponse.json(
        { error: 'prompt is too long (max 10000 characters)' },
        { status: 400 },
      );
    }

    // Check if optimization is disabled in settings
    const optimizationEnabled = getSetting('prompt_optimization_enabled');
    if (optimizationEnabled === 'false') {
      return NextResponse.json(
        { error: 'Prompt optimization is disabled in settings' },
        { status: 403 },
      );
    }

    // Resolve provider
    const resolved = resolveProvider({ useCase: 'default' });

    if (!resolved.hasCredentials || !resolved.provider) {
      return NextResponse.json(
        { error: 'No API provider configured. Please set up a provider in settings.' },
        { status: 400 },
      );
    }

    // Choose template based on language
    const userTemplate = language === 'en'
      ? PROMPT_OPTIMIZER_USER_TEMPLATE_EN
      : PROMPT_OPTIMIZER_USER_TEMPLATE_ZH;

    const fullPrompt = userTemplate.replace('{{PROMPT}}', trimmedPrompt);

    // Determine the actual model to use
    const model = resolved.upstreamModel || resolved.model || 'claude-sonnet-4-20250514';

    // Build the API request based on protocol
    let apiUrl: string;
    let headers: Record<string, string> = {};
    let bodyData: Record<string, unknown>;

    if (resolved.protocol === 'openai-compatible') {
      // OpenAI-compatible API
      apiUrl = `${resolved.provider.base_url}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolved.provider.api_key}`,
        ...resolved.headers,
      };
      bodyData = {
        model: model,
        messages: [
          { role: 'system', content: PROMPT_OPTIMIZER_SYSTEM },
          { role: 'user', content: fullPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      };
    } else {
      // Anthropic API
      apiUrl = `${resolved.provider.base_url}/v1/messages`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': resolved.provider.api_key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        ...resolved.headers,
      };
      bodyData = {
        model: model,
        system: PROMPT_OPTIMIZER_SYSTEM,
        messages: [
          { role: 'user', content: fullPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      };
    }

    // Make the API request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyData),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[prompt-optimize] API error:', response.status, errorText);
      return NextResponse.json(
        { error: `API error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    // Extract the optimized prompt based on protocol
    let optimizedPrompt: string;
    if (resolved.protocol === 'openai-compatible') {
      optimizedPrompt = data.choices?.[0]?.message?.content || '';
    } else {
      optimizedPrompt = data.content?.[0]?.text || '';
    }

    if (!optimizedPrompt) {
      return NextResponse.json(
        { error: 'Failed to generate optimized prompt' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      original: trimmedPrompt,
      optimized: optimizedPrompt.trim(),
    });
  } catch (error) {
    // Handle abort errors gracefully
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request was cancelled' },
        { status: 499 },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to optimize prompt';
    console.error('[prompt-optimize] Error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
