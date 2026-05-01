import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('stream-session-manager abort reasons', () => {
  it('silently completes replaced streams instead of marking them stopped', () => {
    const manager = read('src/lib/stream-session-manager.ts');

    assert.match(manager, /abortReason: 'manual_stop' \| 'stream_replaced' \| null/);
    assert.match(manager, /existing\.abortReason = 'stream_replaced'/);
    assert.match(manager, /if \(stream\.abortReason === 'stream_replaced'\)/);
    assert.doesNotMatch(
      manager,
      /stream\.abortReason === 'stream_replaced'[\s\S]{0,240}generation stopped/,
    );
  });
});
