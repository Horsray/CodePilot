import { NextResponse } from 'next/server';
import { getAllSessions } from '@/lib/db';
import { getExternalInstructionCandidates, getInstructionSearchRoots } from '@/lib/agent-system-prompt';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const sessions = getAllSessions();
    const discoveredRules: Array<{ projectName: string, path: string, content: string, scope: 'project' | 'global' | 'user' }> = [];
    const seenPaths = new Set<string>();
    const seenWorkingDirectories = new Set<string>();

    for (const candidate of getExternalInstructionCandidates()) {
      if (seenPaths.has(candidate.filePath)) continue;
      seenPaths.add(candidate.filePath);
      try {
        const content = fs.readFileSync(candidate.filePath, 'utf-8');
        discoveredRules.push({
          projectName: candidate.label,
          path: candidate.filePath,
          content: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
          scope: candidate.level === 'user' ? 'user' : 'global',
        });
      } catch {
        // skip if access denied or error
      }
    }

    for (const session of sessions) {
      const wd = session.working_directory;
      if (!wd || seenWorkingDirectories.has(wd)) continue;
      seenWorkingDirectories.add(wd);

      for (const root of getInstructionSearchRoots(wd)) {
        const rulesPath = path.join(root, '.trae', 'rules', 'rules.md');
        if (seenPaths.has(rulesPath)) continue;
        try {
          if (fs.existsSync(rulesPath) && fs.statSync(rulesPath).isFile()) {
            const content = fs.readFileSync(rulesPath, 'utf-8');
            discoveredRules.push({
              projectName: root === wd ? (session.project_name || path.basename(wd)) : `${session.project_name || path.basename(wd)} (${path.basename(root)})`,
              path: rulesPath,
              content: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
              scope: 'project',
            });
            seenPaths.add(rulesPath);
          }
        } catch {
          // skip if access denied or error
        }
      }
    }

    return NextResponse.json({ discoveredRules });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
