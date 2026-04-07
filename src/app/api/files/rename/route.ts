import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { oldPath, newPath } = body;

    if (!oldPath || !newPath) {
      return NextResponse.json(
        { error: 'Both oldPath and newPath are required' },
        { status: 400 }
      );
    }

    const resolvedOldPath = path.resolve(oldPath);
    const resolvedNewPath = path.resolve(newPath);

    // 安全检查
    const forbiddenPaths = ['/System', '/usr', '/bin', '/sbin', '/etc', '/dev', '/var'];
    if (forbiddenPaths.some(fp => resolvedOldPath.startsWith(fp) || resolvedNewPath.startsWith(fp))) {
      return NextResponse.json(
        { error: 'Access to system directories is not allowed' },
        { status: 403 }
      );
    }

    // 检查源文件是否存在
    if (!fs.existsSync(resolvedOldPath)) {
      return NextResponse.json(
        { error: 'Source file does not exist' },
        { status: 404 }
      );
    }

    // 检查目标是否已存在
    if (fs.existsSync(resolvedNewPath)) {
      return NextResponse.json(
        { error: 'Destination already exists' },
        { status: 400 }
      );
    }

    // 重命名
    fs.renameSync(resolvedOldPath, resolvedNewPath);

    return NextResponse.json({ success: true, newPath: resolvedNewPath });
  } catch (error) {
    console.error('Rename file/folder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to rename';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
