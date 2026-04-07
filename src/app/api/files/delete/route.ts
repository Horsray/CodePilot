import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: 'Path is required' },
        { status: 400 }
      );
    }

    const resolvedPath = path.resolve(filePath);

    // 安全检查
    const forbiddenPaths = ['/System', '/usr', '/bin', '/sbin', '/etc', '/dev', '/var'];
    if (forbiddenPaths.some(fp => resolvedPath.startsWith(fp))) {
      return NextResponse.json(
        { error: 'Access to system directories is not allowed' },
        { status: 403 }
      );
    }

    // 检查文件/文件夹是否存在
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'File or directory does not exist' },
        { status: 404 }
      );
    }

    // 删除文件或文件夹
    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolvedPath);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete file/folder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
