import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSnapshot, startStream, stopStream, subscribe, getUnpersistedAssistantMessages } from '../../lib/stream-session-manager';
import type { Message } from '../../types';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('manual stop retains partial output even if the reader rejects with an ordinary Error', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
  let rejectRead: (error: Error) => void = () => {};
  let readStarted: () => void = () => {};
  const pendingRead = new Promise<void>((resolve) => { readStarted = resolve; });
  let index = 0;
  const reader = {
    read: async () => {
      if (index++ === 0) return { done: false, value: new TextEncoder().encode('data: {"type":"text","data":"Visible partial answer"}\n') };
      readStarted();
      return new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => { rejectRead = reject; });
    },
    cancel: async () => {},
  };
  globalThis.fetch = (async (url: string | URL | Request) => url === '/api/chat'
    ? { ok: true, body: { getReader: () => reader } }
    : { ok: true }) as typeof fetch;
  const sessionId = `cancel-regression-${Date.now()}`;
  let finish: () => void = () => {};
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const unsubscribe = subscribe(sessionId, (event) => { if (event.type === 'completed') finish(); });
  try {
    startStream({ sessionId, content: 'hello', mode: 'code', model: 'test', providerId: 'test' });
    await pendingRead;
    stopStream(sessionId);
    rejectRead(new Error('CLI process exited after interrupt'));
    await completion;
    const snapshot = getSnapshot(sessionId)!;
    assert.equal(snapshot.phase, 'stopped');
    assert.equal(snapshot.terminalReason, 'user_cancel');
    assert.equal(snapshot.error, null);
    assert.ok(snapshot.finalMessageContent?.includes('Visible partial answer'));
    assert.ok(snapshot.finalMessageContent?.includes('任务已由用户手动中断'));
  } finally {
    unsubscribe();
    const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, { gcTimer: ReturnType<typeof setTimeout> | null }> };
    const stream = globals.__streamSessionManager__?.get(sessionId);
    if (stream?.gcTimer) clearTimeout(stream.gcTimer);
    globals.__streamSessionManager__?.delete(sessionId);
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});

test('a connection drop without a local stop reason is not reported as a user interruption', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
  let rejectRead: (error: DOMException) => void = () => {};
  let readStarted: () => void = () => {};
  const pendingRead = new Promise<void>((resolve) => { readStarted = resolve; });
  let index = 0;
  const reader = {
    read: async () => {
      if (index++ === 0) return { done: false, value: new TextEncoder().encode('data: {"type":"text","data":"Long task output"}\n') };
      readStarted();
      return new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => { rejectRead = reject; });
    },
    cancel: async () => {},
  };
  globalThis.fetch = (async (url: string | URL | Request) => url === '/api/chat'
    ? { ok: true, body: { getReader: () => reader } }
    : { ok: true }) as typeof fetch;
  const sessionId = `connection-drop-${Date.now()}`;
  let finish: () => void = () => {};
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const unsubscribe = subscribe(sessionId, (event) => { if (event.type === 'completed') finish(); });
  try {
    startStream({ sessionId, content: 'hello', mode: 'code', model: 'test', providerId: 'test' });
    await pendingRead;
    // 模拟浏览器连接断开：没有任何本地中止原因（非 manual_stop / stream_replaced / 空闲超时）
    const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, { abortController: AbortController }> };
    globals.__streamSessionManager__?.get(sessionId)?.abortController.abort();
    rejectRead(new DOMException('Stream cancelled', 'AbortError'));
    await completion;
    const snapshot = getSnapshot(sessionId)!;
    assert.equal(snapshot.terminalReason, 'connection_lost');
    assert.notEqual(snapshot.terminalReason, 'user_cancel');
    assert.ok(!snapshot.finalMessageContent?.includes('任务已由用户手动中断'));
    assert.ok(snapshot.finalMessageContent?.includes('Long task output'));
  } finally {
    unsubscribe();
    const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, { gcTimer: ReturnType<typeof setTimeout> | null }> };
    const stream = globals.__streamSessionManager__?.get(sessionId);
    if (stream?.gcTimer) clearTimeout(stream.gcTimer);
    globals.__streamSessionManager__?.delete(sessionId);
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});

