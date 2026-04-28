/**
 * Simple line-based diff utility.
 */

export interface LineDiffStats {
  added: number;
  removed: number;
}

export type DiffChangeType = 'added' | 'removed' | 'unchanged';

export interface DiffLine {
  type: DiffChangeType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Calculate basic line-based diff stats between two strings.
 */
export function calculateLineDiff(oldStr: string, newStr: string): LineDiffStats {
  const diff = computeDiff(oldStr, newStr);
  return {
    added: diff.filter(l => l.type === 'added').length,
    removed: diff.filter(l => l.type === 'removed').length,
  };
}

/**
 * A simple line-based diffing algorithm (LCS-based or similar).
 * For now, we'll use a simpler version that handles basic additions/deletions.
 */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = (oldStr || '').replace(/\r\n/g, '\n').split('\n');
  const newLines = (newStr || '').replace(/\r\n/g, '\n').split('\n');

  type Op =
    | { kind: 'equal'; line: string }
    | { kind: 'insert'; line: string }
    | { kind: 'delete'; line: string };

  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 1);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  const backtrack = (t: Int32Array[]): Op[] => {
    const ops: Op[] = [];
    let x = n;
    let y = m;

    for (let d = t.length - 1; d > 0; d--) {
      const vCur = t[d];
      const k = x - y;
      const kIndex = k + offset;
      const prevK =
        k === -d || (k !== d && vCur[kIndex - 1] < vCur[kIndex + 1])
          ? k + 1
          : k - 1;

      const vPrev = t[d - 1];
      const prevX = vPrev[prevK + offset];
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        ops.push({ kind: 'equal', line: oldLines[x - 1] });
        x--;
        y--;
      }

      if (x === prevX) {
        ops.push({ kind: 'insert', line: newLines[y - 1] });
        y--;
      } else {
        ops.push({ kind: 'delete', line: oldLines[x - 1] });
        x--;
      }
    }

    while (x > 0 && y > 0) {
      ops.push({ kind: 'equal', line: oldLines[x - 1] });
      x--;
      y--;
    }
    while (x > 0) {
      ops.push({ kind: 'delete', line: oldLines[x - 1] });
      x--;
    }
    while (y > 0) {
      ops.push({ kind: 'insert', line: newLines[y - 1] });
      y--;
    }

    ops.reverse();
    return ops;
  };

  const buildOps = (): Op[] => {
    for (let d = 0; d <= max; d++) {
      const vNext = v.slice();
      for (let k = -d; k <= d; k += 2) {
        const kIndex = k + offset;
        let x: number;
        if (k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1])) {
          x = v[kIndex + 1];
        } else {
          x = v[kIndex - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && oldLines[x] === newLines[y]) {
          x++;
          y++;
        }
        vNext[kIndex] = x;
        if (x >= n && y >= m) {
          trace.push(vNext);
          return backtrack(trace);
        }
      }
      trace.push(vNext);
      v = vNext;
    }
    return backtrack(trace);
  };

  const ops = buildOps();

  const result: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const op of ops) {
    if (op.kind === 'equal') {
      result.push({ type: 'unchanged', content: op.line, oldLineNumber: oldNo, newLineNumber: newNo });
      oldNo++;
      newNo++;
    } else if (op.kind === 'delete') {
      result.push({ type: 'removed', content: op.line, oldLineNumber: oldNo });
      oldNo++;
    } else {
      result.push({ type: 'added', content: op.line, newLineNumber: newNo });
      newNo++;
    }
  }

  return result;
}
