import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { generateTextFromProvider } from '@/lib/text-generator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const providerId = getSetting('lang_opt_provider_id');
    const model = getSetting('lang_opt_model');

    if (!providerId || !model) {
      return NextResponse.json(
        { error: 'Language optimization model is not configured. Please configure it in Settings -> Providers.' },
        { status: 400 }
      );
    }

    const systemPrompt = `你是一个提示词优化专家。用户会输入一段相对简略或不够清晰的指令，请你将其优化为更专业、结构清晰、更容易被 AI 智能体理解的提示词。
规则：
1. 保持用户原始意图不变。
2. 增加必要的上下文结构（如：目标、步骤、约束条件等）。
3. 直接输出优化后的提示词内容，不要包含任何多余的解释、问候或多余的标点符号。
4. 如果用户原本的提示词已经足够清晰，则进行轻微的润色即可。`;

    const res = await generateTextFromProvider({
      providerId,
      model,
      system: systemPrompt,
      prompt: `请优化以下提示词：\n\n${prompt}`,
    });

    return NextResponse.json({ result: res.trim() });
  } catch (error: any) {
    console.error('Prompt optimization failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to optimize prompt' },
      { status: 500 }
    );
  }
}
