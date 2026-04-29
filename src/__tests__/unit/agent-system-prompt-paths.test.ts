import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getExternalInstructionCandidates, getInstructionSearchRoots, matchesProjectRulePaths, normalizeInstructionPathForMatch } from '@/lib/agent-system-prompt';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizeInstructionPathForMatch', () => {
  it('returns an absolute normalized path', () => {
    const normalized = normalizeInstructionPathForMatch('./src');
    assert.equal(path.isAbsolute(normalized), true);
  });
});

describe('matchesProjectRulePaths', () => {
  it('matches exact project root paths', () => {
    const projectRoot = path.resolve('/tmp/demo-project');
    assert.equal(matchesProjectRulePaths(projectRoot, [projectRoot]), true);
  });

  it('matches subdirectories under a selected project root', () => {
    const projectRoot = path.resolve('/tmp/demo-project');
    const nestedDir = path.join(projectRoot, 'packages', 'app');
    assert.equal(matchesProjectRulePaths(nestedDir, [projectRoot]), true);
  });

  it('does not match unrelated sibling projects', () => {
    const currentPath = path.resolve('/tmp/project-b');
    const targetPath = path.resolve('/tmp/project-a');
    assert.equal(matchesProjectRulePaths(currentPath, [targetPath]), false);
  });
});

describe('getInstructionSearchRoots', () => {
  it('always includes the current working directory first', () => {
    const cwd = path.resolve('/tmp/demo-project/packages/app');
    const roots = getInstructionSearchRoots(cwd);
    assert.equal(roots[0], normalizeInstructionPathForMatch(cwd));
  });

  it('returns deduplicated absolute roots', () => {
    const cwd = path.resolve('/tmp/demo-project');
    const roots = getInstructionSearchRoots(cwd);
    assert.equal(roots.every((root) => path.isAbsolute(root)), true);
    assert.equal(new Set(roots).size, roots.length);
  });
});

describe('getExternalInstructionCandidates', () => {
  it('discovers user and global instruction files outside the project', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-home-'));
    tempDirs.push(homeDir);

    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.trae', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.codepilot', 'rules', 'team'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# user claude', 'utf-8');
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.local.md'), '# user local', 'utf-8');
    fs.writeFileSync(path.join(homeDir, '.trae', 'rules', 'rules.md'), '# trae rules', 'utf-8');
    fs.writeFileSync(path.join(homeDir, '.codepilot', 'rules', 'global.md'), '# global rule', 'utf-8');
    fs.writeFileSync(path.join(homeDir, '.codepilot', 'rules', 'team', 'frontend.md'), '# frontend rule', 'utf-8');

    const candidates = getExternalInstructionCandidates(homeDir);
    const labels = candidates.map((candidate) => candidate.label);

    assert.ok(labels.includes('CLAUDE.md (user)'));
    assert.ok(labels.includes('CLAUDE.local.md (user)'));
    assert.ok(labels.includes('Trae Rules (user)'));
    assert.ok(labels.includes('CodePilot Rule (global.md)'));
    assert.ok(labels.includes(`CodePilot Rule (${path.join('team', 'frontend.md')})`));
  });
});
