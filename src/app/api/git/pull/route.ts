import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd } = await req.json();
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    const output = await gitService.pull(cwd);
    return NextResponse.json({ success: true, output });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pull failed' },
      { status: 500 }
    );
  }
}
