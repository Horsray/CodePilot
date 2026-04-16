#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, repoRoot } from './lib/fork-sync-utils.mjs';

const args = new Set(process.argv.slice(2));
const upstreamRemote = [...args].find((arg) => arg.startsWith('--remote='))?.split('=')[1] || 'upstream';
const createBranch = args.has('--create-branch');
const upstreamRef = `${upstreamRemote}/main`;

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function todayStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function sanitizeTagName(tag) {
  return tag.replace(/^v/, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

console.log(`[sync] Fetching ${upstreamRemote}...`);
run('git', ['fetch', upstreamRemote, '--tags', '--prune']);

let latestTag = '';
try {
  latestTag = git(['describe', '--tags', '--abbrev=0', upstreamRef]);
} catch {
  latestTag = '';
}

let branchName = '';
if (createBranch) {
  const suffix = latestTag ? sanitizeTagName(latestTag) : 'latest';
  branchName = `sync/upstream-${todayStamp()}-${suffix}`;
  console.log(`[sync] Creating branch ${branchName} from current HEAD...`);
  run('git', ['checkout', '-b', branchName]);
}

console.log('[sync] Generating ownership report...');
run('node', ['scripts/upstream-sync-report.mjs', '--write', `--upstream=${upstreamRef}`]);

console.log('[sync] Running ownership check...');
const ownershipOutput = run('node', ['scripts/check-fork-ownership.mjs']);

const summary = [
  '# Upstream Sync Bootstrap',
  '',
  `- upstream remote: \`${upstreamRemote}\``,
  `- upstream ref: \`${upstreamRef}\``,
  `- current branch: \`${git(['branch', '--show-current'])}\``,
  latestTag ? `- latest upstream tag: \`${latestTag}\`` : '- latest upstream tag: `N/A`',
  branchName ? `- sync branch: \`${branchName}\`` : '- sync branch: `未自动创建`',
  '- report: `docs/research/upstream-sync-report-latest.md`',
  '',
  '## Ownership Check',
  '',
  '```text',
  ownershipOutput,
  '```',
  '',
  '> 中文注释：功能名称「upstream 同步 bootstrap」。',
  '> 用法：运行 `npm run sync:bootstrap` 或 `npm run sync:bootstrap:branch`，自动完成 fetch upstream、生成差异报告、执行 ownership 边界检查。',
].join('\n');

const summaryPath = path.join(repoRoot, 'docs', 'research', 'upstream-sync-bootstrap-latest.md');
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, summary, 'utf8');

console.log(`[sync] Bootstrap summary written to ${path.relative(repoRoot, summaryPath)}`);
