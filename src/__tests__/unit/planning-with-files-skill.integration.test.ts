import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initPlanningWithFilesSkill } from '../../lib/planning-with-files';

describe('planning-with-files skill module (integration)', () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-pwf-home-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
    else delete process.env.USERPROFILE;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('appears in /api/skills after installation to ~/.claude/skills', async () => {
    const SKILL_MD = `---\nname: planning-with-files\ndescription: integration test\n---\n\n# planning-with-files\n`;
    const fetchImpl = async () => new Response(SKILL_MD, { status: 200 });

    const claudeSkillsDir = path.join(tempHome, '.claude', 'skills');
    const agentsSkillsDir = path.join(tempHome, '.agents', 'skills');
    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir, agentsSkillsDir },
      cache: { enabled: false },
      logLevel: 'silent',
      timeoutMs: 1000,
    });

    await svc.install({ target: 'claude', scope: 'global', force: true });

    const { GET } = await import('../../app/api/skills/route');
    const req = { nextUrl: new URL('http://localhost/api/skills') } as unknown as import('next/server').NextRequest;
    const resp = await GET(req);
    const data = await resp.json();
    const all = Array.isArray(data?.skills) ? data.skills : [];
    assert.ok(all.some((s: any) => s?.name === 'planning-with-files'), 'planning-with-files should be returned by skills API');
  });
});

