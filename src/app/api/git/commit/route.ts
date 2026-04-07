import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, cwd } = body;

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: 'Commit message is required' },
        { status: 400 }
      );
    }

    // Get working directory from settings or use provided cwd
    const effectiveCwd = cwd && cwd.trim() !== '' ? cwd : undefined;
    const workingDir = effectiveCwd || getSetting('working_directory') || process.cwd();

    // Validate working directory
    if (!workingDir || workingDir.trim() === '') {
      return NextResponse.json(
        { error: 'Working directory is required' },
        { status: 400 }
      );
    }

    // Commit the changes
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: workingDir,
      stdio: 'pipe',
      timeout: 30000,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Git commit error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to commit';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
