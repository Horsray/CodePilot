import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';

export async function POST(request: NextRequest) {
  try {
    const { path: targetPath, recursive } = await request.json();

    if (!targetPath) {
      return NextResponse.json(
        { error: '缺少文件路径' },
        { status: 400 }
      );
    }

    // 安全检查：确保路径在允许的目录下
    const homeDir = process.env.HOME || '/Users/horsray';
    const allowedDirs = [
      homeDir,
      '/Users/horsray/Documents',
      '/Users/horsray/Desktop',
      '/Users/horsray/Downloads',
    ];

    const isAllowed = allowedDirs.some(dir => targetPath.startsWith(dir));
    if (!isAllowed) {
      return NextResponse.json(
        { error: '不允许删除此路径的文件' },
        { status: 403 }
      );
    }

    // 检查文件/目录是否存在
    try {
      await fs.access(targetPath);
    } catch {
      return NextResponse.json(
        { error: '文件或目录不存在' },
        { status: 404 }
      );
    }

    // 执行删除
    if (recursive) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }

    return NextResponse.json({
      success: true,
      message: '删除成功',
    });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '删除失败'
      },
      { status: 500 }
    );
  }
}
