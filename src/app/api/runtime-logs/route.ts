import { NextRequest, NextResponse } from 'next/server';
import { clearLogs, getRecentLogs } from '@/lib/runtime-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ logs: getRecentLogs() });
}

export async function DELETE(_request: NextRequest) {
  clearLogs();
  return NextResponse.json({ success: true });
}
