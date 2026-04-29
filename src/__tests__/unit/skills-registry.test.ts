import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempHome = '';
let tempProject = '';
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-skill-reg-home-'));
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-skill-reg-proj-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  fs.rmSync(tempHome, { recursive: true, force: true });
  fs.rmSync(tempProject, { recursive: true, force: true });
});

describe('skills-registry', () => {
  it('deduplicates project skill directories when a project command uses the same name', async () => {
    const commandsDir = path.join(tempProject, '.claude', 'commands');
    const skillsDir = path.join(tempProject, '.claude', 'skills', 'review');
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(path.join(commandsDir, 'review.md'), '# review command', 'utf-8');
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      `---
name: review
description: review skill
---
# review skill
`,
      'utf-8',
    );

    const { discoverEffectiveSkillFiles } = await import('@/lib/skills-registry');
    const skills = discoverEffectiveSkillFiles({ cwd: tempProject }).filter((skill) => skill.name === 'review');
    assert.equal(skills.length, 1);
    assert.equal(skills[0].filePath.endsWith(path.join('.claude', 'commands', 'review.md')), true);
  });

  it('prefers one installed skill copy when agents and claude copies are identical', async () => {
    const agentsDir = path.join(tempHome, '.agents', 'skills', 'sync-docs');
    const claudeDir = path.join(tempHome, '.claude', 'skills', 'sync-docs');
    fs.mkdirSync(agentsDir, { recursive: true });
    const content = `---
name: sync-docs
description: sync docs quickly
---
# sync docs
`;
    fs.writeFileSync(path.join(agentsDir, 'SKILL.md'), content, 'utf-8');

    const { discoverEffectiveSkillFiles } = await import('@/lib/skills-registry');
    const skills = discoverEffectiveSkillFiles({ cwd: tempProject }).filter((skill) => skill.name === 'sync-docs');
    assert.equal(skills.length, 1);
    assert.equal(skills[0].source, 'global');
    assert.equal(skills[0].filePath.endsWith(path.join('.claude', 'skills', 'sync-docs', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(claudeDir, 'SKILL.md')), true);
  });

  it('includes OMC skill directories in unified discovery', async () => {
    const omcGlobalDir = path.join(tempHome, '.omc', 'skills');
    const omcLearnedDir = path.join(tempHome, '.claude', 'skills', 'omc-learned');
    const omcProjectDir = path.join(tempProject, '.omc', 'skills');
    fs.mkdirSync(omcGlobalDir, { recursive: true });
    fs.mkdirSync(omcLearnedDir, { recursive: true });
    fs.mkdirSync(omcProjectDir, { recursive: true });

    fs.writeFileSync(
      path.join(omcGlobalDir, 'global-memory.md'),
      `---
name: global-memory
description: global omc skill
---
# global memory
`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(omcLearnedDir, 'learned-memory.md'),
      `---
name: learned-memory
description: learned omc skill
---
# learned memory
`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(omcProjectDir, 'project-memory.md'),
      `---
name: project-memory
description: project omc skill
---
# project memory
`,
      'utf-8',
    );

    const { discoverEffectiveSkillFiles } = await import('@/lib/skills-registry');
    const skills = discoverEffectiveSkillFiles({ cwd: tempProject });

    assert.equal(skills.some((skill) => skill.filePath.endsWith(path.join('.omc', 'skills', 'global-memory.md'))), true);
    assert.equal(skills.some((skill) => skill.filePath.endsWith(path.join('.claude', 'skills', 'omc-learned', 'learned-memory.md'))), true);
    assert.equal(skills.some((skill) => skill.filePath.endsWith(path.join('.omc', 'skills', 'project-memory.md'))), true);
  });

  it('includes marketplace root plugin skills in unified discovery', async () => {
    const omcPluginSkillsDir = path.join(tempHome, '.claude', 'plugins', 'marketplaces', 'omc', 'skills', 'team');
    fs.mkdirSync(path.join(tempHome, '.claude', 'plugins', 'marketplaces', 'omc', '.claude-plugin'), { recursive: true });
    fs.mkdirSync(omcPluginSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, '.claude', 'plugins', 'marketplaces', 'omc', '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'oh-my-claudecode',
        description: 'OMC plugin',
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(omcPluginSkillsDir, 'SKILL.md'),
      `---
name: omc-team
description: OMC team workflow
---
# OMC Team
`,
      'utf-8',
    );

    const { discoverEffectiveSkillFiles } = await import('@/lib/skills-registry');
    const skills = discoverEffectiveSkillFiles({ cwd: tempProject });

    assert.equal(
      skills.some((skill) => skill.filePath.endsWith(path.join('.claude', 'plugins', 'marketplaces', 'omc', 'skills', 'team', 'SKILL.md'))),
      true,
    );
  });
});
