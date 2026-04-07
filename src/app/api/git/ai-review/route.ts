import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting } from '@/lib/db';

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
      // Try to get staged diff first
      diff = execSync('git diff --cached', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      // Ignore error
    }

    // If no staged changes, get unstaged diff
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

    // For now, return a simple summary based on the diff
    // In a real implementation, you would call an AI service here
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

    let result = '';
    if (action === 'summary') {
      // Generate a commit message based on the changes
      const fileCount = filesChanged.length;
      const fileList = filesChanged.slice(0, 3).join(', ');
      const moreFiles = fileCount > 3 ? `等${fileCount}个文件` : '';
      
      if (additions > deletions * 2) {
        result = `新增功能：修改了 ${fileList}${moreFiles}`;
      } else if (deletions > additions * 2) {
        result = `删除代码：修改了 ${fileList}${moreFiles}`;
      } else if (filesChanged.some(f => f.includes('fix') || f.includes('bug'))) {
        result = `修复问题：修改了 ${fileList}${moreFiles}`;
      } else {
        result = `代码更新：修改了 ${fileList}${moreFiles}`;
      }
    } else {
      // Review mode
      result = `代码审查结果：\n- 修改了 ${filesChanged.length} 个文件\n- 新增 ${additions} 行，删除 ${deletions} 行\n- 建议检查代码风格和潜在问题`;
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