test('DB reconciliation retains optimistic assistants until a persisted counterpart exists', () => {
  const message = (id: string, role: 'user' | 'assistant', content: string): Message => ({ id, session_id: 's', role, content, created_at: '2026-10-09T00:00:00Z', token_usage: null });
  const partial = message('temp-assistant-cancel', 'assistant', 'Visible output\n\n*(任务已由用户手动中断)*');
  assert.deepEqual(getUnpersistedAssistantMessages([partial], [message('u', 'user', 'hello')]), [partial]);
  assert.deepEqual(getUnpersistedAssistantMessages([partial], [message('persisted', 'assistant', partial.content)]), []);
});

test('DB reconciliation replaces stopped tool turns despite false versus absent result flags', () => {
  const message = (id: string, blocks: unknown[]): Message => ({ id, session_id: 's', role: 'assistant', content: JSON.stringify(blocks), created_at: '2026-10-09T00:00:00Z', token_usage: null });
  const tool = { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/a' } };
  const result = { type: 'tool_result', tool_use_id: 'read-1', content: 'file contents' };
  const text = { type: 'text', text: 'Visible answer\n\n*(任务已由用户手动中断)*' };
  const optimistic = message('temp-assistant-tool', [tool, result, text]);
  const persisted = message('persisted-tool', [tool, { content: 'file contents', is_error: false, tool_use_id: 'read-1', type: 'tool_result' }, text]);
  assert.deepEqual(getUnpersistedAssistantMessages([optimistic], [persisted]), []);
  assert.deepEqual(getUnpersistedAssistantMessages([optimistic], [message('other-turn', [tool, { ...result, is_error: true }, text])]), [optimistic]);
});

test('DB reconciliation matches error cards by upstream detail instead of presentation metadata', () => {
  const message = (id: string, content: string): Message => ({ id, session_id: 's', role: 'assistant', content, created_at: '2026-10-09T00:00:00Z', token_usage: null });
  const card = (explain: string, raw: string) => `\n\n\`\`\`chat-error\n${JSON.stringify({ explain, raw })}\n\`\`\``;
  const optimistic = message('temp-assistant-error', 'Visible answer' + card('余额不足', 'Credit balance is too low'));
  const persisted = message('persisted-error', JSON.stringify([
    { type: 'text', text: 'Visible answer' },
    { type: 'text', text: card('模型服务连接中断或遇到错误', 'Credit balance is too low') },
  ]));
  assert.deepEqual(getUnpersistedAssistantMessages([optimistic], [persisted]), []);
  assert.deepEqual(getUnpersistedAssistantMessages([optimistic], [message('other-error', 'Visible answer' + card('余额不足', 'Different upstream error'))]), [optimistic]);
});

test('SDK forwards original error arrays on both result paths and assistant billing errors', () => {
  const source = read('src/lib/claude-client.ts');
  assert.match(source, /errors: resultErrors/);
  assert.match(source, /errors: retryResultErrors/);
  assert.match(source, /assistantMsg\.error/);
  const route = read('src/app/api/chat/route.ts');
  assert.match(route, /resultData\.errors/);
  assert.match(route, /registerRequestController\(session_id, abortController\)/);
  assert.match(read('src/app/api/chat/interrupt/route.ts'), /abortSessionRequest\(sessionId\)/);
  assert.match(read('src/components/chat/ChatView.tsx'), /getUnpersistedAssistantMessages\(current, dbMessages\)/);
});

test('only an explicit user_cancel reason classifies an aborted SDK stream as user cancellation', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 手动中断经 interrupt 路由 → abortSessionRequest 下发 reason='user_cancel'，
  // 这是「任务已由用户手动中断」的唯一依据。
  assert.match(
    claudeClient,
    /abortController\?\.signal\.reason === 'user_cancel'/,
  );
  // 看门狗/空闲超时/连接断开等内部 abort（reason 为 AbortError 或 undefined）
  // 不得再归类为用户中断，否则长任务被超时中止会误报「用户手动中断」。
  assert.doesNotMatch(
    claudeClient,
    /abortController\?\.signal\.aborted\s*&&\s*!watchdogAborted/,
  );
});

test('manual interruption preserves tool calls in the final message snapshot', () => {
  const streamManager = read('src/lib/stream-session-manager.ts');

  assert.match(streamManager, /for \(const tool of stream\.toolUsesArray\)/);
  assert.match(streamManager, /任务已由用户手动中断/);
});

test('persisted user cancellations render as an interruption instead of an error', () => {
  const route = read('src/app/api/chat/route.ts');
  const messageItem = read('src/components/chat/MessageItem.tsx');

  assert.match(route, /abortReason !== 'user_cancel'/);
  assert.match(messageItem, /任务已由用户手动中断/);
});
