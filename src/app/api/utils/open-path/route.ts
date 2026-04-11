import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mark as dynamic to avoid build-time static analysis of electron imports
export const dynamic = 'force-dynamic';

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

    // Use dynamic import for electron as it only works at runtime within Electron
    const { shell } = await import('electron');
    shell.openPath(targetPath);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
