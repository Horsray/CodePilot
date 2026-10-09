import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('right-side Git toolbar shows the current uncommitted-file count in a blue circular badge', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/layout/PanelToolbar.tsx'),
    'utf8',
  );

  assert.match(source, /gitDirtyCount/);
  assert.match(source, /count=\{gitDirtyCount\}/);
  assert.match(source, /count !== undefined && count > 0/);
  assert.match(source, /bg-blue-500/);
  assert.match(source, /rounded-full/);
  assert.match(source, /count > 99 \? '99\+' : count/);
});
