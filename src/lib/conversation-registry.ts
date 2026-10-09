import type { Query } from '@anthropic-ai/claude-agent-sdk';

const globalKey = '__activeConversations__' as const;

function getMap(): Map<string, Query> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, Query>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, Query>;
}

export function registerConversation(sessionId: string, conversation: Query): void {
  getMap().set(sessionId, conversation);
}

export function unregisterConversation(sessionId: string): void {
  getMap().delete(sessionId);
}

export function getConversation(sessionId: string): Query | undefined {
  return getMap().get(sessionId);
}

const requestControllersKey = '__activeChatRequestControllers__' as const;

function getRequestControllers(): Map<string, AbortController> {
  const globals = globalThis as Record<string, unknown>;
  if (!globals[requestControllersKey]) globals[requestControllersKey] = new Map<string, AbortController>();
  return globals[requestControllersKey] as Map<string, AbortController>;
}

/** Registers the HTTP turn controller so a manual interrupt marks cancellation first. */
export function registerRequestController(sessionId: string, controller: AbortController): () => void {
  const controllers = getRequestControllers();
  controllers.set(sessionId, controller);
  return () => {
    if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
  };
}

export function abortSessionRequest(sessionId: string): void {
  getRequestControllers().get(sessionId)?.abort('user_cancel');
}
