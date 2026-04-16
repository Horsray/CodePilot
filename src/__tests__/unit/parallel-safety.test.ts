import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDestructiveCommand,
  pathsOverlap,
  extractScopePath,
  shouldParallelizeToolBatch,
  PARALLEL_SAFE_TOOLS,
  PATH_SCOPED_TOOLS,
  NEVER_PARALLEL_TOOLS,
  MAX_PARALLEL_TOOL_WORKERS,
  type ToolCallDescriptor,
} from '../../lib/parallel-safety';

describe('parallel-safety — constants', () => {
  it('MAX_PARALLEL_TOOL_WORKERS matches Hermes (8)', () => {
    assert.equal(MAX_PARALLEL_TOOL_WORKERS, 8);
  });

  it('Read is in both PARALLEL_SAFE_TOOLS and PATH_SCOPED_TOOLS', () => {
    assert.ok(PARALLEL_SAFE_TOOLS.has('Read'));
    assert.ok(PATH_SCOPED_TOOLS.has('Read'));
  });

  it('Write and Edit are path-scoped but not parallel-safe', () => {
    assert.ok(PATH_SCOPED_TOOLS.has('Write'));
    assert.ok(PATH_SCOPED_TOOLS.has('Edit'));
    assert.ok(!PARALLEL_SAFE_TOOLS.has('Write'));
    assert.ok(!PARALLEL_SAFE_TOOLS.has('Edit'));
  });

  it('NEVER_PARALLEL_TOOLS defaults to empty', () => {
    assert.equal(NEVER_PARALLEL_TOOLS.size, 0);
  });
});

describe('parallel-safety — isDestructiveCommand', () => {
  it('plain ls is not destructive', () => {
    assert.equal(isDestructiveCommand('ls -la'), false);
  });

  it('rm -rf is destructive', () => {
    assert.equal(isDestructiveCommand('rm -rf /tmp/stuff'), true);
  });

  it('mv is destructive', () => {
    assert.equal(isDestructiveCommand('mv a b'), true);
  });

  it('sed -i is destructive', () => {
    assert.equal(isDestructiveCommand("sed -i 's/foo/bar/' file.txt"), true);
  });

  it('git reset is destructive', () => {
    assert.equal(isDestructiveCommand('git reset --hard HEAD'), true);
  });

  it('overwrite redirect is destructive', () => {
    assert.equal(isDestructiveCommand('echo hi > /tmp/out.txt'), true);
  });

  it('append redirect is not destructive', () => {
    assert.equal(isDestructiveCommand('echo hi >> /tmp/out.txt'), false);
  });
});

describe('parallel-safety — pathsOverlap', () => {
  it('identical paths overlap', () => {
    assert.equal(pathsOverlap('/a/b/c', '/a/b/c'), true);
  });

  it('parent and child overlap', () => {
    assert.equal(pathsOverlap('/a/b', '/a/b/c'), true);
    assert.equal(pathsOverlap('/a/b/c', '/a/b'), true);
  });

  it('siblings do not overlap', () => {
    assert.equal(pathsOverlap('/a/b', '/a/c'), false);
  });
});

describe('parallel-safety — extractScopePath', () => {
  const cwd = '/tmp/testcwd';

  it('returns null for non-path-scoped tools', () => {
    assert.equal(extractScopePath('Grep', { pattern: 'foo' }, cwd), null);
  });

  it('resolves relative Read path against cwd', () => {
    const result = extractScopePath('Read', { path: 'foo/bar.txt' }, cwd);
    assert.equal(result, '/tmp/testcwd/foo/bar.txt');
  });

  it('uses file_path for Write', () => {
    const result = extractScopePath('Write', { file_path: '/abs/path.txt' }, cwd);
    assert.equal(result, '/abs/path.txt');
  });
});

describe('parallel-safety — shouldParallelizeToolBatch', () => {
  const cwd = '/tmp/testcwd';

  it('singleton batch is not parallelized', () => {
    const calls: ToolCallDescriptor[] = [{ name: 'Read', args: { path: 'a.txt' } }];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('extraNeverParallelTools forces serialize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'AskUser', args: {} },
    ];
    const result = shouldParallelizeToolBatch(calls, {
      cwd,
      extraNeverParallelTools: new Set(['AskUser']),
    });
    assert.equal(result, false);
  });

  it('two Reads of different files parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Read', args: { path: 'b.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('two Reads of the same file do not parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Read', args: { path: 'a.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('two Grep calls parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Grep', args: { pattern: 'foo' } },
      { name: 'Grep', args: { pattern: 'bar' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('Read + Bash does not parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Bash', args: { command: 'ls' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });
});
