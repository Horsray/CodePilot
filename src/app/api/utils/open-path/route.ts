import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

// Mark as dynamic to avoid build-time static analysis of electron imports
export const dynamic = 'force-dynamic';

function openPathWithSystemShell(targetPath: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd.exe'
        : 'xdg-open';

  const args =
    process.platform === 'win32'
      ? ['/c', 'start', '', targetPath]
      : [targetPath];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
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
    let { path: targetPath } = await req.json();
    if (!targetPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

    if (targetPath.startsWith('~')) {
      targetPath = path.join(os.homedir(), targetPath.slice(1));
    }

    // If it doesn't exist, create it if it's a directory we're trying to open
    if (!fs.existsSync(targetPath)) {
      try {
        fs.mkdirSync(targetPath, { recursive: true });
      } catch (err) {
        return NextResponse.json({ error: 'Failed to create directory' }, { status: 500 });
      }
    }

    await openPathWithSystemShell(targetPath);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
