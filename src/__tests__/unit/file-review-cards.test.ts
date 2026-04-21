import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractDiff } from '../../components/ai-elements/tool-actions-group';

describe('file review cards — extractDiff', () => {
  it('parses apply_patch diff', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: /tmp/example.ts',
      '@@',
      '- const a = 1;',
      '+ const a = 2;',
      '*** End Patch',
      '',
    ].join('\n');

    const diff = extractDiff({ name: 'apply_patch', input: { patch } } as any);
    assert.ok(diff);
    assert.equal(diff.fullPath, '/tmp/example.ts');
    assert.equal(diff.mode, 'edit');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
  });

  it('parses mcp filesystem edit_file edits', () => {
    const diff = extractDiff({
      name: 'mcp__filesystem__edit_file',
      input: { path: '/tmp/example.ts', edits: [{ oldText: 'a', newText: 'b' }] },
    } as any);
    assert.ok(diff);
    assert.equal(diff.fullPath, '/tmp/example.ts');
    assert.equal(diff.mode, 'edit');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
  });

  it('parses mcp filesystem write_file content', () => {
    const diff = extractDiff({
      name: 'mcp__filesystem__write_file',
      input: { path: '/tmp/new.ts', content: 'line1\nline2\n' },
    } as any);
    assert.ok(diff);
    assert.equal(diff.fullPath, '/tmp/new.ts');
    assert.equal(diff.mode, 'create');
    assert.equal(diff.added, 3);
    assert.equal(diff.removed, 0);
  });
});

