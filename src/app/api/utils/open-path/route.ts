import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

// Mark as dynamic to avoid build-time static analysis of electron imports
export const dynamic = 'force-dynamic';

function openPathWithSystemShell(targetPath: string, reveal: boolean = false): Promise<void> {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  let command: string;
  let args: string[];

  if (isMac) {
    command = 'open';
    args = reveal ? ['-R', targetPath] : [targetPath];
  } else if (isWin) {
    command = 'explorer.exe';
    args = reveal ? [`/select,`, `"${targetPath}"`] : [targetPath];
  } else {
    // Linux
    command = 'xdg-open';
    args = reveal ? [path.dirname(targetPath)] : [targetPath];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: isWin // explorer.exe often needs shell on Windows when dealing with quotes
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function POST(req: Request) {
  try {
    let { path: targetPath, reveal } = await req.json();
    if (!targetPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

    if (targetPath.startsWith('~')) {
      targetPath = path.join(os.homedir(), targetPath.slice(1));
    }

    // If it doesn't exist, create it if it's a directory we're trying to open
    if (!fs.existsSync(targetPath) && !reveal) {
      try {
        fs.mkdirSync(targetPath, { recursive: true });
      } catch (err) {
        return NextResponse.json({ error: 'Failed to create directory' }, { status: 500 });
      }
    }

    await openPathWithSystemShell(targetPath, !!reveal);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
