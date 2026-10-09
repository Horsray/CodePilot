import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextSegments,
  extractReadGroupItems,
  extractSearchGroupSummary,
} from '../../components/ai-elements/tool-actions-group';

describe('tool actions group aggregation', () => {
  it('merges consecutive search tools into one grouped segment', () => {
    const segments = buildContextSegments([
      {
        name: 'Glob',
        input: { pattern: '**/*.ts' },
        result: 'Found 2 files\n/src/a.ts\n/src/b.ts',
      },
      {
        name: 'Grep',
        input: { pattern: 'buildSystemPrompt' },
        result: '/src/a.ts:10:const x = 1',
      },
    ] as any);

    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.kind, 'context_group');
    assert.equal((segments[0] as any).groupType, 'search');
  });

  it('keeps search and read tools in separate grouped segments', () => {
    const segments = buildContextSegments([
      {
        name: 'Glob',
        input: { pattern: '**/*.ts' },
        result: 'Found 1 files\n/src/a.ts',
      },
      {
        name: 'Read',
        input: { file_path: '/src/a.ts' },
        result: 'file content',
      },
      {
        name: 'Read',
        input: { file_path: '/src/b.ts' },
        result: 'other content',
      },
    ] as any);

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.kind, 'context_single');
    assert.equal(segments[1]?.kind, 'context_group');
    assert.equal((segments[1] as any).groupType, 'read');
  });

  it('extracts unique file paths for grouped read details', () => {
    const items = extractReadGroupItems([
      {
        name: 'Read',
        input: { file_path: '/src/a.ts' },
      },
      {
        name: 'mcp__filesystem__read_multiple_files',
        input: { paths: ['/src/a.ts', '/src/b.ts'] },
      },
    ] as any);

    assert.deepEqual(
      items.map((item) => item.path),
      ['/src/a.ts', '/src/b.ts'],
    );
  });

  it('deduplicates repeated search hits in grouped summary', () => {
    const summary = extractSearchGroupSummary([
      {
        name: 'Glob',
        input: { pattern: '**/*.ts' },
        result: 'Found 2 files\n/src/a.ts\n/src/a.ts',
      },
      {
        name: 'Grep',
        input: { pattern: 'foo' },
        result: '/src/a.ts:12:foo',
      },
    ] as any);

    assert.equal(summary.queryCount, 2);
    assert.equal(summary.resultCount, 1);
  });

  it('hides consecutive duplicate tool executions such as repeated webfetch', () => {
    const segments = buildContextSegments([
      {
        name: 'WebFetch',
        input: { url: 'https://example.com/docs' },
        result: 'doc content',
      },
      {
        name: 'WebFetch',
        input: { url: 'https://example.com/docs' },
        result: 'doc content',
      },
      {
        name: 'Read',
        input: { file_path: '/src/a.ts' },
        result: 'file content',
      },
    ] as any);

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.kind, 'context_single');
    assert.equal((segments[0] as any).tool.name, 'WebFetch');
  });
});
