import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * POST /api/files/paste — 将复制源拷贝到目标目录（文件树右键「粘贴」）。
 * body: { sourcePath, destDir }
 * 目标重名时自动加 " copy" / " copy 2" 后缀（对齐 Finder 复制行为）。
 */
export async function POST(request: NextRequest) {
  try {
    const { sourcePath, destDir } = await request.json();

    if (!sourcePath || !destDir || typeof sourcePath !== 'string' || typeof destDir !== 'string') {
      return NextResponse.json({ error: '缺少源路径或目标目录' }, { status: 400 });
    }

    if (!existsSync(sourcePath)) {
      return NextResponse.json({ error: '源文件不存在' }, { status: 404 });
    }

    // 目标必须是已存在的目录
    const destStat = await fs.stat(destDir).catch(() => null);
    if (!destStat?.isDirectory()) {
      return NextResponse.json({ error: '目标不是有效目录' }, { status: 400 });
    }

    // 禁止把目录复制进自己内部，否则会无限递归
    const srcResolved = path.resolve(sourcePath);
    const destResolved = path.resolve(destDir);
    if (destResolved === srcResolved || destResolved.startsWith(srcResolved + path.sep)) {
      return NextResponse.json({ error: '不能复制到自身或其子目录' }, { status: 400 });
    }

    const baseName = path.basename(srcResolved);
    let targetPath = path.join(destResolved, baseName);
    // 重名时追加 copy / copy 2 / copy 3 …
    if (existsSync(targetPath)) {
      let i = 1;
      while (true) {
        const suffix = i === 1 ? ' copy' : ` copy ${i}`;
        const ext = path.extname(baseName);
        const stem = ext ? baseName.slice(0, -ext.length) : baseName;
        targetPath = path.join(destResolved, `${stem}${suffix}${ext}`);
        if (!existsSync(targetPath)) break;
        i += 1;
      }
    }

    const srcStat = await fs.stat(srcResolved);
    if (srcStat.isDirectory()) {
      await fs.cp(srcResolved, targetPath, { recursive: true, errorOnExist: true, force: false });
    } else {
      await fs.copyFile(srcResolved, targetPath);
    }

    return NextResponse.json({ success: true, path: targetPath });
  } catch (error) {
    console.error('Paste file error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '粘贴失败' },
      { status: 500 }
    );
  }
}
