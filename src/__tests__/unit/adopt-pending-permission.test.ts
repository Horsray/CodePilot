/**
 * adoptPendingPermission — 卡片「失而复得」的广播契约
 *
 * 回归背景：卡片此前只活在内存快照里，窗口切走/页面重挂载后快照被清空，
 * 用户就再也看不到它，而 DB 里那条 `pending` 记录其实还在。
 * `adoptPendingPermission` 负责把 DB 记录重新注入快照。
 *
 * 首版实现漏了一件事：无活动流时走 `seedSnapshotPatch` 占位分支，
 * 而该函数只做 `map.set`、不发事件（它的注释假设「ChatView 会在挂载时重新订阅」）。
 * 恢复场景下 ChatView 早已挂载并订阅好，于是接口查到了记录、卡片却始终不渲染。
 *
 * 这里锁定：
 *  1. 占位分支必须广播，订阅方能收到卡片
 *  2. 广播后 getSnapshot 能读回 pending
 *  3. 已有 pending 时不覆盖（避免顶掉用户正在作答的卡片）
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adoptPendingPermission,
  getSnapshot,
  subscribe,
} from '@/lib/stream-session-manager';
import type { PermissionRequestEvent, StreamEvent } from '@/types';

function uniqueSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEvent(permissionRequestId: string): PermissionRequestEvent {
  return {
    permissionRequestId,
    toolName: 'AskUserQuestion',
    toolInput: { questions: [{ question: '选哪个', header: 'h', options: [] }] },
    toolUseId: '',
  };
}

describe('adoptPendingPermission — 卡片恢复', () => {
  it('无活动流时也会广播，订阅方拿得到卡片', () => {
    const sessionId = uniqueSessionId('test-adopt');
    const received: StreamEvent[] = [];
    const unsubscribe = subscribe(sessionId, (event) => received.push(event));
    try {
      const event = makeEvent(`perm-${sessionId}`);
      const adopted = adoptPendingPermission(sessionId, event);

      assert.equal(adopted, true);
      assert.equal(received.length, 1, '占位快照必须广播，否则已挂载的视图收不到卡片');
      assert.equal(received[0].type, 'permission-request');
      assert.deepEqual(received[0].snapshot.pendingPermission, event);
      assert.equal(received[0].snapshot.permissionResolved, null);
    } finally {
      unsubscribe();
    }
  });

  it('广播后 getSnapshot 能读回 pending', () => {
    const sessionId = uniqueSessionId('test-adopt-snapshot');
    const event = makeEvent(`perm-${sessionId}`);

    adoptPendingPermission(sessionId, event);

    const snapshot = getSnapshot(sessionId);
    assert.ok(snapshot, '占位快照应当可被读取（startedAt 非 0）');
    assert.deepEqual(snapshot.pendingPermission, event);
  });

  it('已有 pending 时不覆盖，也不重复广播', () => {
    const sessionId = uniqueSessionId('test-adopt-existing');
    const received: StreamEvent[] = [];
    const first = makeEvent(`perm-first-${sessionId}`);

    adoptPendingPermission(sessionId, first);
    const unsubscribe = subscribe(sessionId, (e) => received.push(e));
    try {
      const adopted = adoptPendingPermission(sessionId, makeEvent(`perm-second-${sessionId}`));

      assert.equal(adopted, false, '已有待答卡片时不应顶掉它');
      assert.equal(received.length, 0, '未注入就不应发事件');
      assert.deepEqual(getSnapshot(sessionId)?.pendingPermission, first);
    } finally {
      unsubscribe();
    }
  });

  it('缺少 permissionRequestId 时直接拒绝，不留下空快照', () => {
    const sessionId = uniqueSessionId('test-adopt-invalid');
    const adopted = adoptPendingPermission(sessionId, {
      ...makeEvent(''),
    } as PermissionRequestEvent);

    assert.equal(adopted, false);
    assert.equal(getSnapshot(sessionId), null);
  });
});
