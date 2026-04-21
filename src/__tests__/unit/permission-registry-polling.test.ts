import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPermissionRequest, createSession, resolvePermissionRequest } from '@/lib/db';
import { registerPendingPermission } from '@/lib/permission-registry';

describe('permission-registry — DB polling fallback', () => {
  it('resolves pending permission via DB when in-memory waiter is not available', async () => {
    const permissionRequestId = `test-perm-${Date.now()}`;
    const sessionId = createSession('test-session').id;

    // 先创建权限请求记录
    createPermissionRequest({
      id: permissionRequestId,
      sessionId,
      toolName: 'AskUserQuestion',
      toolInput: JSON.stringify({ questions: [] }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // 先 resolve DB 记录
    resolvePermissionRequest(permissionRequestId, 'allow', {
      updatedPermissions: [],
      updatedInput: {
        questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
        answers: { Q1: 'A' },
      },
    });

    // 然后注册 pending permission，此时 DB 已经是 resolved 状态
    // 轮询应该立即发现 resolved 状态
    const pending = registerPendingPermission(permissionRequestId, {
      questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
    });

    const result = await pending;
    assert.equal(result.behavior, 'allow');
    assert.ok(result.updatedInput);
    assert.deepEqual((result.updatedInput as any).answers, { Q1: 'A' });
  });
});
