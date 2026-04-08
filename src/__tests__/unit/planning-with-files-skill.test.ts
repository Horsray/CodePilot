import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  initPlanningWithFilesSkill,
  PlanningWithFilesError,
} from '../../lib/planning-with-files';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SKILL_MD = `---
name: planning-with-files
description: test skill
---

# planning-with-files
`;

describe('planning-with-files skill module', () => {
  it('installs into global claude skills dir', async () => {
    const root = mkTempDir('codepilot-pwf-');
    const claudeSkillsDir = path.join(root, 'claude', 'skills');
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return new Response(SKILL_MD, { status: 200 });
    };

    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir, agentsSkillsDir: path.join(root, 'agents', 'skills') },
      cache: { enabled: true, ttlMs: 60_000 },
      timeoutMs: 1000,
      logLevel: 'silent',
    });

    const result = await svc.install({ target: 'claude', scope: 'global', force: true });
    assert.equal(result.installed, true);
    assert.equal(fetchCalls, 1);
    assert.ok(fs.existsSync(result.skillFilePath));
    const content = fs.readFileSync(result.skillFilePath, 'utf8');
    assert.ok(content.includes('planning-with-files'));
    assert.equal(svc.isInstalled({ target: 'claude', scope: 'global' }), true);
  });

  it('uses in-memory cache within ttl', async () => {
    const root = mkTempDir('codepilot-pwf-');
    const claudeSkillsDir = path.join(root, 'claude', 'skills');
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return new Response(SKILL_MD, { status: 200 });
    };

    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir, agentsSkillsDir: path.join(root, 'agents', 'skills') },
      cache: { enabled: true, ttlMs: 60_000 },
      timeoutMs: 1000,
      logLevel: 'silent',
    });

    await svc.install({ target: 'claude', scope: 'global', force: true });
    await svc.install({ target: 'agents', scope: 'global', force: true });
    assert.equal(fetchCalls, 1);
  });

  it('throws timeout error when fetch aborts', async () => {
    const root = mkTempDir('codepilot-pwf-');
    const claudeSkillsDir = path.join(root, 'claude', 'skills');
    const fetchImpl = (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    };

    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir, agentsSkillsDir: path.join(root, 'agents', 'skills') },
      cache: { enabled: false },
      timeoutMs: 10,
      logLevel: 'silent',
    });

    await assert.rejects(
      async () => svc.install({ target: 'claude', scope: 'global', force: true }),
      (err) => {
        assert.ok(err instanceof PlanningWithFilesError);
        assert.equal((err as PlanningWithFilesError).code, 'PWF_FETCH_TIMEOUT');
        return true;
      },
    );
  });

  it('throws write error when target dir cannot be created', async () => {
    const root = mkTempDir('codepilot-pwf-');
    const claudeSkillsDir = path.join(root, 'claude-skills-as-file');
    fs.writeFileSync(claudeSkillsDir, 'not a dir', 'utf8');

    const fetchImpl = async () => new Response(SKILL_MD, { status: 200 });

    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir, agentsSkillsDir: path.join(root, 'agents', 'skills') },
      cache: { enabled: false },
      timeoutMs: 1000,
      logLevel: 'silent',
    });

    await assert.rejects(
      async () => svc.install({ target: 'claude', scope: 'global', force: true }),
      (err) => {
        assert.ok(err instanceof PlanningWithFilesError);
        assert.equal((err as PlanningWithFilesError).code, 'PWF_WRITE_FAILED');
        return true;
      },
    );
  });

  it('installs into project scope .claude/skills', async () => {
    const root = mkTempDir('codepilot-pwf-');
    const projectRoot = path.join(root, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });

    const fetchImpl = async () => new Response(SKILL_MD, { status: 200 });
    const svc = initPlanningWithFilesSkill({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      paths: { claudeSkillsDir: path.join(root, 'claude', 'skills'), agentsSkillsDir: path.join(root, 'agents', 'skills') },
      cache: { enabled: false },
      timeoutMs: 1000,
      logLevel: 'silent',
    });

    const result = await svc.install({ target: 'claude', scope: 'project', cwd: projectRoot, force: true });
    assert.ok(result.skillFilePath.includes(path.join(projectRoot, '.claude', 'skills')));
    assert.ok(fs.existsSync(result.skillFilePath));
    assert.equal(svc.isInstalled({ target: 'claude', scope: 'project', cwd: projectRoot }), true);
  });
});

