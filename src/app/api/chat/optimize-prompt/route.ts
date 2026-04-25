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

    const systemPrompt = `你是一个提示词优化专家。用户会输入一段指令，请你将其优化为更专业、结构清晰、更容易被 AI 智能体理解的提示词。

【严格输出规则】
1. 只输出优化后的提示词正文，禁止输出任何其他内容。
2. 禁止添加"优化后"、"优化结果"、"以下是优化后的提示词"等任何前缀或标签。
3. 禁止输出优化前的原文。
4. 禁止输出对比说明、修改理由、解释或总结。
5. 禁止使用 markdown 标题、引用块或代码块包裹。
6. 输出内容必须是可以直接复制发送的纯文本。
7. 如果用户原本的提示词已经足够清晰，则进行轻微润色即可。`;

    const res = await generateTextFromProvider({
      providerId,
      model,
      system: systemPrompt,
      prompt: `请优化以下提示词，只输出优化后的纯文本内容：\n\n${prompt}`,
    });

    // 后处理：剥离模型可能残留的前缀包装
    let cleaned = res.trim();
    // 去除常见前缀：优化后：、优化结果：、以下是优化后的提示词：等
    cleaned = cleaned.replace(/^(?:优化后|优化结果|以下是优化后的提示词|优化后的提示词|Optimized prompt|Here is the optimized prompt)[：:]\s*/i, '');
    // 去除首尾的 markdown 代码块包裹
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    // 去除多余的引号包裹
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
      cleaned = cleaned.slice(1, -1);
    }

    return NextResponse.json({ result: cleaned });
  } catch (error: any) {
    console.error('Prompt optimization failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to optimize prompt' },
      { status: 500 }
    );
  }
}
