import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  try {
    const branches = await gitService.getBranches(cwd);
    return NextResponse.json({ branches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get branches' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  const branch = req.nextUrl.searchParams.get('branch');
  if (!cwd || !branch) {
    return NextResponse.json({ error: 'cwd and branch are required' }, { status: 400 });
  }

  try {
    await gitService.deleteBranch(cwd, branch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete branch' },
      { status: 500 }
    );
  }
}
