import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  closeAllPersistentClaudeSessions,
  getPersistentClaudeTurn,
} from '@/lib/persistent-claude-session';

/**
 * 覆盖「后台任务排空期」的服务端修复（窜会话根因修复）：
 * 1. SSE 断开（客户端优雅收尾 / 中途切走）后，消息泵转交 detached drain
 *    继续消费旧帧直到干净边界，期间不杀进程、不释放锁；
 * 2. 排空期内新用户请求不 retire 旧 entry，走 acquireTurn 排队等干净边界；
 * 3. 新轮拿到锁时旧帧已消费干净——旧帧（task_notification / 汇总 result）
 *    不会窜入新轮的流（这正是「窜会话」的服务端侧防护）。
 *
 * 测试手法：直接向 globalThis.__persistentClaudeSessions__ 注入 fake entry
 * （脚本化 iterator + fake query），驱动 getPersistentClaudeTurn 的完整
 * 消息泵流程，无需启动真实 SDK 进程。
 */

const GLOBAL_KEY = '__persistentClaudeSessions__';

/** 按剧本推帧的队列式 iterator：next() 有帧即返，无帧则挂起等 push。 */
function queueIterator() {
  const queue: Array<IteratorResult<SDKMessage>> = [];
  const waiters: Array<(r: IteratorResult<SDKMessage>) => void> = [];
  return {
    push(result: IteratorResult<SDKMessage>) {
      const w = waiters.shift();
      if (w) w(result);
      else queue.push(result);
    },
    next: (): Promise<IteratorResult<SDKMessage>> => {
      const item = queue.shift();
      if (item) return Promise.resolve(item);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function fakeEntry(sessionId: string, iter: ReturnType<typeof queueIterator>, onClose: () => void) {
  return {
    codepilotSessionId: sessionId,
    signature: 'sig-a',
    input: { enqueue: () => {}, close: () => {} },
    query: { close: onClose },
    iterator: iter,
    turnLock: Promise.resolve(),
    releaseTurn: null as (() => void) | null,
    turnReserved: false,
    backgroundWaitActive: false,
    idleTimer: null as ReturnType<typeof setTimeout> | null,
    lastUsedAt: Date.now(),
    lastActivityAt: Date.now(),
    warmedUp: false,
    warmupPromise: null,
    currentOptions: undefined as unknown,
    supportsInteractiveAskUserQuestion: false,
  };
}

type FakeEntry = ReturnType<typeof fakeEntry>;

function installEntry(sessionId: string, entry: FakeEntry) {
  const g = globalThis as unknown as Record<string, unknown>;
  g[GLOBAL_KEY] = new Map([[sessionId, entry]]);
}

async function waitFor(cond: () => boolean, timeoutMs = 3000, label = 'condition') {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 含后台 Bash 派发的 assistant 帧 → 触发 pendingBgAgents 登记。 */
const assistantBgDispatch = (): SDKMessage =>
  ({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm run build', run_in_background: true } },
      ],
    },
    session_id: 's-drain',
  }) as unknown as SDKMessage;

const resultMsg = (): SDKMessage =>
  ({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's-drain' }) as unknown as SDKMessage;

const taskNotification = (toolUseId: string): SDKMessage =>
  ({ type: 'system', subtype: 'task_notification', tool_use_id: toolUseId, task_id: 't-1', session_id: 's-drain' }) as unknown as SDKMessage;

const plainText = (text: string): SDKMessage =>
  ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: 's-drain' }) as unknown as SDKMessage;

const MINIMAL_OPTIONS = { cwd: '/tmp/cp-test', model: 'sonnet', settingSources: [] };

