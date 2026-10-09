import type { NativePermissionResult } from './types/agent-types';
import { resolvePermissionRequest as dbResolvePermission, getPermissionRequest } from './db';

// Use our own type. SDK path casts to this at the boundary.
type PermissionResult = NativePermissionResult;

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  toolInput: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  intervalId?: ReturnType<typeof setInterval>;
  abortListener?: () => void;
  signal?: AbortSignal;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1000; // 1 second

/**
 * 中文注释：注册待审批请求时的可选行为开关。
 *
 * `interactive` 用于把「等人工输入」的请求从墙钟超时里摘出来 —— 见字段说明。
 */
export interface PendingPermissionOptions {
  /**
   * 中文注释：交互式人工输入请求（AskUserQuestion / ExitPlanMode）。
   *
   * 这类请求的存在意义就是「等用户操作」（permission-checker 里列为
   * ALWAYS_ASK_TOOLS），等待时长天然可达几分钟到几小时。此前统一套用
   * 5 分钟 TIMEOUT_MS，导致用户切走一会儿回来，卡片已被系统自动拒绝、
   * 本轮直接结束（表现为「切窗口回来选项卡片就没了」）。
   *
   * 传 true 则不设墙钟自动拒绝，只由以下任一方式结束：
   *   1. 用户作答（POST /api/chat/permission 命中内存，或 DB 轮询发现）
   *   2. signal 触发（流真正终止：手动停止 / 会话被替换 / 连接断开）
   *   3. 进程退出（内存随之释放）
   */
  interactive?: boolean;
  /**
   * 中文注释：流生命周期信号。仅在「这一轮确实不会再继续」时触发
   * （用户手动停止、会话被替换、SSE 连接断开），用于释放悬挂的等待，
   * 避免内存里的 pending 条目泄漏。
   *
   * 注意：不要传会在「等待期间」误触发的信号（如前端 idle 超时对应的
   * abortController）——那会让交互式等待重新变得不可靠。
   */
  signal?: AbortSignal;
}

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
 * Returns a Promise that resolves when the user responds, when the stream
 * terminates (via `signal`), or — for non-interactive requests — after TIMEOUT_MS.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
  options: PendingPermissionOptions = {},
): Promise<PermissionResult> {
  const { interactive = false, signal } = options;
  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let abortListener: (() => void) | null = null;

    // 清理函数：清掉两个计时器 + 解绑 signal 监听，并从 map 移除。
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
      map.delete(id);
    };

    const settle = (result: PermissionResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
      cleanup();
    };

    if (interactive) {
      // 中文注释：交互式请求不设墙钟自动拒绝 —— 用户离开多久都该等。
      console.log(`[permission-registry] ${id} registered as interactive (no auto-deny timeout)`);
    } else {
      // Per-request independent timer: auto-deny after TIMEOUT_MS.
      timer = setTimeout(() => {
        if (!map.has(id)) return;
        console.warn(`[permission-registry] Permission request ${id} timed out after ${TIMEOUT_MS / 1000}s`);
        settle({ behavior: 'deny', message: 'Permission request timed out' });
        try {
          dbResolvePermission(id, 'timeout', { message: 'Permission request timed out' });
        } catch {
          // DB write failure should not affect in-memory path
        }
      }, TIMEOUT_MS);
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    }

    // Poll the database to support cross-worker resolution
    intervalId = setInterval(() => {
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
          settle(result);
        }
      } catch (e) {
        // ignore DB polling errors
      }
    }, POLL_INTERVAL_MS);
    if (typeof intervalId === 'object' && 'unref' in intervalId) {
      (intervalId as NodeJS.Timeout).unref();
    }

    // 流生命周期：流确实终止时释放悬挂的等待，避免 SDK 与内存条目一起僵死。
    if (signal) {
      abortListener = () => {
        console.log(`[permission-registry] Stream terminated while ${id} was pending — releasing waiter`);
        settle({ behavior: 'deny', message: 'Stream ended while waiting for user input' });
        try {
          dbResolvePermission(id, 'aborted', { message: 'Stream ended while waiting for user input' });
        } catch {
          // DB write failure should not affect in-memory path
        }
      };
      if (signal.aborted) {
        abortListener();
      } else {
        signal.addEventListener('abort', abortListener);
      }
    }

    // signal 若已触发（上面同步 settle 过），就不要再登记，否则 map 里会留下死条目。
    if (settled) return;

    map.set(id, {
      resolve: settle,
      createdAt: Date.now(),
      toolInput,
      timer,
      intervalId: intervalId ?? undefined,
      abortListener: abortListener ?? undefined,
      signal,
    });
  });
}

/**
 * Register an interactive waiter before announcing it to another process.
 *
 * The permission response endpoint is allowed to run as soon as the browser
 * receives its SSE event.  Announcing first leaves a small but real window in
 * which the endpoint persists the answer but cannot wake this SDK turn because
 * the in-memory waiter does not exist yet.  Keeping the ordering here makes
 * the contract explicit and lets callers use one operation for both steps.
 */
export function registerPendingPermissionThenNotify(
  id: string,
  toolInput: Record<string, unknown>,
  options: PendingPermissionOptions,
  notify: () => void,
): Promise<PermissionResult> {
  const pending = registerPendingPermission(id, toolInput, options);
  notify();
  return pending;
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
