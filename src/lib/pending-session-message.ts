import type { FileAttachment, MentionRef } from '@/types';

export interface PendingSessionMessage {
  sessionId: string;
  clientMessageId: string;
  content: string;
  files?: FileAttachment[];
  systemPromptAppend?: string;
  displayOverride?: string;
  mentions?: MentionRef[];
  createdAt: number;
}

const GLOBAL_KEY = '__codepilotPendingSessionMessages__' as const;
const STALE_MS = 5 * 60 * 1000;

function getStore(): Map<string, PendingSessionMessage> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, PendingSessionMessage>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, PendingSessionMessage>;
}

export function createClientMessageId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stagePendingSessionMessage(message: PendingSessionMessage): void {
  getStore().set(message.sessionId, message);
}

export function peekPendingSessionMessage(sessionId: string): PendingSessionMessage | null {
  const entry = getStore().get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > STALE_MS) {
    getStore().delete(sessionId);
    return null;
  }
  return entry;
}

export function consumePendingSessionMessage(sessionId: string): PendingSessionMessage | null {
  const entry = peekPendingSessionMessage(sessionId);
  if (!entry) return null;
  getStore().delete(sessionId);
  return entry;
}

export function clearPendingSessionMessage(sessionId: string): void {
  getStore().delete(sessionId);
}
