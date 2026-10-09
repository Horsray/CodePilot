import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT DISTINCT working_directory FROM chat_sessions
       WHERE working_directory IS NOT NULL AND working_directory != ''
       ORDER BY updated_at DESC LIMIT 10`
    ).all() as { working_directory: string }[];

    // Filter to only existing directories.
    // 中文注释：用异步 stat —— 项目目录常在受保护目录（如 ~/Documents）下，同步
    // statSync 在系统权限弹窗等待响应期间会挂起整个 Node 事件循环，连带把首屏
    // 其它请求（语言设置等）一起卡住。
    const projects: string[] = [];
    for (const row of rows) {
      try {
        const stat = await fs.promises.stat(row.working_directory);
        if (stat.isDirectory()) {
          projects.push(row.working_directory);
        }
      } catch {
        // Skip non-existent directories
      }
    }

    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
