import test from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshot, startStream, subscribe } from '../../lib/stream-session-manager';

const sse = (type: string, data: unknown) => `data: ${JSON.stringify({
  type,
  data: typeof data === 'string' ? data : JSON.stringify(data),
})}\n`;

function scriptedReader(chunks: Array<string | Promise<string>>) {
  let index = 0;
  return {
    read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      if (index >= chunks.length) return { done: true, value: undefined };
      const chunk = await chunks[index++];
      return { done: false, value: new TextEncoder().encode(chunk) };
    },
    cancel: async () => {},
  };
}

function installGlobals(reader: { read: () => Promise<ReadableStreamReadResult<Uint8Array>>; cancel: () => Promise<void> }) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
  globalThis.fetch = (async (url: string | URL | Request) => url === '/api/chat'
    ? { ok: true, body: { getReader: () => reader } }
    : { ok: true }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  };
}

function cleanStream(sessionId: string) {
  type LooseStream = {
    gcTimer?: ReturnType<typeof setTimeout> | null;
    idleCheckTimer?: ReturnType<typeof setInterval> | null;
    revealTimer?: ReturnType<typeof setTimeout> | null;
    pendingTimers?: Set<ReturnType<typeof setTimeout>>;
  };
  const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, LooseStream> };
  const stream = globals.__streamSessionManager__?.get(sessionId);
  if (stream?.gcTimer) clearTimeout(stream.gcTimer);
  if (stream?.idleCheckTimer) clearInterval(stream.idleCheckTimer);
  if (stream?.revealTimer) clearTimeout(stream.revealTimer);
  stream?.pendingTimers?.forEach((timer) => clearTimeout(timer));
  globals.__streamSessionManager__?.delete(sessionId);
}

