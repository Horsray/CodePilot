/**
 * parallel-safety.ts — Safe parallel tool execution judgment.
 *
 * Design philosophy: default serial, parallelize only when proven safe.
 */

import path from 'path';

export const NEVER_PARALLEL_TOOLS: ReadonlySet<string> = new Set<string>([]);

export const PARALLEL_SAFE_TOOLS: ReadonlySet<string> = new Set<string>([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'codepilot_memory_search',
  'codepilot_memory_get',
  'codepilot_memory_recent',
]);

export const PATH_SCOPED_TOOLS: ReadonlySet<string> = new Set<string>([
  'Read',
  'Write',
  'Edit',
]);

export const MAX_PARALLEL_TOOL_WORKERS = 8;

const DESTRUCTIVE_PATTERNS = new RegExp(
  [
    '(?:^|\\s|&&|\\|\\||;|`)(?:',
    'rm\\s|rmdir\\s|',
    'mv\\s|',
    'sed\\s+-i|',
    'truncate\\s|',
    'dd\\s|',
    'shred\\s|',
    'git\\s+(?:reset|clean|checkout)\\s',
    ')',
  ].join(''),
);

const REDIRECT_OVERWRITE = /[^>]>[^>]|^>[^>]/;

export function isDestructiveCommand(cmd: string): boolean {
  if (!cmd) return false;
  if (DESTRUCTIVE_PATTERNS.test(cmd)) return true;
  if (REDIRECT_OVERWRITE.test(cmd)) return true;
  return false;
}

function splitPath(p: string): string[] {
  return path.normalize(p).split(/[/\\]/).filter(Boolean);
}

export function pathsOverlap(left: string, right: string): boolean {
  const leftParts = splitPath(left);
  const rightParts = splitPath(right);
  if (leftParts.length === 0 || rightParts.length === 0) {
    return leftParts.length === rightParts.length && leftParts.length > 0;
  }
  const commonLen = Math.min(leftParts.length, rightParts.length);
  for (let i = 0; i < commonLen; i++) {
    if (leftParts[i] !== rightParts[i]) return false;
  }
  return true;
}

export function extractScopePath(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string = process.cwd(),
): string | null {
  if (!PATH_SCOPED_TOOLS.has(toolName)) return null;

  const rawPath =
    (typeof args.file_path === 'string' ? args.file_path : null) ??
    (typeof args.path === 'string' ? args.path : null);

  if (rawPath === null || rawPath.trim() === '') return null;

  let expanded = rawPath;
  if (expanded.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      expanded = path.join(home, expanded.slice(1));
    }
  }

  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.normalize(path.join(cwd, expanded));
}

export interface ToolCallDescriptor {
  name: string;
  args: Record<string, unknown>;
}

export interface ShouldParallelizeOptions {
  cwd?: string;
  extraNeverParallelTools?: ReadonlySet<string>;
}

export function shouldParallelizeToolBatch(
  calls: readonly ToolCallDescriptor[],
  opts: ShouldParallelizeOptions = {},
): boolean {
  if (calls.length <= 1) return false;

  const cwd = opts.cwd ?? process.cwd();
  const extraNeverParallel = opts.extraNeverParallelTools;

  for (const call of calls) {
    if (NEVER_PARALLEL_TOOLS.has(call.name)) return false;
    if (extraNeverParallel && extraNeverParallel.has(call.name)) return false;
  }

  const reservedPaths: string[] = [];
  for (const call of calls) {
    if (PATH_SCOPED_TOOLS.has(call.name)) {
      const scope = extractScopePath(call.name, call.args, cwd);
      if (scope === null) return false;
      for (const existing of reservedPaths) {
        if (pathsOverlap(scope, existing)) return false;
      }
      reservedPaths.push(scope);
      continue;
    }

    if (!PARALLEL_SAFE_TOOLS.has(call.name)) return false;
  }

  return true;
}
