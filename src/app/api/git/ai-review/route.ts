import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting, getSession } from '@/lib/db';
import { generateTextFromProvider } from '@/lib/text-generator';
import { generateTextViaSdk } from '@/lib/claude-client';

async function generateAiResponse(systemPrompt: string, userPrompt: string, sessionProviderId?: string, sessionModel?: string): Promise<string> {
  const langOptProviderId = getSetting('lang_opt_provider_id');
  const langOptModel = getSetting('lang_opt_model');

  // If the user has configured the "Language Optimization" model, use it exclusively
  if (langOptProviderId && langOptModel) {
    try {
      return await generateTextFromProvider({
        providerId: langOptProviderId,
        model: langOptModel,
        system: systemPrompt,
        prompt: userPrompt,
      });
    } catch (err: any) {
      console.error('Language optimization model failed:', err.message);
      throw err;
    }
  }

  // Fallback to the session provider or cc-switch
  try {
    return await generateTextFromProvider({
      providerId: sessionProviderId || '',
      model: sessionModel || '',
      system: systemPrompt,
      prompt: userPrompt,
    });
  } catch (err: any) {
    console.warn('Native provider generation failed, attempting SDK fallback:', err.message);
    return await generateTextViaSdk({
      providerId: sessionProviderId,
      model: sessionModel,
      system: systemPrompt,
      prompt: userPrompt,
    });
  }
}

function generateFallbackMessage(diff: string): string {
  const lines = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'));
  const added = lines.filter(l => l.startsWith('+')).length;
  const removed = lines.filter(l => l.startsWith('-')).length;

  if (added === 0 && removed === 0) return '常规更新：同步最新代码';
  if (added > removed * 2) return '新增了部分功能代码';
  if (removed > added) return '修复了已知问题，清理冗余代码';
  return '修改和重构了代码逻辑';
}

function generateFallbackReview(diff: string): string {
  const lines = diff.split('\n').filter(l => l.startsWith('+'));
  if (lines.length === 0) return 'No additions to review';

  let concerns = 0;
  for (const line of lines) {
    if (line.includes('TODO') || line.includes('FIXME')) concerns++;
    if (line.includes('console.log') || line.includes('debugger')) concerns++;
  }

  if (concerns > 0) {
    return `Found ${concerns} potential issue(s) in the diff:\n- TODO/FIXME comments present\n- Console.log or debugger statements found`;
  }
  return 'No obvious issues found in the diff';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cwd, action, sessionId } = body;

    // Get working directory from settings or use provided cwd
    const effectiveCwd = cwd && cwd.trim() !== '' ? cwd : undefined;
    const workingDir = effectiveCwd || getSetting('working_directory') || process.cwd();

    // Validate working directory
    if (!workingDir || workingDir.trim() === '') {
      return NextResponse.json(
        { error: 'Working directory is required' },
        { status: 400 }
      );
    }

    // Resolve model from session if provided
    let providerId: string | undefined;
    let model: string | undefined;
    if (sessionId) {
      const session = getSession(sessionId);
      if (session) {
        providerId = session.provider_id || undefined;
        model = session.model || undefined;
      }
    }

    // If the standard diff exceeds token limits or fails to yield enough information,
    // we can also grab the git status or a summary to append context.
    let diff = '';
    let statusSummary = '';
    
    try {
      // Get a short stat of all changes (staged and unstaged) to give AI an overview of the scope
      statusSummary = execSync('git status --short', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      // Ignore error
    }

    try {
      diff = execSync('git diff HEAD', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      // Ignore error
    }

    if (!diff) {
      try {
        diff = execSync('git diff', {
          cwd: workingDir,
          encoding: 'utf-8',
          timeout: 10000,
        });
      } catch {
        // Ignore error
      }
    }

    if (!diff || diff.trim() === '') {
      return NextResponse.json(
        { error: 'No changes to review' },
        { status: 400 }
      );
    }

    // Truncate diff if too large to avoid token limits, but always keep the status summary
    const maxDiffLength = 12000; // Increased limit slightly to handle 18 files better
    const truncatedDiff = diff.length > maxDiffLength
      ? diff.slice(0, maxDiffLength) + '\n... (diff truncated due to length)'
      : diff;
      
    const combinedContext = `【文件变更清单】\n${statusSummary}\n\n【详细 Diff】\n${truncatedDiff}`;

    let result = '';

    const systemPromptSummary = `你是一个专业的代码提交日志生成器。根据提供的 git diff，生成一份简洁明了的中文提交说明。
规则：
1.言简意赅的风格撰写更改日志
2.先写本次提交的总结，再依次按照顺序编写条目信息
3.使用“修改了”，“新增了”,"删除了"等语言描述变动
4.避免使用英文描述，尽量用中文表达
5.不要遗漏核心的变更文件，即使代码被截断，也要参考【文件变更清单】给出合理的推测
6.直接输出最终内容，不要包含任何多余的解释、问候或Markdown代码块包裹

严格参考以下格式输出：
feat/fix/chore/refactor: 简短的一句话总结

- 修改了 xxx 模块的 xxx 功能
- 新增了 xxx 逻辑
- 删除了 xxx 冗余代码`;

    if (action === 'summary') {
      try {
        result = await generateAiResponse(systemPromptSummary, `根据以下 diff 生成提交说明：\n\n${combinedContext}`, providerId, model);
        result = result.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').trim();
      } catch (err: any) {
        console.error('AI commit message generation failed entirely, falling back:', err.message);
        result = generateFallbackMessage(diff);
      }
    } else {
      const systemPromptReview = `You are a code reviewer. Review the git diff and provide concise, actionable feedback. Focus on:
- Potential bugs or issues
- Code quality concerns
- Security considerations
- Performance implications
Keep the review brief and practical.`;

      try {
        result = await generateAiResponse(systemPromptReview, `Review this diff:\n\n${truncatedDiff}`, providerId, model);
      } catch (err: any) {
        console.error('AI review generation failed entirely, falling back:', err.message);
        result = "Review generation failed due to an error.";
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('AI review error:', error);
    return NextResponse.json(
      { error: 'AI review failed' },
      { status: 500 }
    );
  }
}
