import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: 'Path is required' },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    
    // Check if path exists
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'Path does not exist' },
        { status: 404 }
      );
    }

    // Open in Finder (macOS)
    const stats = fs.statSync(resolvedPath);
    const targetPath = stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    
    // Use 'open' command on macOS to open Finder
    await execAsync(`open "${targetPath}"`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error opening in Finder:', error);
    return NextResponse.json(
      { error: 'Failed to open in Finder' },
      { status: 500 }
    );
  }
}
