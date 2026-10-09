import { NextRequest, NextResponse } from 'next/server';
import { getRecentPerfTraces } from '@/lib/perf-trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const traceId = request.nextUrl.searchParams.get('traceId');
  const limitParam = Number(request.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
  const traces = getRecentPerfTraces(limit);

  // 中文注释：支持按 traceId 精确过滤，便于复盘某一次慢请求的服务端链路。
  const filtered = traceId
    ? traces.filter(trace => trace.id === traceId)
    : traces;

  return NextResponse.json({
    traces: filtered,
  });
}
