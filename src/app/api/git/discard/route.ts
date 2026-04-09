import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, paths } = await req.json();
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: 'paths array is required' }, { status: 400 });
    }
    await gitService.discardFiles(cwd, paths);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discard failed' },
      { status: 500 }
    );
  }
}
