import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath, type } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: 'Path is required' },
        { status: 400 }
      );
    }

    // 安全检查：确保路径在允许的范围内
    const resolvedPath = path.resolve(filePath);
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/';
    
    // 禁止访问敏感目录
    const forbiddenPaths = ['/System', '/usr', '/bin', '/sbin', '/etc', '/dev', '/var'];
    if (forbiddenPaths.some(fp => resolvedPath.startsWith(fp))) {
      return NextResponse.json(
        { error: 'Access to system directories is not allowed' },
        { status: 403 }
      );
    }

    // 检查文件/文件夹是否已存在
    if (fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'File or directory already exists' },
        { status: 400 }
      );
    }

    // 创建父目录（如果不存在）
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (type === 'folder') {
      // 创建文件夹
      fs.mkdirSync(resolvedPath, { recursive: true });
      return NextResponse.json({ success: true, type: 'folder', path: resolvedPath });
    } else {
      // 创建文件
      fs.writeFileSync(resolvedPath, '', 'utf-8');
      return NextResponse.json({ success: true, type: 'file', path: resolvedPath });
    }
  } catch (error) {
    console.error('Create file/folder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
