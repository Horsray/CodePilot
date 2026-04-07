import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';
import { generateTextViaSdk } from '@/lib/claude-client';

export async function POST(req: NextRequest) {
  try {
    const { cwd, action } = await req.json();
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });

    // Get both staged and unstaged diffs
    let diff = '';
    try {
      const stagedDiff = await gitService.getDiffSummary(cwd, true);
      const unstagedDiff = await gitService.getDiffSummary(cwd, false);
      diff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n\n');
    } catch {
      // If no HEAD yet, try just staged
      diff = await gitService.getDiffSummary(cwd, false);
    }

    if (!diff.trim()) {
      return NextResponse.json({ error: 'No changes to review' }, { status: 400 });
    }

    if (action === 'summary') {
      const result = await generateTextViaSdk({
        system: `You are a git commit message generator. Based on the diff provided, generate a concise, conventional commit message. Follow the Conventional Commits format (e.g., feat:, fix:, refactor:, docs:, chore:). The first line should be under 72 characters. If needed, add a blank line followed by a more detailed description. Output ONLY the commit message, nothing else. Use the language that matches the code comments or variable names in the diff.`,
        prompt: `Generate a commit message for these changes:\n\n${diff}`,
      });
      return NextResponse.json({ result });
    }

    if (action === 'review') {
      const result = await generateTextViaSdk({
        system: `You are an expert code reviewer. Review the following git diff and provide actionable feedback. Focus on:
1. Potential bugs or logic errors
2. Security concerns
3. Performance issues
4. Code style and best practices
5. Missing error handling

Be concise and specific. Reference file names and line numbers when possible. Use the same language as the code comments. Format your review as a structured list with severity levels (🔴 Critical, 🟡 Warning, 🟢 Suggestion, ✅ Good).`,
        prompt: `Review these code changes:\n\n${diff}`,
      });
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: 'Invalid action. Use "summary" or "review"' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI review failed' },
      { status: 500 }
    );
  }
}
