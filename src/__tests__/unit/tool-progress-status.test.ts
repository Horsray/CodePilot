import test from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshot, startStream, subscribe } from '../../lib/stream-session-manager';

// 保留期压缩到 1.2s，避免测试真的等 30s；逻辑本身与线上一致。
const HOLD_MS = 1200;
process.env.CODEPILOT_STATUS_TEXT_HOLD_MS = String(HOLD_MS);
test.after(() => { delete process.env.CODEPILOT_STATUS_TEXT_HOLD_MS; });

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
    statusTextResetTimer?: ReturnType<typeof setTimeout> | null;
    pendingTimers?: Set<ReturnType<typeof setTimeout>>;
  };
  const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, LooseStream> };
  const stream = globals.__streamSessionManager__?.get(sessionId);
  if (stream?.gcTimer) clearTimeout(stream.gcTimer);
  if (stream?.idleCheckTimer) clearInterval(stream.idleCheckTimer);
  if (stream?.revealTimer) clearTimeout(stream.revealTimer);
  if (stream?.statusTextResetTimer) clearTimeout(stream.statusTextResetTimer);
  stream?.pendingTimers?.forEach((timer) => clearTimeout(timer));
  globals.__streamSessionManager__?.delete(sessionId);
}

function deferred() {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待条件成立（保留期到期这类计时行为用它，避免写死 sleep 时长）。 */
async function waitUntil(predicate: () => boolean, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return predicate();
}

// 等待本轮流真正收尾（finalize 会重新拉起 GC 定时器，若在收尾前清理会把定时器漏给进程）
async function waitForTerminal(sessionId: string) {
  await waitUntil(() => {
    const phase = getSnapshot(sessionId)?.phase;
    return phase === 'completed' || phase === 'error' || phase === 'stopped' || phase === 'aborted';
  }, 2000);
}

// ── 回归：工具完成的「Running 工具… (Ns)」文案如何收尾 ───────────────────
// 需求演化（两轮用户反馈）：
//   ① 只设不清 → AskUserQuestion 作答后文案残留到本轮结束，状态栏像卡死（已修）；
//   ② 工具完成即清 → 每条进度一闪而过，用户看不清刚才在跑什么（本次修）；
// 终态规则：完成后先保留展示，直到下一个状态刷新替换它；保留期（30s）内始终没有
// 新刷新，才重置为兜底文案（生成中/总结中）。

test('AskUserQuestion 作答后：文案不立刻消失，保留期满无新刷新才重置', async () => {
  const resultGate = deferred();
  const endGate = deferred();
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
    sse('text', '好的，按方案 A 开始修改。'),
    endGate.promise,
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 2, duration_ms: 1000,
      usage: { input_tokens: 1, output_tokens: 2, duration_sec: 1 }, session_id: 's-ask',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `tool-progress-hold-${Date.now()}`;
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
    await settle(250);
    const mid = getSnapshot(sessionId)!;
    assert.equal(mid.phase, 'active', '工具完成后本轮应仍处于进行中');
    assert.equal(
      mid.statusText,
      'Running mcp__codepilot-ask-user__AskUserQuestion... (60s)',
      '工具完成后文案不得瞬间消失（否则每条进度一闪而过看不清内容）',
    );

    // 保留期内没有任何新状态刷新（只有正文增量）→ 到期重置为兜底文案
    await waitUntil(() => getSnapshot(sessionId)?.statusText === undefined);
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      undefined,
      '保留期满仍无新刷新才重置，避免文案残留在状态栏',
    );

    endGate.resolve(sse('done', ''));
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

test('保留期内出现新状态刷新：立即替换为新文案，旧定时器不得清掉它', async () => {
  const gateNew = deferred();
  const endGate = deferred();
  const reader = scriptedReader([
    sse('tool_use', { id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a.ts' } }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_read', tool_name: 'Read', elapsed_time_seconds: 45 }),
    sse('tool_result', { tool_use_id: 'toolu_read', content: 'ok' }),
    gateNew.promise,
    sse('tool_use', { id: 'toolu_bash', name: 'Bash', input: { command: 'npm test' } }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_bash', tool_name: 'Bash', elapsed_time_seconds: 5 }),
    endGate.promise,
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000,
      usage: { input_tokens: 1, output_tokens: 2, duration_sec: 1 }, session_id: 's-refresh',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `tool-progress-refresh-${Date.now()}`;
  const unsubscribe = subscribe(sessionId, () => {});
  try {
    startStream({ sessionId, content: '继续', mode: 'code', model: 'test', providerId: 'test' });
    await settle();
    assert.equal(getSnapshot(sessionId)?.statusText, 'Running Read... (45s)');

    await settle(200);
    assert.equal(getSnapshot(sessionId)?.statusText, 'Running Read... (45s)', '保留期内应一直可见');

    // 保留期内下一个工具开始上报 → 新刷新替换文案
    gateNew.resolve(sse('tool_use', { id: 'toolu_bash', name: 'Bash', input: { command: 'npm test' } }));
    await settle(100);
    assert.equal(getSnapshot(sessionId)?.statusText, 'Running Bash... (5s)', '新状态刷新应替换旧文案');

    // 越过第一条文案的保留期截止点：新文案必须仍在（旧定时器已作废）
    await settle(HOLD_MS + 300);
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'Running Bash... (5s)',
      '旧文案的保留期定时器不得把新文案清掉',
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

test('并行工具：一个完成时切到仍在跑的那个，全部完成后保留期满才重置', async () => {
  const gate1 = deferred();
  const gate2 = deferred();
  const endGate = deferred();
  const reader = scriptedReader([
    sse('tool_use', { id: 'toolu_a', name: 'Bash', input: { command: 'sleep 90' } }),
    sse('tool_use', { id: 'toolu_b', name: 'Bash', input: { command: 'npm run build' } }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_a', tool_name: 'Bash', elapsed_time_seconds: 60 }),
    sse('tool_output', { _progress: true, tool_use_id: 'toolu_b', tool_name: 'Bash', elapsed_time_seconds: 30 }),
    gate1.promise,
    sse('tool_result', { tool_use_id: 'toolu_b', content: 'build ok' }),
    gate2.promise,
    sse('tool_result', { tool_use_id: 'toolu_a', content: 'done' }),
    endGate.promise,
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
      '完成的工具应从进度中移除，切到仍在跑的工具',
    );

    gate2.resolve(sse('tool_result', { tool_use_id: 'toolu_a', content: 'done' }));
    await settle(250);
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'Running Bash... (60s)',
      '全部工具完成后文案仍保留展示，不瞬间消失',
    );

    await waitUntil(() => getSnapshot(sessionId)?.statusText === undefined);
    assert.equal(getSnapshot(sessionId)?.statusText, undefined, '保留期满无新刷新才重置');

    endGate.resolve(sse('done', ''));
    await waitForTerminal(sessionId);
    assert.equal(getSnapshot(sessionId)?.phase, 'completed');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('其它状态文案（CLI 整理上下文）不受保留期机制影响', async () => {
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
    await settle(250);
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'CLI 正在整理上下文，当前会话不会中断…',
      '工具进度让位给更新的人类可读状态后，工具完成不得把它误清掉',
    );
    // 保留期机制只作用于「Running 工具…」：CLI 整理上下文这类状态不参与定时重置
    await settle(HOLD_MS + 300);
    assert.equal(
      getSnapshot(sessionId)?.statusText,
      'CLI 正在整理上下文，当前会话不会中断…',
      'CLI 整理上下文提示不应被工具保留期定时器清掉',
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
