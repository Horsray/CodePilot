import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSetting } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, name = 'origin', cwd } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'Remote URL is required' },
        { status: 400 }
      );
    }

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

    // Check if remote already exists
    let remoteExists = false;
    try {
      execSync('git remote get-url origin', { 
        cwd: workingDir, 
        stdio: 'pipe',
        timeout: 5000,
      });
      remoteExists = true;
    } catch {
      // Remote doesn't exist
    }

    // Add or update remote
    if (remoteExists) {
      execSync(`git remote set-url ${name} "${url}"`, {
        cwd: workingDir,
        stdio: 'pipe',
        timeout: 5000,
      });
    } else {
      execSync(`git remote add ${name} "${url}"`, {
        cwd: workingDir,
        stdio: 'pipe',
        timeout: 5000,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Remote '${name}' configured`,
      url,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to configure remote';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd');

    // Get working directory from settings or use provided cwd
    const workingDir = cwd || getSetting('working_directory') || process.cwd();

    // Get list of remotes
    const remotes: { name: string; url: string }[] = [];
    try {
      const output = execSync('git remote -v', {
        cwd: workingDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      const lines = output.trim().split('\n');
      const seen = new Set<string>();

      for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\S+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          remotes.push({ name: match[1], url: match[2] });
        }
      }
    } catch {
      // Not a git repo or no remotes
    }

    return NextResponse.json({ remotes });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get remotes' },
      { status: 500 }
    );
  }
}
