import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getSetting } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, cwd } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'Repository URL is required' },
        { status: 400 }
      );
    }

    // Get working directory from settings or use provided cwd
    // Validate cwd - if it's empty string, don't use it
    const effectiveCwd = cwd && cwd.trim() !== '' ? cwd : undefined;
    const workingDir = effectiveCwd || getSetting('working_directory') || process.cwd();
    
    console.log('Clone request:', { url, cwd, effectiveCwd, workingDir });
    
    // Extract repo name from URL
    const repoName = url.split('/').pop()?.replace('.git', '') || 'repo';
    const targetDir = path.join(workingDir, repoName);
    
    console.log('Target directory:', targetDir);

    // Check if target directory already exists
    if (fs.existsSync(targetDir)) {
      return NextResponse.json(
        { error: `Directory "${repoName}" already exists` },
        { status: 400 }
      );
    }

    // Clone the repository
    execSync(`git clone "${url}" "${targetDir}"`, {
      stdio: 'pipe',
      timeout: 60000,
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Repository cloned successfully',
      path: targetDir,
    });
  } catch (error) {
    console.error('Git clone error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to clone repository';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
