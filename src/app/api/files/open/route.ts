import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function POST(req: NextRequest) {
  const { path, openInFinder } = await req.json();
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const platform = process.platform;
  let cmd: string;
  let args: string[] = [];

  if (platform === 'darwin') {
    // open -R: 在 Finder 中显示文件（在父文件夹中选中该文件）
    // open: 打开文件或目录
    if (openInFinder) {
      cmd = 'open';
      args = ['-R', path]; // -R 参数让 Finder 显示并选中该文件
    } else {
      cmd = 'open';
      args = [path];
    }
  } else if (platform === 'win32') {
    cmd = 'explorer';
    args = [path];
  } else {
    cmd = 'xdg-open';
    args = [path];
  }

  return new Promise<NextResponse>((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => {
      resolve(NextResponse.json({ error: err.message }, { status: 500 }));
    });
    child.on('spawn', () => {
      child.unref();
      resolve(NextResponse.json({ ok: true }));
    });
  });
}
