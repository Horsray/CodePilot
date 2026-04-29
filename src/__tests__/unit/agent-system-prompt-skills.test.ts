import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDiscoveredSkillsCatalog, buildSystemPrompt } from '@/lib/agent-system-prompt';
import { invalidateSkillCache } from '@/lib/skill-discovery';

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function swapTempHome(tempHome: string) {
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
}

afterEach(() => {
  invalidateSkillCache();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('buildDiscoveredSkillsCatalog', () => {
  it('summarizes discovered skills without inlining full skill bodies', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-skill-catalog-'));
    tempDirs.push(tmpDir);
    swapTempHome(tmpDir);

    const skillDir = path.join(tmpDir, '.claude', 'skills', 'smart-review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: smart-review
description: Review risky code paths quickly
when_to_use: When the user asks for code review or regression analysis
context: inline
---
# Smart Review

This is a long body that should not be injected directly into the system prompt.
Use multiple passes and end with findings first.
`,
      'utf8',
    );

    invalidateSkillCache();
    const catalog = buildDiscoveredSkillsCatalog(tmpDir);

    assert.ok(catalog, 'expected a catalog to be generated');
    assert.match(catalog!, /smart-review/);
    assert.match(catalog!, /Review risky code paths quickly/);
    assert.match(catalog!, /When the user asks for code review or regression analysis/);
    assert.doesNotMatch(catalog!, /This is a long body that should not be injected directly/);
  });

  it('keeps a lightweight skills visibility index when OMC is enabled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-omc-skill-catalog-'));
    tempDirs.push(tmpDir);
    swapTempHome(tmpDir);

    const skillDir = path.join(tmpDir, '.claude', 'skills', 'auto-review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: auto-review
description: Review code paths
when_to_use: When the user asks for reviews
---
# Auto Review
`,
      'utf8',
    );

    invalidateSkillCache();
    const promptWithoutOmc = buildSystemPrompt({ workingDirectory: tmpDir, omcPluginEnabled: false });
    const promptWithOmc = buildSystemPrompt({ workingDirectory: tmpDir, omcPluginEnabled: true });

    assert.match(promptWithoutOmc.prompt, /Auto-Discovered Skills Catalog/);
    assert.doesNotMatch(promptWithOmc.prompt, /Auto-Discovered Skills Catalog/);
    assert.match(promptWithOmc.prompt, /Lightweight Skills Visibility/);
    assert.match(promptWithOmc.prompt, /auto-review/);
  });

  it('adds explicit external research guidance to the tools section', () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt.prompt, /External Research \(IMPORTANT\)/);
    assert.match(prompt.prompt, /proactively use `WebSearch` first and then `WebFetch`/);
    assert.match(prompt.prompt, /even if the user did not explicitly ask you to "search the web"/);
    assert.match(prompt.prompt, /Runtime Focus \(IMPORTANT\)/);
  });

  it('adds relevant skill hints for the current request before the broader catalog', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-relevant-skills-'));
    tempDirs.push(tmpDir);
    swapTempHome(tmpDir);

    const reviewSkillDir = path.join(tmpDir, '.claude', 'skills', 'smart-review');
    fs.mkdirSync(reviewSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewSkillDir, 'SKILL.md'),
      `---
name: code-review-helper
description: Help with code review and performance bottleneck diagnosis
when_to_use: When the user asks for code review, performance bottlenecks, or regression analysis
---
# Code Review Helper
`,
      'utf8',
    );

    const releaseSkillDir = path.join(tmpDir, '.claude', 'skills', 'release-notes');
    fs.mkdirSync(releaseSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseSkillDir, 'SKILL.md'),
      `---
name: release-notes
description: Write polished release notes
when_to_use: When the user asks for release notes or changelog drafting
---
# Release Notes
`,
      'utf8',
    );

    invalidateSkillCache();
    const prompt = buildSystemPrompt({
      workingDirectory: tmpDir,
      userPrompt: '请帮我做一次代码审查并定位性能瓶颈，先别直接改代码。',
    });

    assert.match(prompt.prompt, /Relevant Skill Hints/);
    assert.match(prompt.prompt, /code-review-helper/);
    const relevantIndex = prompt.prompt.indexOf('Relevant Skill Hints');
    const reviewIndex = prompt.prompt.indexOf('code-review-helper');
    const releaseIndex = prompt.prompt.indexOf('release-notes');
    assert.ok(relevantIndex >= 0);
    assert.ok(reviewIndex > relevantIndex);
    assert.ok(releaseIndex === -1 || reviewIndex < releaseIndex);
  });
});
