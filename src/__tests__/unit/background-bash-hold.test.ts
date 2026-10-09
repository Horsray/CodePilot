import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSnapshot, startStream, subscribe } from '../../lib/stream-session-manager';
import { isResidentBackgroundBashToolUse } from '../../lib/claude-client';

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
  // 在 tool_use 分支登记进等待表（登记时刻 + 常驻标记，供收尾判定豁免常驻服务）
  assert.match(claudeClient, /pendingBackgroundBashTasks\.set\(block\.id, \{ startedAt: Date\.now\(\), resident \}\);/);
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
  // 等待期间的保活心跳覆盖后台 Bash 任务，且排空模式下仍刷新看门狗时钟。
  // 注意：这里必须用「登记表原始状态」——常驻服务（dev server）跨过常驻阈值后
  // totalPendingBackgroundWork() 会归零，用它做条件会让心跳停摆、看门狗提前 abort。
  assert.match(
    claudeClient,
    /if \(pendingAgentToolUse\.size \+ pendingBackgroundBashTasks\.size > 0\) \{\s*[\s\S]*?lastStreamActivityAt = Date\.now\(\);/,
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

// ── 回归：主回合进行中收到后台任务通知，不得武装最终化宽限（enqueue+30s 误杀） ──

test('后台任务通知在主回合进行中到达时不武装宽限，等主回合 result 被拦下后才武装', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 通知分支（Bash）：只有已持有被拦下的主回合 result 才允许开始 30s 倒计时
  const bashNotify = claudeClient.slice(
    claudeClient.indexOf('const bashTaskKey = resolvePendingBackgroundBash(taskMsg.tool_use_id'),
    claudeClient.indexOf("const title = taskMsg.status === 'completed'"),
  );
  assert.ok(bashNotify.length > 0, '应能定位后台 Bash 通知分支');
  assert.match(bashNotify, /if \(swallowedFinalResult\) scheduleBackgroundFinalization\(\);/);
  // 回归写法：totalPendingBackgroundWork()===0 就无条件武装——主回合仍在干活时
  // 30 秒后会把整轮 abort 成 background_finalization_timeout（实测 enqueue+30s 精确误杀）
  assert.ok(
    !/if \(totalPendingBackgroundWork\(\) === 0\) \{\s*sdkInjectedTurn\.forwardFinalTurn = true;\s*scheduleBackgroundFinalization\(\);/.test(bashNotify),
    '主回合仍在进行时不得武装最终化宽限',
  );

  // 子 Agent 通知分支同样以「已持有被拦 result」为前提
  const subagentNotify = claudeClient.slice(
    claudeClient.indexOf('shouldGracefullyFinalizeBackgroundTask(taskMsg.status'),
    claudeClient.indexOf('const bashTaskKey = resolvePendingBackgroundBash'),
  );
  assert.match(subagentNotify, /if \(swallowedFinalResult\) scheduleBackgroundFinalization\(\);/);

  // task_updated 失败/被杀分支同样以「已持有被拦 result」为前提
  assert.match(claudeClient, /totalPendingBackgroundWork\(\) === 0 && swallowedFinalResult/);

  // 结果门：被拦下的主回合 result 统一保存（宽限的武装前提 + 兜底终态载体），
  // 并在「主回合答完、只差注入汇总轮」时武装宽限
  assert.match(claudeClient, /swallowedFinalResult = resultMsg;/);
  assert.match(
    claudeClient,
    /else if \(turnTransition === 'turn_completed' && sdkInjectedTurn\.hasPendingFinalSummary\) \{/,
  );
});

// ── 回归：模型主动 TaskStop 停掉后台任务（killed）不得置位最终汇总轮 ─────────
// 背景：killed 是模型自己停的任务——SDK 不会为此注入 <task-notification> 汇报轮，
// 主回合剩余输出就是最终结论。此前 killed 也置位 forwardFinalTurn，主回合 result
// 到达时被拦下，30s 宽限等一个永远不会到来的汇总轮，到期误报「未等到最终汇总」
// （实测：结论已完整显示给用户，徽章仍显示「本轮已收尾（后台任务继续）」）。

test('killed 后台任务不置位 forwardFinalTurn：SDK 不注入汇报轮，主回合自身输出即结论', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // task_updated 分支：failed 仍放行失败汇报轮（前提：已持有被拦 result）；
  // killed 与 failed 同入「移除登记」分支，但整个分支内只有一处置位点
  const taskUpdatedBranch = claudeClient.slice(
    claudeClient.indexOf("sysMsg.subtype === 'task_updated'"),
    claudeClient.indexOf("sysMsg.subtype === 'task_notification'"),
  );
  assert.ok(taskUpdatedBranch.length > 0, '应能定位 task_updated 分支');
  assert.match(
    taskUpdatedBranch,
    /taskUpdated\.patch\?\.status === 'failed'[\s\S]{0,120}totalPendingBackgroundWork\(\) === 0 && swallowedFinalResult/,
    'failed 仍以「已持有被拦 result」为前提放行失败汇报轮',
  );
  assert.equal(
    (taskUpdatedBranch.match(/forwardFinalTurn = true/g) || []).length,
    1,
    'task_updated 分支只允许 failed 一处置位；killed 路径不得置位',
  );

  // task_notification 分支（Bash）：killed 同样不置位，否则 killed 回报也会挂账
  // 一个 SDK 不会注入的汇总轮
  const bashNotify = claudeClient.slice(
    claudeClient.indexOf('const bashTaskKey = resolvePendingBackgroundBash(taskMsg.tool_use_id'),
    claudeClient.indexOf("const title = taskMsg.status === 'completed'"),
  );
  assert.ok(bashNotify.length > 0, '应能定位后台 Bash 通知分支');
  assert.match(
    bashNotify,
    /totalPendingBackgroundWork\(\) === 0 && taskMsg\.status !== 'killed'/,
    'Bash 通知分支必须排除 killed',
  );
  // 回归写法：无条件置位——killed 回报也挂账最终汇总轮
  assert.ok(
    !/if \(totalPendingBackgroundWork\(\) === 0\) \{\s*sdkInjectedTurn\.forwardFinalTurn = true;/.test(bashNotify),
    'Bash 通知分支不得对 killed 无条件置位',
  );
});

test('最终汇总宽限到期是优雅收尾（result 终态）而不是 abort 主回合', () => {  const claudeClient = read('src/lib/claude-client.ts');

  // 到点回调：按 summaryRelayed 选择收尾归类，委托公共收尾函数
  const graceCallback = claudeClient.slice(
    claudeClient.indexOf('backgroundFinalizationTimer = setTimeout(() => {'),
    claudeClient.indexOf('}, BACKGROUND_FINALIZATION_GRACE_MS);'),
  );
  assert.ok(graceCallback.length > 0, '应能定位宽限定时器回调');
  assert.match(
    graceCallback,
    /finishTurnWithHeldResult\(\s*sdkInjectedTurn\.summaryRelayed \? 'background_summary_received' : 'background_finalization_graceful',\s*\)/,
  );
  assert.ok(!graceCallback.includes('.abort()'), '宽限到期不得 abort 整轮查询');

  // 公共收尾函数：用被拦下的主回合 result 发终态（保留 usage/耗时），绝不 abort
  const finishFn = claudeClient.slice(
    claudeClient.indexOf('const finishTurnWithHeldResult = ('),
    claudeClient.indexOf('const scheduleBackgroundFinalization = () => {'),
  );
  assert.ok(finishFn.length > 0, '应能定位公共收尾函数');
  assert.match(finishFn, /terminal_reason: reason,/);
  assert.match(finishFn, /drainingBackground = true/);
  assert.match(finishFn, /controller\.close\(\)/);
  // 无可转发 result 时不制造 abort，交给流看门狗兜底
  assert.match(finishFn, /if \(!held\) \{/);
  assert.ok(!finishFn.includes('.abort()'), '优雅收尾不得 abort 整轮查询');
  assert.ok(!finishFn.includes("'background_finalization_timeout'"), '旧 abort 路径不得复现');
});

test('注入的最终汇总轮一开始，宽限倒计时立刻解除', () => {
  const claudeClient = read('src/lib/claude-client.ts');
  assert.match(claudeClient, /const wasForwardingFinalSummary = sdkInjectedTurn\.forwardFinalTurn;/);
  assert.match(claudeClient, /if \(wasForwardingFinalSummary\) clearBackgroundFinalizationTimer\(\);/);
});

// ── 回归：汇总已转发但注入轮 result 迟到/丢失的竞态（用户报告「总结显示了却提示没等到」） ──
// 背景：注入汇总轮的 user 消息若未被 detectSdkInjectedUserTurn 识别，forwardFinalTurn
// 一直挂账；汇总输出照常转发给用户，其 result 到达时被吞掉并重新武装 30 秒宽限，
// 宽限到期误报「未等到最终汇总」。修复：summaryRelayed 标记 + 三处状态机闭合。

test('claude-client：summaryRelayed 只在主回合 result 被拦下后的 assistant 输出置位', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 标记字段与参数化入口
  assert.match(claudeClient, /summaryRelayed = false;/);
  assert.match(claudeClient, /markAssistantMessage\(mainResultSwallowed = false\): void \{/);
  // 置位前提：处于汇总等待态（forwardFinalTurn / finalSummaryTurn）且主回合 result 已被拦下。
  // 主回合仍在进行时的 assistant 输出是主回合自己的输出，不得算作汇总。
  assert.match(
    claudeClient,
    /if \(\(this\.forwardFinalTurn \|\| this\.finalSummaryTurn\) && mainResultSwallowed\) \{\s*this\.summaryRelayed = true;\s*\}/,
  );
  // 调用点必须以「主回合 result 是否已被拦下」作为入参
  assert.match(claudeClient, /sdkInjectedTurn\.markAssistantMessage\(swallowedFinalResult !== null\);/);
});

test('claude-client：宽限到期前若汇总已转发，按正常完成收尾而非误报「未等到汇总」', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 公共收尾函数覆盖三种 reason，且是 result 终态而非 abort
  assert.match(
    claudeClient,
    /reason: 'background_finalization_graceful' \| 'background_summary_received' \| 'background_wait_timeout',/,
  );
  // 宽限定时器到点：summaryRelayed 决定收尾归类——已转发 → 正常完成，未转发 → 才宣称没等到
  assert.match(
    claudeClient,
    /finishTurnWithHeldResult\(\s*sdkInjectedTurn\.summaryRelayed \? 'background_summary_received' : 'background_finalization_graceful',\s*\)/,
  );
});

test('claude-client：注入轮/挂起轮边界的三处状态机闭合（重武装与直通收尾）', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 闭合 1：internal_end（通知轮结束）后最终汇总轮仍悬而未决 → 重武装宽限，
  // 修复「宽限在汇总轮 user 消息处被清除后主回合永远挂到看门狗」。
  assert.match(
    claudeClient,
    /if \(swallowedFinalResult && sdkInjectedTurn\.hasPendingFinalSummary && !sdkInjectedTurn\.summaryRelayed\) \{\s*scheduleBackgroundFinalization\(\);\s*\}/,
  );
  // 闭合 2：suppressed_start（此前有挂起的注入消息）拦下 result 时也要武装宽限。
  assert.match(
    claudeClient,
    /if \(turnTransition === 'suppressed_start' && sdkInjectedTurn\.hasPendingFinalSummary\) \{\s*scheduleBackgroundFinalization\(\);\s*\}/,
  );
  // 闭合 3：turn_completed 时若汇总输出已转发（注入轮 user 消息未被识别），
  // 此刻到达的 result 就是汇总轮 result → 直接正常收尾，绝不重新武装宽限。
  assert.match(
    claudeClient,
    /if \(sdkInjectedTurn\.summaryRelayed\) \{\s*clearBackgroundFinalizationTimer\(\);\s*finishTurnWithHeldResult\('background_summary_received'\);\s*break;\s*\}/,
  );
});

test('claude-client：迭代器 EOF 时被拦下的主回合 result 必须优雅收尾，不得误报上游中断', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 后台 Bash 仍挂着 → 复用等待超时语义；否则按 summaryRelayed 归类。
  assert.match(
    claudeClient,
    /const waitReason = pendingBackgroundBashTasks\.size > 0 \? 'background_wait_timeout' : null;/,
  );
  assert.match(
    claudeClient,
    /\?\? \(sdkInjectedTurn\.summaryRelayed \? 'background_summary_received' : 'background_finalization_graceful'\);/,
  );
  // EOF 收尾路径在「模型上游中断」判定之前，且会关闭持久会话
  const eofBlock = claudeClient.slice(
    claudeClient.indexOf('if (swallowedFinalResult || heldBackgroundResult) {'),
    claudeClient.indexOf('const message = \'模型上游中断'),
  );
  assert.ok(eofBlock.length > 0, '应能定位 EOF 优雅收尾块');
  assert.match(eofBlock, /finishTurnWithHeldResult\(reason\);/);
  assert.match(eofBlock, /closePersistentClaudeSession\(sessionId, persistentQueryForStream\)/);
});

test('最终汇总宽限的优雅收尾：phase completed、无中断文案、不触发自动继续', async () => {
  const reader = scriptedReader([
    sse('text', '构建已完成，改动都在预期内。'),
    sse('status', { subtype: 'background_finalization_graceful', message: '后台任务已完成，本轮直接收尾。' }),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 300000,
      usage: { input_tokens: 10, output_tokens: 20, duration_sec: 300 }, session_id: 's-bg',
      terminal_reason: 'background_finalization_graceful',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `bg-finalize-graceful-${Date.now()}`;
  let completed = false;
  let autoContinueCalled = false;
  const unsubscribe = subscribe(sessionId, (event) => {
    if (event.type === 'completed') completed = true;
  });
  try {
    startStream({
      sessionId,
      content: '继续',
      mode: 'code',
      model: 'test',
      providerId: 'test',
      sendMessageFn: () => { autoContinueCalled = true; },
    } as Parameters<typeof startStream>[0]);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(completed, true);
    const snapshot = getSnapshot(sessionId)!;
    assert.equal(snapshot.phase, 'completed', '宽限优雅收尾应归为正常完成，不得标成中断/失败');
    assert.equal(snapshot.terminalReason, 'background_finalization_graceful');
    assert.ok(!snapshot.finalMessageContent?.includes('未能接收结果'), '不得再注入「未能接收结果」文案');
    assert.ok(snapshot.finalMessageContent?.includes('构建已完成'), '已产出内容应保留');
    assert.equal(autoContinueCalled, false, '优雅收尾不得触发自动继续循环');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('前端把等待超时收尾渲染成非「任务完成」状态并附带说明', () => {
  const streamManager = read('src/lib/stream-session-manager.ts');
  const turnOutcome = read('src/lib/turn-outcome.ts');
  const messageItem = read('src/components/chat/MessageItem.tsx');

  // 统一终止态：正文说明与 phase 都由 turn-outcome 总表生成（单一维护点），
  // 前端不再手写 reason 字符串比较清单
  assert.match(streamManager, /const turnNote = noteForReason\(turnReason, turnToolTimeoutInfo \?\? undefined\);/);
  assert.match(streamManager, /const finalPhase = phaseForReason\(turnReason\);/);
  // 等待超时的正文说明与归类定义在总表：优雅收尾、phase completed，绝不误标成中断
  assert.match(turnOutcome, /background_wait_timeout: \{/);
  assert.match(turnOutcome, /后台任务仍在运行，本轮已结束等待/);
  // 自动继续只对旧终态 background_finalization_timeout 生效，等待超时不得触发
  assert.match(
    streamManager,
    /stream\.snapshot\.terminalReason === 'background_finalization_timeout' && stream\.sendMessageFn/,
  );
  // 消息卡片的完成状态解析必须识别该说明，避免绿色「任务完成」误导
  assert.match(messageItem, /后台任务仍在运行，本轮已结束等待/);
});

// ── 回归：常驻服务（dev server / watch）不得把本轮挂在收尾判定上 ─────────────
// 背景：dev server 永不自行退出，若按普通后台任务计入「本轮待完成工作」，本轮 result
// 会被一直拦下（最长 15 分钟等待上限）；会话侧则会占着 turn 锁到 60 分钟上限，下一条
// 消息只能在 acquireTurn 排队。用户观感就是「回复迟迟不落库 / 发消息没反应」。

test('常驻服务识别：dev server / watch 命中，一次性后台任务与 URL 路径不命中', () => {
  const bg = (command: string) => isResidentBackgroundBashToolUse('Bash', { command, run_in_background: true });

  // 常驻服务：必须命中
  assert.equal(bg('npm run dev'), true);
  assert.equal(bg('cd /app && pnpm dev'), true);
  assert.equal(bg('npm start'), true);
  assert.equal(bg('npx next dev -p 3001'), true);
  assert.equal(bg('vite --host'), true);
  assert.equal(bg('tsc --watch'), true);
  assert.equal(bg('tsc -w'), true);
  assert.equal(bg('tail -f /tmp/dev-server.log'), true);
  assert.equal(bg('python3 -m http.server 8080'), true);

  // 一次性后台任务：不得命中，否则任务完成前就不再等待、汇报会丢
  assert.equal(bg('npm run build'), false);
  assert.equal(bg('npx tsc --noEmit'), false);
  assert.equal(bg('curl -T big.iso https://example.com/upload'), false);
  // curl -w 是写格式化参数，不是 --watch；URL 路径里的 serve 也不是命令
  assert.equal(bg("curl -s -w '%{http_code}' https://example.com/serve"), false);
  assert.equal(bg('git push'), false);

  // 非后台调用、缺省命令一律不命中
  assert.equal(isResidentBackgroundBashToolUse('Bash', { command: 'npm run dev' }), false);
  assert.equal(isResidentBackgroundBashToolUse('Read', { command: 'npm run dev', run_in_background: true }), false);
  assert.equal(isResidentBackgroundBashToolUse('Bash', { run_in_background: true }), false);
});

test('claude-client：常驻服务不参与收尾判定，但保留登记以便回报时清理', () => {
  const claudeClient = read('src/lib/claude-client.ts');

  // 常驻标记随登记写入，并在计数时被跳过
  assert.match(claudeClient, /const resident = isResidentBackgroundBashToolUse\(block\.name, block\.input\);/);
  assert.match(claudeClient, /const activelyWaitingBackgroundBashTasks = \(\): number => \{/);
  assert.match(claudeClient, /if \(entry\.resident\) continue;/);
  // 时长阀值兜住「看着像一次性任务、实际卡住不回报」的命令
  assert.match(claudeClient, /const BACKGROUND_RESIDENT_SERVICE_MS = 10 \* 60_000;/);
  assert.match(claudeClient, /if \(now - startedAt < BACKGROUND_RESIDENT_SERVICE_MS\) count \+= 1;/);
  // 收尾判定的总入口必须改用豁免后的计数
  assert.match(claudeClient, /pendingAgentToolUse\.size \+ activelyWaitingBackgroundBashTasks\(\);/);
  // 条目本身必须保留：任务真正回报时仍要能命中并清理
  assert.match(claudeClient, /pendingBackgroundBashTasks\.delete\(bashKey\)/);
  assert.match(claudeClient, /pendingBackgroundBashTasks\.delete\(block\.tool_use_id\)/);
  // 15 分钟等待上限与保活心跳用「原始登记表」判断——等待上限到点时任何后台 Bash
  // 都已满 15 分钟、必然被判为常驻，若用豁免后的计数做守卫会永远提前返回
  assert.match(claudeClient, /if \(pendingAgentToolUse\.size === 0 && pendingBackgroundBashTasks\.size === 0\) return;/);
});

test('persistent-claude-session：常驻服务不挂住轮次锁', () => {
  const session = read('src/lib/persistent-claude-session.ts');

  // 会话侧等价拷贝（避免循环导入），登记时写入常驻标记
  assert.match(session, /const RESIDENT_BACKGROUND_COMMAND_PATTERNS: RegExp\[\] = \[/);
  assert.match(session, /resident: isResidentBackgroundBashInput\(toolName, b\.input\),/);
  assert.match(session, /const countBlockingBgAgents = \(\): number => \{/);
  assert.match(session, /if \(!info\.resident\) blocking \+= 1;/);
  // 挂起 / 收尾 / 排空三处判定都必须用豁免后的计数
  assert.match(session, /if \(countBlockingBgAgents\(\) > 0 \|\| pendingInternalTurns > 0\) \{/);
  assert.match(session, /if \(countBlockingBgAgents\(\) === 0 && pendingInternalTurns === 0\) \{/);
  assert.match(session, /if \(countBlockingBgAgents\(\) === 0 && pendingInternalTurns === 0\) break;/);
  assert.match(session, /v\.kind === 'bash' && !v\.resident/);
  // 不得再有任何用原始 size 做的挂起判定（漏一处就会被 dev server 永久卡住）
  assert.ok(
    !/pendingBgAgents\.size > 0 \|\| pendingInternalTurns > 0/.test(session),
    '挂起判定不得再用 pendingBgAgents.size',
  );
  assert.ok(
    !/pendingBgAgents\.size === 0 && pendingInternalTurns === 0/.test(session),
    '收尾判定不得再用 pendingBgAgents.size',
  );
});

// ── 回归：最终汇总宽限到期必须给出可见说明 ────────────────────────────────
// 背景：59e457d 把该终态从 abort 改成优雅收尾后没有补前端文案，界面呈现为干干净净的
// 绿色「任务完成」，在途的工具结果随排空丢弃——用户只看到工具卡片一直转圈。

test('最终汇总宽限的优雅收尾会追加可见说明，且仍不触发自动继续', async () => {
  const reader = scriptedReader([
    sse('text', '构建已完成，改动都在预期内。'),
    sse('status', { subtype: 'background_finalization_graceful', message: '后台任务已完成，本轮直接收尾。' }),
    sse('result', {
      subtype: 'success', is_error: false, num_turns: 1, duration_ms: 300000,
      usage: { input_tokens: 10, output_tokens: 20, duration_sec: 300 }, session_id: 's-bg',
      terminal_reason: 'background_finalization_graceful',
    }),
    sse('done', ''),
  ]);
  const restore = installGlobals(reader);
  const sessionId = `bg-finalize-graceful-note-${Date.now()}`;
  let autoContinueCalled = false;
  const unsubscribe = subscribe(sessionId, () => {});
  try {
    startStream({
      sessionId,
      content: '继续',
      mode: 'code',
      model: 'test',
      providerId: 'test',
      sendMessageFn: () => { autoContinueCalled = true; },
    } as Parameters<typeof startStream>[0]);
    await new Promise((r) => setTimeout(r, 250));
    const snapshot = getSnapshot(sessionId)!;
    assert.equal(snapshot.phase, 'completed');
    assert.ok(
      snapshot.finalMessageContent?.includes('未等到后台任务的最终汇总'),
      '宽限优雅收尾必须在正文里写明「没等到最终汇总」，不能静默收尾',
    );
    assert.ok(snapshot.finalMessageContent?.includes('构建已完成'), '已产出内容应保留');
    assert.equal(autoContinueCalled, false, '优雅收尾不得触发自动继续循环');
  } finally {
    unsubscribe();
    cleanStream(sessionId);
    restore();
  }
});

test('前端：悬空工具调用不得渲染绿色「任务完成」', () => {
  const messageItem = read('src/components/chat/MessageItem.tsx');

  // 判据 A：有 tool_use 没有对应 tool_result（工具卡片还在转圈）→ 降级为任务中断
  assert.match(messageItem, /const resultIds = new Set\(/);
  assert.match(messageItem, /t\.type === 'tool_result' && t\.id/);
  assert.match(messageItem, /const hasDanglingToolUse = tools\.some\(/);
  assert.match(messageItem, /if \(hasDanglingToolUse\) status = 'interrupted';/);
  // 判据 B：这几类中止说明都会出现在正文里，必须能识别，否则仍显示绿色「任务完成」
  assert.match(messageItem, /判定卡死，本轮任务已中止/);
  assert.match(messageItem, /模型上游长时间无响应，本轮任务已中止/);
  assert.match(messageItem, /后台任务已返回，但主任务未能接收结果/);
  assert.match(messageItem, /未等到后台任务的最终汇总/);
});

// ── 回归：手动中断轮次的思考残留（用户报告「卡片下方留着一大片纯文本思考」） ──
// 根因：服务端把全部 currentText 塞进尾部 text 块，渲染层只折叠「后续有工具」的
// 文本块 → 中断轮次的初始思考以纯文本残留在正文。修复：cancelled 终态下全部文本
// 折叠进时间线卡片、正文留空，卡片按已交付收起。

test('前端：cancelled 终态全部文本折叠进时间线，正文不再残留纯文本思考', () => {
  const messageItem = read('src/components/chat/MessageItem.tsx');
  const agentTimeline = read('src/lib/agent-timeline.ts');

  // 折叠开关：仅当消息带明确的中断终态（cancelled）时生效
  assert.match(messageItem, /const foldAllText = isKnownOutcome\(message\.outcome\) && message\.outcome === 'cancelled';/);
  // 提取时间线时透传开关
  assert.match(messageItem, /extractTimelineStepsFromBlocks\(contentBlocks, \{ foldAllText \}\)/);
  // 正文在折叠模式下清空（残留思考不得再以纯文本形式渲染）
  assert.match(messageItem, /if \(foldAllText\) \{\s*return \{ files: \[\] as FileAttachment\[\], displayText: '' \};\s*\}/);
  // 卡片按已交付收起（不显示「未展开内容」提示）
  assert.match(messageItem, /delivered: displayText\.trim\(\)\.length > 0 \|\| foldAllText,/);
  // 提取函数本身支持 foldAllText 参数并覆盖 text 分支
  assert.match(agentTimeline, /export function extractTimelineStepsFromBlocks\(\s*blocks: MessageContentBlock\[\],\s*options: \{ foldAllText\?: boolean \} = \{\},\s*\)/);
  assert.match(agentTimeline, /if \(options\.foldAllText\) \{\s*appendTimelineOutput\(state, block\.text, 0\);\s*break;\s*\}/);
});
