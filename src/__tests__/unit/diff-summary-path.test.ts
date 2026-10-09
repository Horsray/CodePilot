import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDisplayPath } from '@/components/chat/DiffSummary';

test('diff summary display path preserves the filename and nearest directories', () => {
  assert.equal(
    formatDisplayPath('/Users/example/projects/codepilot/src/components/chat/DiffSummary.tsx'),
    '…/components/chat/DiffSummary.tsx',
  );
});

test('diff summary display path keeps short paths unchanged', () => {
  assert.equal(formatDisplayPath('src/chat.tsx'), 'src/chat.tsx');
});
