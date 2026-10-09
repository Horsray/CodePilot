import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

// Mark as dynamic to avoid build-time static analysis of electron imports
export const dynamic = 'force-dynamic';

// 中文注释：先拉起外部进程再返回，避免 Finder/编辑器卡顿阻塞 HTTP 响应（对齐 cc-haha handleReveal）。
function spawnDetached(command: string, args: string[], shell = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function openPathWithSystemShell(targetPath: string, reveal: boolean = false): Promise<void> {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  let command: string;
  let args: string[];

  if (isMac) {
    command = 'open';
    // open -R：在 Finder 中显示并选中该文件；open：用默认应用打开
    args = reveal ? ['-R', targetPath] : [targetPath];
  } else if (isWin) {
    command = 'explorer.exe';
    // explorer /select,<path>：在资源管理器中选中该文件
    args = reveal ? [`/select,${targetPath}`] : [targetPath];
  } else {
    // Linux 无统一 reveal，退化为打开所在目录
    command = 'xdg-open';
    args = reveal ? [path.dirname(targetPath)] : [targetPath];
  }

  return spawnDetached(command, args, isWin);
}

// 中文注释：在 Trae（国际版）中打开文件/目录，与 cc-haha handleOpenInTrae 对齐。
// macOS 用 open -a Trae 明确指定国际版；其余平台回退到 trae CLI。
function openPathInEditor(targetPath: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  if (isMac) {
    // 优先国际版 Trae，找不到再试 Trae CN
    const candidates = ['Trae', 'Trae CN'];
    const tryNext = async (): Promise<void> => {
      for (const app of candidates) {
        try {
          await spawnDetached('open', ['-a', app, targetPath]);
          return;
        } catch {
          // 该应用未安装，试下一个
        }
      }
      throw new Error('未检测到 Trae');
    };
    return tryNext();
  }

  // Windows / Linux：trae CLI
  const cli = isWin ? 'trae.exe' : 'trae';
  return spawnDetached(cli, [targetPath], isWin).catch(() => {
    throw new Error('未检测到 Trae');
  });
}

export async function POST(req: Request) {
  try {
    let { path: targetPath, reveal, editor } = await req.json();
    if (!targetPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

    if (targetPath.startsWith('~')) {
      targetPath = path.join(os.homedir(), targetPath.slice(1));
    }

    // If it doesn't exist, create it if it's a directory we're trying to open
    if (!fs.existsSync(targetPath) && !reveal && !editor) {
      try {
        fs.mkdirSync(targetPath, { recursive: true });
      } catch (err) {
        return NextResponse.json({ error: 'Failed to create directory' }, { status: 500 });
      }
    }

    if (editor) {
      await openPathInEditor(targetPath);
    } else {
      await openPathWithSystemShell(targetPath, !!reveal);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
