import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, paths, all } = await req.json();
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });

    if (all) {
      await gitService.unstageAll(cwd);
    } else {
      if (!paths?.length) return NextResponse.json({ error: 'paths is required' }, { status: 400 });
      await gitService.unstageFiles(cwd, paths);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unstage failed' },
      { status: 500 }
    );
  }
}
