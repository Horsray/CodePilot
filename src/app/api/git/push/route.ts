import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, targetBranch } = await req.json();
    if (!cwd) {
      return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }

    if (targetBranch) {
      await gitService.pushToBranch(cwd, targetBranch);
    } else {
      await gitService.push(cwd);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 }
    );
  }
}
