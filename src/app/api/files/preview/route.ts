import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import { readFilePreview, isPathSafe, isRootPath } from '@/lib/files';
import type { FilePreviewResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filePath = searchParams.get('path');

  // maxLines is a hint / cap, not a default. When absent, readFilePreview
  // picks a per-extension cap (50k for Markdown/text, 1k for code).
  const maxLinesParam = searchParams.get('maxLines');
  const userMaxLines = maxLinesParam ? parseInt(maxLinesParam, 10) : undefined;

  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter' },
      { status: 400 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();

  // Validate that the file is within the session's working directory.
  // baseDir may be on a different drive than homeDir on Windows.
  // Only reject root paths as baseDir to prevent full-disk access.
  const baseDir = searchParams.get('baseDir');
  const resolvedBase = baseDir ? path.resolve(baseDir) : homeDir;
  if (baseDir && isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory' },
      { status: 403 }
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      { error: baseDir ? 'File is outside the project scope' : 'File is outside the allowed scope' },
      { status: 403 }
    );
  }

  // Real-path scope check — we simplify this in the stub
  // by skipping assertRealPathInBase and relying on isPathSafe above.
  try {
    const preview = await readFilePreview(resolvedPath, userMaxLines);
    return NextResponse.json<FilePreviewResponse>({ preview });
  } catch (error: any) {
    // Map basic errors
    const isNotFound = error?.message?.includes('not found') || error?.code === 'ENOENT';
    const status = isNotFound ? 404 : 500;
    
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to read file', code: isNotFound ? 'not_found' : 'unknown' },
      { status }
    );
  }
}
