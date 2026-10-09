import { NextRequest, NextResponse } from 'next/server';
import { getSetting, getSession } from '@/lib/db';
import { getStatus, getDiffSummary } from '@/lib/git/service';
import type { GitChangedFile } from '@/types';
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

/** 中文注释：AI 失败时的降级文案 —— 按文件状态统计（对齐 cc-haha 的 generateFallbackCommitMessage） */
function generateFallbackMessage(files: GitChangedFile[]): string {
  const added = files.filter((f) => f.status === 'added' || f.status === 'untracked').length;
  const modified = files.filter((f) => f.status === 'modified').length;
  const deleted = files.filter((f) => f.status === 'deleted').length;
  const parts: string[] = [];
  if (added > 0) parts.push(`新增了 ${added} 个文件`);
  if (modified > 0) parts.push(`修改了 ${modified} 个文件`);
  if (deleted > 0) parts.push(`删除了 ${deleted} 个文件`);
  return parts.length > 0 ? `chore: ${parts.join('，')}` : 'chore: 常规更新';
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

    // 中文注释：diff / 文件清单统一走 lib/git/service（execFile + 10MB 缓冲，--stat -p，50K 上限）。
    // 之前用 execSync('git diff HEAD') 的默认 1MB 缓冲：大仓库（如 2.3MB 的 diff）直接抛
    // ENOBUFS → diff 为空 → 返回 400 → 前端只能回退成 "chore: 新增了 N 个文件" 的统计文案。
    // 采集方式与 cc-haha 对齐：staged / unstaged 分开取，文件清单带状态/暂存标记/增删行数。
    let changedFiles: GitChangedFile[] = [];
    let statusSummary = '';
    try {
      const status = await getStatus(workingDir);
      changedFiles = status.changedFiles;
      statusSummary = changedFiles.map((f) => {
        const staged = f.staged ? '暂存' : '未暂存';
        const adds = f.additions != null ? ` +${f.additions}` : '';
        const dels = f.deletions != null ? ` -${f.deletions}` : '';
        return `  [${f.status}] ${staged} ${f.path}${adds}${dels}`;
      }).join('\n');
    } catch {
      // Ignore error
    }

    let diff = '';
    for (const staged of [true, false]) {
      try {
        const d = await getDiffSummary(workingDir, staged);
        if (d.trim()) diff += d + '\n';
      } catch {
        // Ignore individual diff failures
      }
    }

    if (!diff.trim() && changedFiles.length === 0) {
      return NextResponse.json(
        { error: 'No changes to review' },
        { status: 400 }
      );
    }

    // 中文注释：只有未跟踪文件时 git diff 看不到内容 —— 不报错退回，把文件清单交给模型
    // （对齐 cc-haha 的 "(未检测到代码变更)" 处理，避免前端回退到统计文案）
    if (!diff.trim()) {
      diff = '(未检测到代码变更，请依据【文件变更清单】总结本次改动)';
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
        result = generateFallbackMessage(changedFiles);
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
