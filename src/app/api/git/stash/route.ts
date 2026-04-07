import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

// GET /api/git/stash?cwd=... — list stashes
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });

  try {
    const stashes = await gitService.stashList(cwd);
    return NextResponse.json({ stashes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list stashes' },
      { status: 500 }
    );
  }
}

// POST /api/git/stash — save, pop, or drop
export async function POST(req: NextRequest) {
  try {
    const { cwd, action, message, index } = await req.json();
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });

    switch (action) {
      case 'save': {
        const output = await gitService.stashSave(cwd, message);
        return NextResponse.json({ success: true, output });
      }
      case 'pop': {
        const output = await gitService.stashPop(cwd);
        return NextResponse.json({ success: true, output });
      }
      case 'drop': {
        if (typeof index !== 'number') {
          return NextResponse.json({ error: 'index is required for drop' }, { status: 400 });
        }
        await gitService.stashDrop(cwd, index);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Use save, pop, or drop' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stash operation failed' },
      { status: 500 }
    );
  }
}
