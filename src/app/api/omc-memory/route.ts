import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface ProjectMemory {
  version?: string;
  lastScanned?: number;
  projectRoot?: string;
  techStack?: Record<string, unknown>;
  build?: Record<string, unknown>;
  conventions?: Record<string, unknown>;
  structure?: Record<string, unknown>;
  customNotes?: string[];
  userDirectives?: string;
  hotPaths?: Array<{ path: string; accessCount: number; lastAccessed: number; type: string }>;
  directoryMap?: Record<string, unknown>;
}

interface SharedMemoryEntry {
  key: string;
  value: unknown;
  namespace: string;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
  expiresAt?: string;
}

/** Read project memory from .omc/project-memory.json */
function readProjectMemory(dir: string): ProjectMemory | null {
  const filePath = join(dir, '.omc', 'project-memory.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Read all shared memory entries from .omc/state/shared-memory/ */
function readSharedMemory(dir: string): SharedMemoryEntry[] {
  const baseDir = join(dir, '.omc', 'state', 'shared-memory');
  if (!existsSync(baseDir)) return [];
  const entries: SharedMemoryEntry[] = [];
  try {
    const namespaces = readdirSync(baseDir).filter(f => {
      const fp = join(baseDir, f);
      return statSync(fp).isDirectory();
    });
    for (const ns of namespaces) {
      const nsDir = join(baseDir, ns);
      const files = readdirSync(nsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const entry: SharedMemoryEntry = JSON.parse(readFileSync(join(nsDir, file), 'utf-8'));
          // Skip expired entries
          if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) continue;
          entries.push(entry);
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* ignore */ }
  return entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get('dir');
  if (!dir) {
    return NextResponse.json({ error: 'Missing dir parameter' }, { status: 400 });
  }

  const projectMemory = readProjectMemory(dir);
  const sharedMemory = readSharedMemory(dir);

  return NextResponse.json({ projectMemory, sharedMemory });
}
