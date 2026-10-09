import { NextRequest, NextResponse } from 'next/server';
import { searchMessages } from '@/lib/db';
import { createPerfTraceId } from '@/lib/perf-trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-codepilot-trace-id') || createPerfTraceId('chat-search');
  try {
    const q = (request.nextUrl.searchParams.get('q') || '').trim();
    const sessionId = (request.nextUrl.searchParams.get('sessionId') || '').trim();
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || '10');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

    if (!q) {
      return NextResponse.json(
        { error: 'q is required' },
        { status: 400, headers: { 'X-CodePilot-Trace-Id': traceId } },
      );
    }

    const results = searchMessages(q, {
      ...(sessionId ? { sessionId } : {}),
      limit,
    });

    return NextResponse.json({
      query: q,
      results,
    }, {
      headers: { 'X-CodePilot-Trace-Id': traceId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search messages';
    return NextResponse.json({ error: message }, {
      status: 500,
      headers: { 'X-CodePilot-Trace-Id': traceId },
    });
  }
}
