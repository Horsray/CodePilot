import { NextRequest } from 'next/server';
import { listTeamRuntimeStates } from '@/lib/team-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd') || process.cwd();
  return Response.json({ jobs: listTeamRuntimeStates(cwd) });
}
