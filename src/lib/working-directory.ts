import fs from 'fs';
import os from 'os';
import path from 'path';

export type WorkingDirectorySource =
  | 'requested'
  | 'binding'
  | 'session_sdk_cwd'
  | 'session_working_directory'
  | 'setting'
  | 'home'
  | 'process';

export interface WorkingDirectoryCandidate {
  path?: string | null;
  source: Exclude<WorkingDirectorySource, 'home' | 'process'>;
}

export interface ResolvedWorkingDirectory {
  path: string;
  source: WorkingDirectorySource;
  invalidCandidates: Array<{
    source: WorkingDirectoryCandidate['source'];
    path: string;
  }>;
}

export function isExistingDirectory(pathValue?: string | null): pathValue is string {
  if (typeof pathValue !== 'string') return false;
  const trimmed = pathValue.trim();
  if (!trimmed) return false;

  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

export function resolveWorkingDirectory(
  candidates: WorkingDirectoryCandidate[],
): ResolvedWorkingDirectory {
  const invalidCandidates: ResolvedWorkingDirectory['invalidCandidates'] = [];

  for (const candidate of candidates) {
    const value = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!value) continue;

    if (isExistingDirectory(value)) {
      // DANGER: Never allow the bare home directory to be used as a workspace
      // for bridge/mobile sessions or any fallback, as it triggers massive filesystem scans and freezes.
      if (value === os.homedir()) {
        console.warn(`[working-directory] Refusing to use bare home directory from source '${candidate.source}' to prevent lockups. Skipping.`);
        invalidCandidates.push({ source: candidate.source, path: value });
        continue;
      }

      return {
        path: value,
        source: candidate.source,
        invalidCandidates,
      };
    }

    invalidCandidates.push({ source: candidate.source, path: value });
  }

  // Fallback to a safe empty directory to prevent native runtime from scanning massive home dirs
  const safeFallback = path.join(os.homedir(), '.codepilot', 'bridge-workspace');
  if (!fs.existsSync(safeFallback)) {
    fs.mkdirSync(safeFallback, { recursive: true });
  }

  if (isExistingDirectory(safeFallback)) {
    return {
      path: safeFallback,
      source: 'home',
      invalidCandidates,
    };
  }

  return {
    path: process.cwd(),
    source: 'process',
    invalidCandidates,
  };
}
