/**
 * safe-stream.ts — Defensive wrapper for ReadableStreamDefaultController.
 *
 * Background: Several SSE streaming code paths in agent-loop.ts and
 * claude-client.ts call `controller.enqueue()` from async callbacks
 * (onStepFinish, keep-alive timers, late tool-result handlers, etc).
 * If the consumer aborts the stream, the underlying controller transitions
 * to a closed state. Subsequent enqueue() calls throw.
 */

export interface SafeStreamController<T> {
  enqueue(chunk: T): void;
  close(): void;
  error(err: unknown): void;
  readonly closed: boolean;
}

export function wrapController<T>(
  raw: ReadableStreamDefaultController<T>,
  onClosedWrite?: (kind: 'enqueue' | 'close') => void,
): SafeStreamController<T> {
  let closed = false;
  let warned = false;

  const isClosedError = (e: unknown): boolean => {
    if (!(e instanceof Error)) return false;
    return /already closed|stream is closed|controller has been (released|closed)|invalid state/i.test(e.message);
  };

  const noteClosed = (kind: 'enqueue' | 'close') => {
    closed = true;
    if (!warned && onClosedWrite) {
      warned = true;
      onClosedWrite(kind);
    }
  };

  return {
    enqueue(chunk: T): void {
      if (closed) return;
      try {
        raw.enqueue(chunk);
      } catch (e) {
        if (isClosedError(e)) {
          noteClosed('enqueue');
          return;
        }
        throw e;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        raw.close();
      } catch (e) {
        if (!isClosedError(e)) throw e;
      }
    },
    error(err: unknown): void {
      if (closed) return;
      closed = true;
      try {
        raw.error(err);
      } catch {
        // 消费者已结束时忽略后续错误。
      }
    },
    get closed(): boolean {
      return closed;
    },
  };
}
