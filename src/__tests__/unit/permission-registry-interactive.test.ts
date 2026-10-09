/**
 * permission-registry — 交互式等待的豁免与释放
 *
 * 回归背景：AskUserQuestion / ExitPlanMode 这类「等人工输入」的请求，
 * 此前统一套用 5 分钟墙钟自动拒绝，导致用户切走一会儿回来，
 * 卡片已被系统自动拒绝、本轮直接结束（表现为「切窗口回来选项卡片就没了」）。
 *
 * 这里锁定三条契约：
 *  1. 非交互请求仍保留 5 分钟自动拒绝兜底（不回退既有行为）
 *  2. 交互请求不会到点自动拒绝，等待时长交给用户
 *  3. 流真正终止（signal abort）时释放悬挂的等待，且不遗留内存条目
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPermissionRequest,
  createSession,
  getPermissionRequest,
  resolvePermissionRequest,
} from '@/lib/db';
import {
  registerPendingPermission,
  registerPendingPermissionThenNotify,
  resolvePendingPermission,
} from '@/lib/permission-registry';

const TIMEOUT_MS = 5 * 60 * 1000;

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedPending(id: string, sessionId: string, toolName = 'AskUserQuestion'): void {
  createPermissionRequest({
    id,
    sessionId,
    toolName,
    toolInput: JSON.stringify({ questions: [] }),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
}

describe('permission-registry — 交互式等待豁免墙钟超时', () => {
  it('先注册 waiter 再通知前端，避免快速作答丢失唤醒', async () => {
    const id = uniqueId('test-perm-notify-order');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId);

    const pending = registerPendingPermissionThenNotify(
      id,
      { questions: [] },
      { interactive: true },
      () => {
        // Simulate the browser receiving permission_request and replying in
        // the same turn. This must find the in-memory waiter already present.
        assert.equal(
          resolvePendingPermission(id, { behavior: 'allow', updatedInput: { answers: { Q1: 'A' } } }),
          true,
        );
      },
    );

    const result = await pending;
    assert.equal(result.behavior, 'allow');
    assert.deepEqual((result.updatedInput as { answers: Record<string, string> }).answers, { Q1: 'A' });
  });

  it('非交互请求到点自动拒绝（保留原有兜底）', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const id = uniqueId('test-perm-auto');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId, 'Bash');

    const pending = registerPendingPermission(id, { command: 'rm -rf /tmp/x' });
    t.mock.timers.tick(TIMEOUT_MS + 10);

    const result = await pending;
    assert.equal(result.behavior, 'deny');
    assert.equal(getPermissionRequest(id)?.status, 'timeout');
  });

  it('交互请求不会到点自动拒绝，等待多久都由用户决定', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const id = uniqueId('test-perm-interactive');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId);

    const pending = registerPendingPermission(id, { questions: [] }, { interactive: true });

    // 快进远超 5 分钟，甚至一小时 —— 都不该替用户拒绝
    t.mock.timers.tick(TIMEOUT_MS + 10);
    t.mock.timers.tick(60 * 60 * 1000);

    assert.equal(getPermissionRequest(id)?.status, 'pending');

    // 用户作答后正常释放，且拿到答案
    resolvePendingPermission(id, { behavior: 'allow', updatedInput: { answers: { Q1: 'A' } } });
    const result = await pending;
    assert.equal(result.behavior, 'allow');
    assert.deepEqual((result.updatedInput as { answers: Record<string, string> }).answers, { Q1: 'A' });
  });

  it('流终止（signal abort）时释放悬挂的交互等待并落库 aborted', async () => {
    const id = uniqueId('test-perm-abort');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId);

    const ac = new AbortController();
    const pending = registerPendingPermission(id, {}, { interactive: true, signal: ac.signal });
    ac.abort();

    const result = await pending;
    assert.equal(result.behavior, 'deny');
    assert.equal(getPermissionRequest(id)?.status, 'aborted');
  });

  it('signal 在注册前已中止时不遗留悬挂条目', async () => {
    const id = uniqueId('test-perm-preabort');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId);

    const ac = new AbortController();
    ac.abort();

    const result = await registerPendingPermission(id, {}, { interactive: true, signal: ac.signal });
    assert.equal(result.behavior, 'deny');

    // 内存里不该还有等待者：再次 resolve 应返回 false
    assert.equal(resolvePendingPermission(id, { behavior: 'allow' }), false);
  });

  it('DB 轮询仍能解析交互请求（跨 worker 作答路径不受影响）', async () => {
    const id = uniqueId('test-perm-dbpoll');
    const sessionId = createSession('test-session').id;
    seedPending(id, sessionId);

    // 模拟另一个 worker 先把 DB 标记为已解决
    resolvePermissionRequest(id, 'allow', {
      updatedInput: { answers: { Q1: 'B' } },
    });

    const result = await registerPendingPermission(id, {}, { interactive: true });
    assert.equal(result.behavior, 'allow');
    assert.deepEqual((result.updatedInput as { answers: Record<string, string> }).answers, { Q1: 'B' });
  });
});
