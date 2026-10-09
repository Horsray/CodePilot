import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAllSessions, createSession, markSessionOpened, cleanupStaleSessions } from '@/lib/db';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;

export async function GET() {
  try {
    const now = Date.now();
    if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      cleanupStaleSessions();
      lastCleanupAt = now;
    }
    const sessions = getAllSessions();
    const response: SessionsResponse = { sessions };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

// An explicit route visit, rather than background session polling, renews history.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.opened_session_id !== 'string' || !body.opened_session_id) {
      return Response.json({ error: 'opened_session_id is required' }, { status: 400 });
    }
    if (!markSessionOpened(body.opened_session_id)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark session opened';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json();

    // Validate working_directory is provided
    if (!body.working_directory) {
      return Response.json(
        { error: 'Working directory is required', code: 'MISSING_DIRECTORY' },
        { status: 400 },
      );
    }

    // Validate directory actually exists on disk
    try {
      await fs.access(body.working_directory);
    } catch {
      return Response.json(
        { error: 'Directory does not exist', code: 'INVALID_DIRECTORY' },
        { status: 400 },
      );
    }

    const session = createSession(
      body.title,
      body.model,
      body.system_prompt,
      body.working_directory,
      body.mode,
      body.provider_id,
      body.permission_profile,
      body.team_mode,
      body.orchestration_tier,
      body.orchestration_profile_id,
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
