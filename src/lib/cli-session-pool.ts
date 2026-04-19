/**
 * cli-session-pool.ts — CLI Session Lifecycle Manager.
 *
 * The current Claude Code path keeps a persistent stream-json subprocess
 * per CodePilot chat session when possible. This legacy pool still tracks
 * SDK session IDs for resume cleanup and provides the shared close hook
 * used by delete/interrupt routes.
 */

import { updateSdkSessionId } from './db';
import { findClaudeBinary } from './platform';
import { closeAllPersistentClaudeSessions, closePersistentClaudeSession } from './persistent-claude-session';

// ── Constants ──────────────────────────────────────────────────────

export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const SESSION_IDLE_CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

// ── Internal state ──────────────────────────────────────────────────

interface SessionEntry {
  sessionId: string;
  sdkSessionId: string;
  lastActiveAt: number; // ms timestamp of last query() call
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, SessionEntry>();

/** Singleton idle check interval — started on first register */
let idleCheckTimer: ReturnType<typeof setInterval> | null = null;

// ── Pre-warm cache ──────────────────────────────────────────────────

/**
 * Cache the resolved Claude binary path so the next spawn doesn't
 * pay filesystem probe overhead. Populated on first session register.
 */
let prewarmedClaudePath: string | null = null;

export function prewarmClaudePath(): void {
  if (prewarmedClaudePath !== null) return;
  try {
    // 中文注释：预热 Claude 可执行文件路径；首次注册会话时调用，减少下一次启动前的路径探测开销。
    prewarmedClaudePath = findClaudeBinary() || null;
  } catch {
    // best effort
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Register an active SDK session. Called when streamClaude() starts
 * a query with a valid sdkSessionId.
 *
 * @returns The registered session (or existing entry if already tracked)
 */
export function registerSdkSession(
  sessionId: string,
  sdkSessionId: string,
): SessionEntry | null {
  if (!sdkSessionId) return null;

  // Pre-warm Claude path on first registration
  prewarmClaudePath();

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.sdkSessionId = sdkSessionId;
    existing.lastActiveAt = Date.now();
    // Reset idle timer
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    return existing;
  }

  const entry: SessionEntry = {
    sessionId,
    sdkSessionId,
    lastActiveAt: Date.now(),
    idleTimer: null,
  };
  sessions.set(sessionId, entry);

  // Start idle check interval if not already running
  if (!idleCheckTimer) {
    startIdleCheck();
  }

  return entry;
}

/**
 * Mark a session as active (user sent a new message).
 * Refreshes the idle timer.
 */
export function touchSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.lastActiveAt = Date.now();
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }
}

/**
 * Called when the user closes a conversation or navigates away.
 * Immediately clears the SDK session to avoid wasted resume attempts.
 */
export function closeSession(sessionId: string): void {
  closePersistentClaudeSession(sessionId);

  const entry = sessions.get(sessionId);
  if (!entry) {
    try {
      updateSdkSessionId(sessionId, '');
    } catch {
      // best effort
    }
    return;
  }

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }
  sessions.delete(sessionId);

  // Clear SDK session ID in DB so next message doesn't try to resume
  try {
    updateSdkSessionId(sessionId, '');
  } catch {
    // best effort
  }
}

/**
 * Called when a query completes. Does NOT clear the session —
 * keeps it alive for potential follow-up messages.
 * Starts the idle timer to auto-clean after inactivity.
 */
export function releaseSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;

  entry.lastActiveAt = Date.now();

  // Set idle timeout
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    // Session went idle — clear it
    sessions.delete(sessionId);
    try {
      updateSdkSessionId(sessionId, '');
    } catch {
      // best effort
    }
  }, SESSION_IDLE_TIMEOUT_MS);
}

/**
 * Get the current SDK session ID for a CodePilot session.
 */
export function getSdkSessionId(sessionId: string): string | undefined {
  return sessions.get(sessionId)?.sdkSessionId;
}

/**
 * Check if a session has meaningful conversation history
 * that warrants resume (≥3 history messages).
 */
export function needsResume(historyCount: number): boolean {
  return historyCount >= 3;
}

/**
 * Get the pre-warmed Claude binary path (if available).
 */
export function getPrewarmedClaudePath(): string | null {
  return prewarmedClaudePath;
}

/**
 * Get all currently tracked sessions.
 */
export function getActiveSessions(): Map<string, SessionEntry> {
  return sessions;
}

/**
 * Shut down the session pool — called on app exit.
 */
export function disposeSessionPool(): void {
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer);
    idleCheckTimer = null;
  }
  for (const entry of sessions.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
  }
  sessions.clear();
  closeAllPersistentClaudeSessions();
}

// ── Idle check interval ────────────────────────────────────────────

function startIdleCheck(): void {
  idleCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (entry.idleTimer) continue; // already has a timer set (released session)
      if (now - entry.lastActiveAt >= SESSION_IDLE_TIMEOUT_MS) {
        // Session went idle — clear it
        sessions.delete(id);
        try {
          updateSdkSessionId(id, '');
        } catch {
          // best effort
        }
      }
    }
    // Stop the interval if no sessions remain
    if (sessions.size === 0 && idleCheckTimer) {
      clearInterval(idleCheckTimer);
      idleCheckTimer = null;
    }
  }, SESSION_IDLE_CHECK_INTERVAL_MS);
}
