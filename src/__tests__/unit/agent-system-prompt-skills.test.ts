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

  it('auto-injects lightweight skill catalog into the desktop system prompt', () => {
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
    // 中文注释：技能目录现在会以轻量索引形式注入系统提示，
    // 让模型在复杂任务开始前能主动发现可用的 Skill。
    const prompt = buildSystemPrompt({ workingDirectory: tmpDir });
    assert.match(prompt.prompt, /Lightweight Skills Visibility/);
    assert.match(prompt.prompt, /auto-review/);
    assert.doesNotMatch(prompt.prompt, /This is a long body/);
  });

  it('restores historical desktop orchestration guidance with self-improvement and memory rules', () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt.prompt, /# CodePilot Host Supplement|# Identity/);
    assert.match(prompt.prompt, /HueyingAgent/);
    assert.match(prompt.prompt, /TodoWrite First for Complex Work|TodoWrite Triggers/);
    assert.match(prompt.prompt, /Always check available skills before starting complex multi-step tasks/i);
    assert.match(prompt.prompt, /TodoWrite/);
    assert.match(prompt.prompt, /Agent/);
    assert.match(prompt.prompt, /WebSearch/);
    assert.match(prompt.prompt, /self-improvement/);
    assert.match(prompt.prompt, /codepilot_memory_recent/);
    assert.match(prompt.prompt, /codepilot_kb_search/);
    assert.match(prompt.prompt, /Output Hygiene|Formatting and Output|Executing actions with care/);
    assert.doesNotMatch(prompt.prompt, /Runtime Focus \(IMPORTANT\)/);
  });

  it('injects lightweight skill catalog but not request-specific skill hints', () => {
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
    });

    // 中文注释：轻量级技能目录索引现在会注入系统提示，
    // 但 "Relevant Skill Hints"（请求级别的技能提示）不会注入。
    assert.match(prompt.prompt, /Lightweight Skills Visibility/);
    assert.match(prompt.prompt, /code-review-helper/);
    assert.match(prompt.prompt, /release-notes/);
    assert.doesNotMatch(prompt.prompt, /Relevant Skill Hints/);
    assert.doesNotMatch(prompt.prompt, /# User Instructions/);
  });

  it('does not inline native CLAUDE or AGENTS files into the appended host prompt', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-native-rules-'));
    tempDirs.push(tmpDir);
    swapTempHome(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Native Claude\nRead FILEMAP first.\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Native Agents\nUse /team when needed.\n', 'utf8');

    const prompt = buildSystemPrompt({ workingDirectory: tmpDir });
    assert.doesNotMatch(prompt.prompt, /Native Claude|Read FILEMAP first|Use \/team when needed/);
  });
});
