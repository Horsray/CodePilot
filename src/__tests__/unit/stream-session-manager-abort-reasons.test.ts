import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

describe('stream-session-manager abort reasons', () => {
  let originalFetch: typeof global.fetch | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      Reflect.deleteProperty(globalThis as Record<string, unknown>, 'fetch');
    }
    mock.restoreAll();
  });

  it('silently completes replaced streams instead of marking them stopped', async () => {
    const neverResolvingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    };

    global.fetch = mock.fn(neverResolvingFetch) as typeof global.fetch;

    const manager = await import('../../lib/stream-session-manager');

    manager.startStream({
      sessionId: 'session-replaced',
      content: 'first',
      mode: 'code',
      model: 'sonnet',
      providerId: 'env',
    });

    manager.startStream({
      sessionId: 'session-replaced',
      content: 'second',
      mode: 'code',
      model: 'sonnet',
      providerId: 'env',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapshot = manager.getSnapshot('session-replaced');
    assert.ok(snapshot);
    assert.notEqual(snapshot?.phase, 'stopped');
    assert.notEqual(snapshot?.finalMessageContent, '\n\n*(generation stopped)*');
  });
});
