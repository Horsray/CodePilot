import { NextResponse } from 'next/server';
import { shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

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

    shell.openPath(targetPath);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
