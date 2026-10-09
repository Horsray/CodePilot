import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { path: targetPath, newName } = await request.json();

    if (!targetPath || !newName) {
      return NextResponse.json(
        { error: '缺少文件路径或新名称' },
        { status: 400 }
      );
    }

    // 安全检查：确保路径不包含危险字符
    if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
      return NextResponse.json(
        { error: '文件名不能包含路径分隔符' },
        { status: 400 }
      );
    }

    // 计算新的完整路径
    const parentDir = path.dirname(targetPath);
    const newPath = path.join(parentDir, newName);

    // 安全检查：确保新路径和原路径在同一目录下
    if (path.dirname(newPath) !== parentDir) {
      return NextResponse.json(
        { error: '不能将文件移动到其他目录' },
        { status: 400 }
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

    // 检查新名称是否已存在
    try {
      await fs.access(newPath);
      return NextResponse.json(
        { error: '该名称已存在' },
        { status: 409 }
      );
    } catch {
      // 不存在，符合预期
    }

    // 执行重命名
    await fs.rename(targetPath, newPath);

    return NextResponse.json({
      success: true,
      message: '重命名成功',
      newPath,
    });
  } catch (error) {
    console.error('Rename file error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '重命名失败'
      },
      { status: 500 }
    );
  }
}
