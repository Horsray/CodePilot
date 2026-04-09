export interface BrowserConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
  url?: string;
  timestamp: string;
}

export interface BrowserSessionContext {
  sessionId: string;
  url?: string;
  title?: string;
  updatedAt: string;
  logs: BrowserConsoleEntry[];
}

const GLOBAL_BROWSER_CONTEXT_KEY = "__codepilot_browser_context_store__" as const;
const MAX_BROWSER_LOGS = 100;

function getStore(): Map<string, BrowserSessionContext> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_BROWSER_CONTEXT_KEY]) {
    globalScope[GLOBAL_BROWSER_CONTEXT_KEY] = new Map<string, BrowserSessionContext>();
  }
  return globalScope[GLOBAL_BROWSER_CONTEXT_KEY] as Map<string, BrowserSessionContext>;
}

function getOrCreateSessionContext(sessionId: string): BrowserSessionContext {
  const store = getStore();
  const existing = store.get(sessionId);
  if (existing) return existing;

  const next: BrowserSessionContext = {
    sessionId,
    updatedAt: new Date().toISOString(),
    logs: [],
  };
  store.set(sessionId, next);
  return next;
}

export function updateBrowserSessionMeta(
  sessionId: string,
  meta: { url?: string; title?: string }
): BrowserSessionContext {
  const context = getOrCreateSessionContext(sessionId);
  const next: BrowserSessionContext = {
    ...context,
    ...(meta.url ? { url: meta.url } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    updatedAt: new Date().toISOString(),
  };
  getStore().set(sessionId, next);
  return next;
}

export function appendBrowserSessionLog(
  sessionId: string,
  entry: Omit<BrowserConsoleEntry, "timestamp">
): BrowserSessionContext {
  const context = getOrCreateSessionContext(sessionId);
  const nextEntry: BrowserConsoleEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  const next: BrowserSessionContext = {
    ...context,
    updatedAt: nextEntry.timestamp,
    logs: [...context.logs, nextEntry].slice(-MAX_BROWSER_LOGS),
  };
  getStore().set(sessionId, next);
  return next;
}

export function getBrowserSessionContext(sessionId: string): BrowserSessionContext | null {
  return getStore().get(sessionId) || null;
}

export function clearBrowserSessionContext(sessionId: string): void {
  getStore().delete(sessionId);
}
