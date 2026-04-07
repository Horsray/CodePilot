import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting } from '@/lib/db';
import { generateTextViaSdk } from '@/lib/claude-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cwd, action } = body;

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

    // Get git diff for staged and unstaged changes
    let diff = '';
    try {
      diff = execSync('git diff --cached', {
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

    // Truncate diff if too large to avoid token limits
    const maxDiffLength = 8000;
    const truncatedDiff = diff.length > maxDiffLength
      ? diff.slice(0, maxDiffLength) + '\n... (diff truncated)'
      : diff;

    let result = '';

    if (action === 'summary') {
      // Generate commit message via AI
      try {
        result = await generateTextViaSdk({
          system: `You are a commit message generator. Based on the git diff provided, generate a concise and descriptive commit message following conventional commits format (e.g. feat:, fix:, refactor:, docs:, chore:, style:, test:).
Rules:
- Output ONLY the commit message, nothing else
- First line should be a short summary (max 72 chars)
- If needed, add a blank line followed by bullet points for details
- Use English by default unless the diff clearly shows a Chinese project context
- Be specific about what changed, not generic`,
          prompt: `Generate a commit message for this diff:\n\n${truncatedDiff}`,
        });
      } catch (err) {
        console.error('AI commit message generation failed, falling back:', err);
        // Fallback to simple heuristic
        result = generateFallbackMessage(diff);
      }
    } else {
      // Review mode via AI
      try {
        result = await generateTextViaSdk({
          system: `You are a code reviewer. Review the git diff and provide concise, actionable feedback. Focus on:
- Potential bugs or issues
- Code quality concerns
- Security considerations
- Performance implications
Keep the review brief and practical.`,
          prompt: `Review this diff:\n\n${truncatedDiff}`,
        });
      } catch (err) {
        console.error('AI review failed, falling back:', err);
        result = generateFallbackReview(diff);
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('AI review error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate review';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

function generateFallbackMessage(diff: string): string {
  const filesChanged = diff
    .split('\n')
    .filter(line => line.startsWith('diff --git'))
    .map(line => {
      const match = line.match(/b\/(.*)$/);
      return match ? match[1] : '';
    })
    .filter(Boolean);

  const additions = (diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (diff.match(/^-[^-]/gm) || []).length;
  const fileCount = filesChanged.length;
  const fileList = filesChanged.slice(0, 3).join(', ');
  const moreFiles = fileCount > 3 ? ` and ${fileCount - 3} more` : '';

  if (additions > deletions * 2) {
    return `feat: update ${fileList}${moreFiles}`;
  } else if (deletions > additions * 2) {
    return `refactor: remove code in ${fileList}${moreFiles}`;
  } else {
    return `chore: update ${fileList}${moreFiles}`;
  }
}

function generateFallbackReview(diff: string): string {
  const filesChanged = diff
    .split('\n')
    .filter(line => line.startsWith('diff --git'))
    .map(line => {
      const match = line.match(/b\/(.*)$/);
      return match ? match[1] : '';
    })
    .filter(Boolean);

  const additions = (diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (diff.match(/^-[^-]/gm) || []).length;

  return `Code Review Summary:\n- ${filesChanged.length} file(s) changed\n- +${additions} / -${deletions} lines\n- Please review code style and potential issues manually`;
}
