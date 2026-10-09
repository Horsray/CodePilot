import { NextRequest } from 'next/server';
import { initRuntimeLog, getRecentLogs, clearLogs } from '@/lib/runtime-log';

// Ensure runtime log interceptors are installed
initRuntimeLog();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/runtime-logs — Return buffered server-side log entries.
 * Used by ConsolePanel to display server logs in the browser.
 */
export async function GET() {
  const logs = getRecentLogs();
  return Response.json({ logs });
}

/**
 * DELETE /api/runtime-logs — Clear all buffered log entries.
 */
export async function DELETE() {
  clearLogs();
  return Response.json({ ok: true });
}