function deferred() {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

// 等待本轮流真正收尾（finalize 会重新拉起 GC 定时器，若在收尾前清理会把定时器漏给进程）
async function waitForTerminal(sessionId: string) {
  for (let i = 0; i < 40; i++) {
    const phase = getSnapshot(sessionId)?.phase;
    if (phase === 'completed' || phase === 'error' || phase === 'stopped' || phase === 'aborted') return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ── 回归：工具完成后「Running 工具… (Ns)」进度状态必须清除 ────────────────
// 背景：用户报告「AskUserQuestion 已经作答了，状态栏还停在 Running 提问工具 (60s)，
// 别的什么都不刷新」。根因：onToolProgress 只设不清，且 statusText 在状态栏优先级最高
// （盖住「生成中/总结中」）——长工具（尤其等待人工作答的 AskUserQuestion）完成后，
// 这条残留文案会一直挂到本轮结束，看起来像界面卡死。

test('AskUserQuestion 作答后：工具结果到达即清除「Running 提问工具…」，本轮仍继续', async () => {
  const resultGate = deferred();
  const textGate = deferred();
  const reader = scriptedReader([
    sse('tool_use', {
      id: 'toolu_ask_1',
      name: 'mcp__codepilot-ask-user__AskUserQuestion',
      input: { questions: [{ question: '选哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }] },
    }),
    sse('tool_output', {
      _progress: true,
      tool_use_id: 'toolu_ask_1',
      tool_name: 'mcp__codepilot-ask-user__AskUserQuestion',
      elapsed_time_seconds: 60,
    }),
    resultGate.promise,
    sse('tool_result', { tool_use_id: 'toolu_ask_1', content: 'Q: 选哪个方案？\nA: A' }),
    textGate.promise,
    sse('text', '好的，按方案 A 开始修改。'),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 2, duration_ms: 1000,
      usage: { input_tokens: 1, output_tokens: 2, duration_sec: 1 }, session_id: 's-ask',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `tool-progress-clear-${Date.now()}`;
  const unsubscribe = subscribe(sessionId, () => {});
  try {
    startStream({ sessionId, content: '继续', mode: 'code', model: 'test', providerId: 'test' });
    await settle();
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'Running mcp__codepilot-ask-user__AskUserQuestion... (60s)',
      '等待人工作答期间应显示工具进度',
    );

    // 用户作答 → 提问工具返回结果；此刻模型重新开始产出，本轮仍在进行中。
    resultGate.resolve(sse('tool_result', { tool_use_id: 'toolu_ask_1', content: 'Q: 选哪个方案？\nA: A' }));
    await settle();
    const mid = getSnapshot(sessionId)!;
    assert.equal(mid.phase, 'active', '工具完成后本轮应仍处于进行中');
    assert.equal(mid.statusText, undefined, '作答/工具完成后不得再残留「Running 提问工具…」');

    textGate.resolve(sse('text', '好的，按方案 A 开始修改。'));
    await waitForTerminal(sessionId);
    const done = getSnapshot(sessionId)!;
    assert.equal(done.phase, 'completed');
    assert.equal(done.statusText, undefined, '收尾时状态栏不应残留工具进度文案');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('并行工具：一个完成时回退显示仍在跑的那个，全部完成才清空', async () => {
  const gate1 = deferred();
  const gate2 = deferred();
  const reader = scriptedReader([
    sse('tool_use', { id: 'toolu_a', name: 'Bash', input: { command: 'sleep 90' } }),
    sse('tool_use', { id: 'toolu_b', name: 'Bash', input: { command: 'npm run build' } }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_a', tool_name: 'Bash', elapsed_time_seconds: 60 }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_b', tool_name: 'Bash', elapsed_time_seconds: 30 }),
    gate1.promise,
    sse('tool_result', { tool_use_id: 'toolu_b', content: 'build ok' }),
    gate2.promise,
    sse('tool_result', { tool_use_id: 'toolu_a', content: 'done' }),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000,
      usage: { input_tokens: 1, output_tokens: 2, duration_sec: 1 }, session_id: 's-par',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `tool-progress-parallel-${Date.now()}`;
  const unsubscribe = subscribe(sessionId, () => {});
  try {
    startStream({ sessionId, content: '继续', mode: 'code', model: 'test', providerId: 'test' });
    await settle();
    assert.equal(getSnapshot(sessionId)?.statusText, 'Running Bash... (30s)', '应显示最近一次上报的进度');

    gate1.resolve(sse('tool_result', { tool_use_id: 'toolu_b', content: 'build ok' }));
    await settle();
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'Running Bash... (60s)',
      '完成的工具应从进度中移除，回退显示仍在跑的工具',
    );

    gate2.resolve(sse('tool_result', { tool_use_id: 'toolu_a', content: 'done' }));
    await waitForTerminal(sessionId);
    assert.equal(getSnapshot(sessionId)?.phase, 'completed');
    assert.equal(getSnapshot(sessionId)?.statusText, undefined, '所有工具完成后状态栏应清空');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('工具完成不得误清其它状态文案（如 CLI 整理上下文提示）', async () => {
  const gate = deferred();
  const endGate = deferred();
  const reader = scriptedReader([
    sse('tool_use', { id: 'toolu_c', name: 'Read', input: { file_path: '/tmp/a.ts' } }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_c', tool_name: 'Read', elapsed_time_seconds: 45 }),
    sse('status', { subtype: 'context_compressing', source: 'cli', percentage: 40, charsGenerated: 100 }),
    gate.promise,
    sse('tool_result', { tool_use_id: 'toolu_c', content: 'ok' }),
    endGate.promise,
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000,
      usage: { input_tokens: 1, output_tokens: 2, duration_sec: 1 }, session_id: 's-keep',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `tool-progress-keep-status-${Date.now()}`;
  const unsubscribe = subscribe(sessionId, () => {});
  try {
    startStream({ sessionId, content: '继续', mode: 'code', model: 'test', providerId: 'test' });
    await settle();
    gate.resolve(sse('tool_result', { tool_use_id: 'toolu_c', content: 'ok' }));
    await settle();
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'CLI 正在整理上下文，当前会话不会中断…',
      '工具进度让位给更新的人类可读状态后，工具完成不得把它误清掉',
    );
    endGate.resolve(sse('done', ''));
    await waitForTerminal(sessionId);
    assert.equal(getSnapshot(sessionId)?.phase, 'completed');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});
