import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

// GET /api/git/diff?cwd=...&file=...&staged=true|false
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  const file = req.nextUrl.searchParams.get('file');
  const staged = req.nextUrl.searchParams.get('staged') === 'true';

  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });

  try {
    if (file) {
      const diff = await gitService.getFileDiff(cwd, file, staged);
      return NextResponse.json({ diff });
    } else {
      const diff = await gitService.getDiffSummary(cwd, staged);
      return NextResponse.json({ diff });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get diff' },
      { status: 500 }
    );
  }
}
