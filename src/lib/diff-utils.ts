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

  const result: DiffLine[] = [];
  
  // Use a basic LCS-based diff if possible, or a simple alignment
  // For now, let's use a standard dynamic programming LCS approach
  // to get the best alignment for diffing.
  
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({
        type: 'unchanged',
        content: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({
        type: 'added',
        content: newLines[j - 1],
        newLineNumber: j
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.unshift({
        type: 'removed',
        content: oldLines[i - 1],
        oldLineNumber: i
      });
      i--;
    }
  }

  return result;
}
