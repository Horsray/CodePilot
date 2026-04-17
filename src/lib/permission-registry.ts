import type { NativePermissionResult } from './types/agent-types';
import { resolvePermissionRequest as dbResolvePermission, getPermissionRequest } from './db';

// Use our own type. SDK path casts to this at the boundary.
type PermissionResult = NativePermissionResult;

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  toolInput: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
  intervalId?: ReturnType<typeof setInterval>;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1000; // 1 second

// Use globalThis to ensure the Map is shared across all module instances.
// In Next.js dev mode (Turbopack), different API routes may load separate
// module instances, so a module-level variable would NOT be shared.
const globalKey = '__pendingPermissions__' as const;

function getMap(): Map<string, PendingPermission> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, PendingPermission>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, PendingPermission>;
}

/**
 * Register a pending permission request.
 * Returns a Promise that resolves when the user responds or after TIMEOUT_MS.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
): Promise<PermissionResult> {
  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    // Clean up function to clear both timers
    const cleanup = () => {
      const entry = map.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        if (entry.intervalId) clearInterval(entry.intervalId);
      }
      map.delete(id);
    };

    // Per-request independent timer: auto-deny after TIMEOUT_MS.
    const timer = setTimeout(() => {
      if (map.has(id)) {
        console.warn(`[permission-registry] Permission request ${id} timed out after ${TIMEOUT_MS / 1000}s`);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
        cleanup();
        try {
          dbResolvePermission(id, 'timeout', { message: 'Permission request timed out' });
        } catch {
          // DB write failure should not affect in-memory path
        }
      }
    }, TIMEOUT_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    // Poll the database to support cross-worker resolution
    const intervalId = setInterval(() => {
      try {
        const record = getPermissionRequest(id);
        if (record && record.status !== 'pending') {
          console.log(`[permission-registry] Polled DB and found resolved status: ${record.status} for ${id}`);
          let result: PermissionResult;
          if (record.status === 'allow') {
            result = {
              behavior: 'allow',
              updatedPermissions: record.updated_permissions ? JSON.parse(record.updated_permissions) : undefined,
              ...(record.updated_input ? { updatedInput: JSON.parse(record.updated_input) } : {}),
            };
            if (!result.updatedInput) {
              result.updatedInput = toolInput; // fallback
            }
          } else {
            result = { behavior: 'deny', message: record.message || 'User denied permission' };
          }
          resolve(result);
          cleanup();
        }
      } catch (e) {
        // ignore DB polling errors
      }
    }, POLL_INTERVAL_MS);
    if (typeof intervalId === 'object' && 'unref' in intervalId) {
      (intervalId as NodeJS.Timeout).unref();
    }

    map.set(id, {
      resolve: (res) => {
        resolve(res);
        cleanup();
      },
      createdAt: Date.now(),
      toolInput,
      timer,
      intervalId,
    });
  });
}

/**
 * Resolve a pending permission request with the user's decision.
 * Returns true if the permission was found and resolved, false otherwise.
 */
export function resolvePendingPermission(
  id: string,
  result: PermissionResult,
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) {
    console.warn('[permission-registry] resolvePendingPermission: entry not found for', id);
    return false;
  }

  if (result.behavior === 'allow' && !result.updatedInput) {
    console.warn('[permission-registry] No updatedInput provided, falling back to original toolInput');
    result = { ...result, updatedInput: entry.toolInput };
  }

  console.log('[permission-registry] resolving in-memory:', {
    id,
    behavior: result.behavior,
    hasUpdatedInput: !!result.updatedInput,
  });

  // Dual-write: persist to DB before resolving in-memory
  try {
    const dbStatus = result.behavior === 'allow' ? 'allow' as const : 'deny' as const;
    dbResolvePermission(id, dbStatus, {
      updatedPermissions: result.behavior === 'allow' ? (result.updatedPermissions as unknown[]) : undefined,
      updatedInput: result.behavior === 'allow' ? (result.updatedInput as Record<string, unknown>) : undefined,
      message: result.behavior === 'deny' ? result.message : undefined,
    });
  } catch {
    // DB write failure should not affect in-memory path
  }

  entry.resolve(result);
  return true;
}
