import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      // No body provided, use defaults
    }
    const { cwd } = body as { cwd?: string };

    // Get working directory from settings or use provided cwd
    // Validate cwd - if it's empty string, don't use it
    const effectiveCwd = cwd && cwd.trim() !== '' ? cwd : undefined;
    const workingDir = effectiveCwd || getSetting('working_directory') || process.cwd();

    // Validate working directory
    if (!workingDir || workingDir.trim() === '') {
      return NextResponse.json(
        { error: 'Working directory is required' },
        { status: 400 }
      );
    }

    // Initialize git repository
    execSync('git init', {
      cwd: workingDir,
      stdio: 'pipe',
      timeout: 10000,
    });

    // Create initial commit if there are files
    try {
      execSync('git add .', {
        cwd: workingDir,
        stdio: 'ignore',
        timeout: 5000,
      });
      execSync('git commit -m "Initial commit"', {
        cwd: workingDir,
        stdio: 'ignore',
        timeout: 5000,
      });
    } catch {
      // No files to commit yet, that's ok
    }

    return NextResponse.json({
      success: true,
      message: 'Git repository initialized',
      path: workingDir,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to initialize repository';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
