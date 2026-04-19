/**
 * 文件恢复 API - 通过 git checkout 恢复已跟踪文件，或删除未跟踪的新文件
 * POST /api/files/revert
 * Body: { paths: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paths }: { paths: string[] } = body;

    if (!paths || paths.length === 0) {
      return NextResponse.json({ error: 'No paths provided' }, { status: 400 });
    }

    const results: { path: string; status: 'reverted' | 'deleted' | 'error'; message?: string }[] = [];

    for (const filePath of paths) {
      try {
        // 检查文件是否在 git 中已跟踪
        try {
          execSync(`git ls-files --error-unmatch "${filePath}"`, { stdio: 'pipe' });
          // 文件已跟踪，使用 git checkout 恢复
          execSync(`git checkout -- "${filePath}"`, { stdio: 'pipe' });
          results.push({ path: filePath, status: 'reverted' });
        } catch {
          // 文件未跟踪，可能是新创建的文件，直接删除
          if (existsSync(filePath)) {
            unlinkSync(filePath);
            results.push({ path: filePath, status: 'deleted' });
          } else {
            results.push({ path: filePath, status: 'error', message: 'File not found' });
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ path: filePath, status: 'error', message });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Revert files error:', error);
    return NextResponse.json(
      { error: 'Failed to revert files' },
      { status: 500 }
    );
  }
}
