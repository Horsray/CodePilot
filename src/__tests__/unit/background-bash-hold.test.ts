import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSnapshot, startStream, subscribe } from '../../lib/stream-session-manager';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

/** 构造与 formatSSE 一致的分片：data 一律是字符串（对象需 JSON.stringify）。 */
const sse = (type: string, data: unknown) => `data: ${JSON.stringify({
  type,
  data: typeof data === 'string' ? data : JSON.stringify(data),
})}\n`;

/**
 * 构造按脚本回放 SSE 分片的 reader。脚本元素可以是字符串（立即返回）或
 * Promise（等待放行）——后者用来模拟「后台任务仍在运行时流保持打开」。
 */
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
  const globals = globalThis as unknown as { __streamSessionManager__?: Map<string, { gcTimer: ReturnType<typeof setTimeout> | null }> };
  const stream = globals.__streamSessionManager__?.get(sessionId);
  if (stream?.gcTimer) clearTimeout(stream.gcTimer);
  globals.__streamSessionManager__?.delete(sessionId);
}

function deferred() {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

// ── 行为测试：客户端对「等待后台任务 → 优雅收尾」的处理 ──────────────

test('后台任务等待期间流保持活动，收到终态 result 前不会提前标记完成', async () => {
  // 前两段是等待期间的真实帧；之后的汇总轮由测试显式放行（模拟 task_notification 到达）。
  const summaryGate = deferred();
  const reader = scriptedReader([
    sse('text', '传输完成后我会核对服务器端 MD5，然后汇报。'),
    sse('keep_alive', ''),
    summaryGate.promise,
    sse('text', '全部完成 ✅ Fixme-V2 已补齐，全链路闭环。'),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 2, duration_ms: 180000,
      usage: { input_tokens: 10, output_tokens: 20, duration_sec: 180 }, session_id: 's-bg',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `bg-hold-${Date.now()}`;
  let completed = false;
  const unsubscribe = subscribe(sessionId, (event) => {
    if (event.type === 'completed') completed = true;
  });
  try {
    startStream({ sessionId, content: '上传这个文件', mode: 'code', model: 'test', providerId: 'test' });
    // 后台任务仍在运行时（keep_alive 阶段），前端必须保持「生成中」，不得先标成完成。
    await new Promise((r) => setTimeout(r, 150));
    const snapshotAtHold = getSnapshot(sessionId);
    assert.equal(completed, false, '等待后台任务期间不应出现 completed 事件');
    assert.equal(snapshotAtHold?.phase, 'active', '等待期间应保持 active（生成中）');
    // 后台任务完成 → SDK 注入汇总轮 → 一起并入本轮回复后才收尾
    summaryGate.resolve(sse('status', { _internal: true, subtype: 'internal_turn_start' }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(completed, true, '后台任务收尾后本轮才应完成');
    const snapshot = getSnapshot(sessionId)!;
    assert.equal(snapshot.phase, 'completed');
    assert.ok(snapshot.finalMessageContent?.includes('全部完成 ✅'), '汇总轮输出应并入本轮回复');
    assert.ok(snapshot.finalMessageContent?.includes('传输完成后我会核对服务器端 MD5'), '等待期间已产出的内容应保留');
    assert.ok(!snapshot.finalMessageContent?.includes('后台任务仍在运行'), '正常收尾不应出现等待超时说明');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('等待后台任务超过上限：优雅收尾并追加可见说明，不触发自动继续', async () => {
  const reader = scriptedReader([
    sse('text', '传输完成后我会核对服务器端 MD5，然后汇报。'),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 900000,
      usage: { input_tokens: 10, output_tokens: 20, duration_sec: 900 }, session_id: 's-bg',
      terminal_reason: 'background_wait_timeout',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `bg-wait-timeout-${Date.now()}`;
  let completed = false;
  let autoContinueCalled = false;
  const unsubscribe = subscribe(sessionId, (event) => {
    if (event.type === 'completed') completed = true;
  });
  try {
    startStream({
      sessionId,
      content: '上传这个文件',
      mode: 'code',
      model: 'test',
      providerId: 'test',
      sendMessageFn: () => { autoContinueCalled = true; },
    } as Parameters<typeof startStream>[0]);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(completed, true);
    const snapshot = getSnapshot(sessionId)!;
    // 等待超时是「优雅收尾」而不是中断/失败：phase 仍是 completed。
    assert.equal(snapshot.phase, 'completed');
    assert.equal(snapshot.terminalReason, 'background_wait_timeout');
    assert.ok(
      snapshot.finalMessageContent?.includes('后台任务仍在运行，本轮已结束等待'),
      '超时收尾必须在正文里写明任务仍在后台运行',
    );
    assert.ok(snapshot.finalMessageContent?.includes('传输完成后我会核对服务器端 MD5'), '已产出内容应保留');
    assert.equal(autoContinueCalled, false, '等待超时不应触发 background_finalization_timeout 的自动继续');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

// ── 源码断言：服务端把后台 Bash 任务纳入「等待完成后收尾」 ──────────

test('claude-client 登记后台 Bash 任务并沿用后台任务的挂起语义', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 识别 run_in_background 的 Bash 工具调用
  assert.match(claudeClient, /export function isBackgroundBashToolUse\(name: string, input: unknown\)/);
  assert.match(claudeClient, /export const BASH_TOOL_PATTERN = \/\^Bash\$\|\^mcp__\.\*bash\$\/i/);
  // 在 tool_use 分支登记进等待表
  assert.match(claudeClient, /pendingBackgroundBashTasks\.set\(block\.id, \{\}\)/);
  // 首个 result 的终态判定必须计入后台 Bash 任务
  assert.match(claudeClient, /totalPendingBackgroundWork\(\)/);
  assert.match(
    claudeClient,
    /isFinalUserTurnResult\(\s*turnTransition,\s*totalPendingBackgroundWork\(\)/,
  );
  // 15 分钟等待上限 + 排空模式
  assert.match(claudeClient, /const BACKGROUND_BASH_WAIT_TIMEOUT_MS = 15 \* 60_000/);
  assert.match(claudeClient, /const BACKGROUND_DRAIN_TIMEOUT_MS = 60 \* 60_000/);
  assert.match(claudeClient, /drainingBackground = true/);
  assert.match(claudeClient, /terminal_reason: 'background_wait_timeout'/);
  // 任务回报后放行注入的汇总轮（成功/失败都要让用户看到汇报）
  assert.match(claudeClient, /resolvePendingBackgroundBash\(taskMsg\.tool_use_id, taskMsg\.task_id\)/);
  assert.match(claudeClient, /resolvePendingBackgroundBash\(undefined, taskUpdated\.task_id\)/);
  // 等待期间的保活心跳覆盖后台 Bash 任务，且排空模式下仍刷新看门狗时钟
  assert.match(
    claudeClient,
    /if \(totalPendingBackgroundWork\(\) > 0\) \{\s*[\s\S]*?lastStreamActivityAt = Date\.now\(\);/,
  );
  // 排空模式不再销毁持久会话（否则会杀掉仍在运行的后台任务）
  assert.match(
    claudeClient,
    /!receivedTerminalResult && !backgroundWaitExpired/,
  );
  // 工具看门狗不把「等待中的后台任务」当作卡死
  assert.match(claudeClient, /if \(pendingBackgroundBashTasks\.has\(toolUseId\)\) continue;/);
});

test('persistent-claude-session 把后台 Bash 派发纳入轮次保持', () => {
  const session = read('src/lib/persistent-claude-session.ts');

  // 派发识别扩展到 Bash + run_in_background
  assert.match(session, /const BASH_TOOL_PATTERN = \/\^Bash\$\|\^mcp__\.\*bash\$\/i/);
  assert.match(session, /function isBackgroundDispatchTool\(name: string, input: unknown\)/);
  assert.match(session, /AGENT_TOOL_NAMES\.has\(name\) \|\| BASH_TOOL_PATTERN\.test\(name\)/);
  // 登记时区分 kind，等待上限按是否含 Bash 任务选择
  assert.match(session, /kind: BASH_TOOL_PATTERN\.test\(toolName\) \? 'bash' : 'agent'/);
  assert.match(session, /const BACKGROUND_TASK_WAIT_TIMEOUT_MS = 60 \* 60_000/);
  assert.match(
    session,
    /bashPending > 0 \? BACKGROUND_TASK_WAIT_TIMEOUT_MS : SUBAGENT_WAIT_TIMEOUT_MS/,
  );
  // 等待上限必须大于客户端 15 分钟的等待上限，让排空随生成器自然结束
  const clientSrc = read('src/lib/claude-client.ts');
  const clientCap = clientSrc.match(/BACKGROUND_BASH_WAIT_TIMEOUT_MS = (\d+) \* 60_000/);
  const sessionCap = session.match(/BACKGROUND_TASK_WAIT_TIMEOUT_MS = (\d+) \* 60_000/);
  assert.ok(clientCap && sessionCap, '两个等待上限常量都应存在');
  assert.ok(
    Number(sessionCap![1]) > Number(clientCap![1]),
    '会话侧等待上限应大于客户端 15 分钟上限',
  );
});

test('前端把等待超时收尾渲染成非「任务完成」状态并附带说明', () => {
  const streamManager = read('src/lib/stream-session-manager.ts');
  const messageItem = read('src/components/chat/MessageItem.tsx');

  assert.match(streamManager, /terminalReason === 'background_wait_timeout'/);
  assert.match(streamManager, /后台任务仍在运行，本轮已结束等待/);
  // phase 归类：等待超时是优雅收尾，不得进入 isAborted 列表
  const isAbortedBlock = streamManager.slice(
    streamManager.indexOf('const isAborted ='),
    streamManager.indexOf('const finalPhase'),
  );
  assert.ok(!isAbortedBlock.includes('background_wait_timeout'), 'background_wait_timeout 不应归入 isAborted');
  // 消息卡片的完成状态解析必须识别该说明，避免绿色「任务完成」误导
  assert.match(messageItem, /后台任务仍在运行，本轮已结束等待/);
});