describe('persistent-claude-session detached drain（排空期防窜会话）', () => {
  afterEach(() => {
    closeAllPersistentClaudeSessions();
  });

  it('SSE 断开后 detached drain 消费旧帧到干净边界，不杀进程并释放锁', async () => {
    const sessionId = `drain-${Date.now()}`;
    const iter = queueIterator();
    let queryClosed = false;
    const entry = fakeEntry(sessionId, iter, () => { queryClosed = true; });
    installEntry(sessionId, entry);

    const { conversation } = getPersistentClaudeTurn({
      codepilotSessionId: sessionId,
      signature: 'sig-a',
      options: MINIMAL_OPTIONS as never,
      messages: [],
    });
    const gen = conversation as AsyncGenerator<SDKMessage>;

    // 帧 1：assistant 后台派发 → 登记 pendingBgAgents
    const first = gen.next();
    iter.push({ value: assistantBgDispatch(), done: false });
    await first;

    // 帧 2：首个 result → yield 返回后 generator 暂停在 yield 点，
    // 其后的「进入等待态」逻辑要等下一次 next() 才执行。
    const second = gen.next();
    iter.push({ value: resultMsg(), done: false });
    await second;
    // 推动 generator 越过 yield：主循环发起第三次 next()（挂起等后台回报）
    void gen.next();
    await tick();

    assert.equal(entry.backgroundWaitActive, true, '主回合结束后应进入后台等待态');
    assert.equal(entry.turnReserved, true);

    // SSE 断开（客户端优雅收尾/切走）→ 消息泵 return()。
    // 注意：async generator 的 return() 不会中断进行中的 await——它排队等
    // 主循环走到下一个 yield 点才生效。因此先发起 return()，再放行一帧。
    const retPromise = gen.return(undefined as never);
    await tick();
    // 放行一帧让主循环越过 await 到达 yield → return 生效 → finally → drain 接管
    iter.push({ value: taskNotification('tu-1'), done: false });
    await retPromise;
    await tick();

    // drain 已接管：继续消费汇总轮 result → 干净边界 → 排空结束
    iter.push({ value: resultMsg(), done: false });

    await waitFor(() => entry.turnReserved === false, 3000, 'drain 结束并释放轮次');
    assert.equal(entry.backgroundWaitActive, false, '排空结束后等待标志应复位');
    assert.equal(queryClosed, false, '排空全程不得杀进程（后台任务必须存活）');
  });

  it('排空期内新请求不 retire：排队等锁，旧帧不窜入新轮', async () => {
    const sessionId = `drain-reuse-${Date.now()}`;
    const iter = queueIterator();
    let queryClosed = false;
    const entry = fakeEntry(sessionId, iter, () => { queryClosed = true; });
    installEntry(sessionId, entry);

    const firstTurn = getPersistentClaudeTurn({
      codepilotSessionId: sessionId,
      signature: 'sig-a',
      options: MINIMAL_OPTIONS as never,
      messages: [],
    });
    const gen1 = firstTurn.conversation as AsyncGenerator<SDKMessage>;

    const f1 = gen1.next();
    iter.push({ value: assistantBgDispatch(), done: false });
    await f1;
    const f2 = gen1.next();
    iter.push({ value: resultMsg(), done: false });
    await f2;
    // 推动 generator 越过 yield：进入后台等待态（backgroundWaitActive = true）
    void gen1.next();
    await tick();
    assert.equal(entry.backgroundWaitActive, true, '进入排空期后才能验证新请求不 retire');

    // 排空期：新用户请求到达（同签名）
    const secondTurn = getPersistentClaudeTurn({
      codepilotSessionId: sessionId,
      signature: 'sig-a',
      options: MINIMAL_OPTIONS as never,
      messages: [],
    });
    assert.equal(secondTurn.reused, true, '排空期新请求应复用现有 entry');
    assert.equal(queryClosed, false, '排空期新请求不得 retire 旧进程');

    // SSE 断开：return() 排队等主循环走到 yield 点（return 不中断 await）
    const retPromise = gen1.return(undefined as never);
    await tick();

    // 新轮开始消费：应先排队等锁（旧帧未排空前拿不到锁）
    const gen2 = secondTurn.conversation as AsyncGenerator<SDKMessage>;
    const newFirst = gen2.next();
    await tick();

    // 放行一帧让主循环越过 await → return 生效 → finally → drain 接管。
    // 这帧由主循环 yield 后即被 return 丢弃，drain 从下一帧开始接管消费。
    const staleFrame = plainText('排空期残留帧');
    iter.push({ value: staleFrame, done: false });
    await retPromise;
    await tick();

    // 放行后台任务回报与汇总轮 → drain 走到干净边界 → 释放锁
    iter.push({ value: taskNotification('tu-1'), done: false });
    iter.push({ value: resultMsg(), done: false });

    await waitFor(() => entry.turnReserved === false, 3000, 'drain 结束并释放轮次');

    // 新轮拿到锁后开始消费——此时才推入真正属于新轮的帧
    const newFrame = plainText('这是新轮的第一帧');
    iter.push({ value: newFrame, done: false });
    const received = await newFirst;
    assert.equal(received.done, false);
    assert.equal(received.value, newFrame, '新轮收到的第一帧必须是新帧，而非排空期的残留帧/task_notification/result');
    assert.equal(queryClosed, false, '整个流程不得杀进程');

    // 收尾清理：结束新轮
    await gen2.return(undefined as never);
  });
});
