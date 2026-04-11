import { NextResponse } from 'next/server';
import { getAllSessions } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const sessions = getAllSessions();
    const discoveredRules: Array<{ projectName: string, path: string, content: string }> = [];
    const seenPaths = new Set<string>();

    for (const session of sessions) {
      const wd = session.working_directory;
      if (!wd || seenPaths.has(wd)) continue;
      seenPaths.add(wd);

      const rulesPath = path.join(wd, '.trae', 'rules', 'rules.md');
      try {
        if (fs.existsSync(rulesPath) && fs.statSync(rulesPath).isFile()) {
          const content = fs.readFileSync(rulesPath, 'utf-8');
          discoveredRules.push({
            projectName: session.project_name || path.basename(wd),
            path: wd,
            content: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
          });
        }
      } catch {
        // skip if access denied or error
      }
    }

    return NextResponse.json({ discoveredRules });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
