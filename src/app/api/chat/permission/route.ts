import { NextRequest } from 'next/server';
import { resolvePendingPermission } from '@/lib/permission-registry';
import { getPermissionRequest, getLatestPendingPermissionRequestBySession, resolvePermissionRequest } from '@/lib/db';
import type { PermissionResponseRequest } from '@/types';
import type { NativePermissionResult } from '@/lib/types/agent-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const pending = getLatestPendingPermissionRequestBySession(sessionId);
    return new Response(
      JSON.stringify({ pending }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PermissionResponseRequest = await request.json();
    const { permissionRequestId, decision } = body;

    console.log('[permission POST] received:', {
      permissionRequestId,
      behavior: decision.behavior,
      hasUpdatedInput: !!(decision as any).updatedInput,
      updatedInputKeys: (decision as any).updatedInput ? Object.keys((decision as any).updatedInput) : [],
      hasAnswers: !!((decision as any).updatedInput?.answers),
    });

    if (!permissionRequestId || !decision) {
      return new Response(
        JSON.stringify({ error: 'permissionRequestId and decision are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate against DB before resolving in-memory
    const dbRecord = getPermissionRequest(permissionRequestId);
    if (!dbRecord) {
      console.error('[permission POST] DB record not found for:', permissionRequestId);
      return new Response(
        JSON.stringify({ error: 'Permission request not found', code: 'NOT_FOUND' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (dbRecord.status !== 'pending') {
      console.error('[permission POST] already resolved:', { permissionRequestId, status: dbRecord.status });
      return new Response(
        JSON.stringify({ error: `Permission request already resolved (status: ${dbRecord.status})`, code: 'ALREADY_RESOLVED' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let result: NativePermissionResult;
    if (decision.behavior === 'allow') {
      result = {
        behavior: 'allow',
        updatedPermissions: decision.updatedPermissions as unknown[],
        ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
      };
    } else {
      result = {
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      };
    }

    console.log('[permission POST] resolving with:', {
      behavior: result.behavior,
      hasUpdatedInput: !!result.updatedInput,
      updatedInput: result.updatedInput ? JSON.stringify(result.updatedInput).slice(0, 300) : 'none',
    });

    // Write to DB first, so polling workers can pick it up
    const dbStatus = result.behavior === 'allow' ? 'allow' as const : 'deny' as const;
    const dbOk = resolvePermissionRequest(permissionRequestId, dbStatus, {
      updatedPermissions: result.behavior === 'allow' ? (result.updatedPermissions as unknown[]) : undefined,
      updatedInput: result.behavior === 'allow' ? (result.updatedInput as Record<string, unknown>) : undefined,
      message: result.behavior === 'deny' ? result.message : undefined,
    });
    if (!dbOk) {
      console.warn('[permission POST] DB resolve returned false (likely not pending anymore):', permissionRequestId);
    }

    const found = resolvePendingPermission(permissionRequestId, result);

    if (!found) {
      console.warn('[permission POST] waiter gone for:', permissionRequestId, 'but DB was updated for polling.');
      return new Response(
        JSON.stringify({ success: true, warning: 'WAITER_GONE_BUT_DB_UPDATED' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.log('[permission POST] success:', permissionRequestId);
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[permission POST] unhandled error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
