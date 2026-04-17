import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPermissionRequest, createSession, resolvePermissionRequest } from '@/lib/db';
import { registerPendingPermission } from '@/lib/permission-registry';

describe('permission-registry — DB polling fallback', () => {
  it('resolves pending permission via DB when in-memory waiter is not available', async () => {
    const permissionRequestId = `test-perm-${Date.now()}`;
    const sessionId = createSession('test-session').id;

    createPermissionRequest({
      id: permissionRequestId,
      sessionId,
      toolName: 'AskUserQuestion',
      toolInput: JSON.stringify({ questions: [] }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const pending = registerPendingPermission(permissionRequestId, {
      questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
    });

    setTimeout(() => {
      resolvePermissionRequest(permissionRequestId, 'allow', {
        updatedPermissions: [],
        updatedInput: {
          questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
          answers: { Q1: 'A' },
        },
      });
    }, 50);

    const result = await pending;
    assert.equal(result.behavior, 'allow');
    assert.ok(result.updatedInput);
    assert.deepEqual((result.updatedInput as any).answers, { Q1: 'A' });
  });
});
