/**
 * tool-concurrency.ts — Per-session concurrency limiter for tool execution.
 *
 * Uses the parallel-safety judgment to decide which tools can run concurrently.
 * Non-parallel-safe tools acquire a session-level mutex before executing,
 * preventing write conflicts while allowing safe read-only tools to run freely.
 *
 * This bridges the gap between parallel-safety.ts (judgment only) and the
 * AI SDK's streamText which fans out tool calls to individual execute() functions.
 */

import {
  shouldParallelizeToolBatch,
  type ToolCallDescriptor,
  PARALLEL_SAFE_TOOLS,
  PATH_SCOPED_TOOLS,
} from './parallel-safety';

/**
 * Per-session semaphore that limits concurrent non-safe tool executions.
 * Safe tools (Read, Glob, Grep, etc.) bypass the semaphore entirely.
 */
class SessionToolSemaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      let released = false;
      return () => {
        if (released) return;
        released = false;
        this.running--;
        const next = this.queue.shift();
        if (next) next();
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running--;
          const next = this.queue.shift();
          if (next) next();
        });
      });
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

// Global map of session semaphores (survives HMR via globalThis)
const GLOBAL_SEMAPHORE_KEY = '__codepilot_tool_semaphores__';

function getSemaphoreStore(): Map<string, SessionToolSemaphore> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_SEMAPHORE_KEY]) {
    g[GLOBAL_SEMAPHORE_KEY] = new Map<string, SessionToolSemaphore>();
  }
  return g[GLOBAL_SEMAPHORE_KEY] as Map<string, SessionToolSemaphore>;
}

/**
 * Get or create a semaphore for a session.
 * Non-safe tools will serialize through this semaphore.
 */
export function getSessionSemaphore(sessionId: string): SessionToolSemaphore {
  const store = getSemaphoreStore();
  if (!store.has(sessionId)) {
    store.set(sessionId, new SessionToolSemaphore(1));
  }
  return store.get(sessionId)!;
}

/**
 * Check if a tool call is safe to run without acquiring the semaphore.
 * Read-only tools and path-scoped tools with non-overlapping paths are safe.
 */
export function isToolConcurrencySafe(toolName: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(toolName);
}

/**
 * Check if a tool is path-scoped (Read/Write/Edit).
 * These need path-level dedup but can run concurrently if paths differ.
 */
export function isToolPathScoped(toolName: string): boolean {
  return PATH_SCOPED_TOOLS.has(toolName);
}

/**
 * Cleanup semaphore for a session (call on session end).
 */
export function cleanupSessionSemaphore(sessionId: string): void {
  const store = getSemaphoreStore();
  store.delete(sessionId);
}
