import { NextRequest } from 'next/server';
import { readTeamRuntimeEvents, readTeamRuntimeState } from '@/lib/team-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cwd = request.nextUrl.searchParams.get('cwd') || process.cwd();
  const state = readTeamRuntimeState(cwd, id);
  if (!state) {
    return Response.json({ error: 'Team job not found' }, { status: 404 });
  }
  return Response.json({
    job: state,
    events: readTeamRuntimeEvents(cwd, id),
  });
}
