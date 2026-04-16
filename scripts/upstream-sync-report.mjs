#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  classifyFiles,
  collectSyncDiff,
  formatMarkdownTable,
  git,
  readOwnershipMap,
  repoRoot,
} from './lib/fork-sync-utils.mjs';

const args = new Set(process.argv.slice(2));
const upstreamRef = [...args].find((arg) => arg.startsWith('--upstream='))?.split('=')[1] || 'upstream/main';
const writeFlag = args.has('--write');
const outputArg = [...args].find((arg) => arg.startsWith('--output='))?.split('=')[1];
const outputPath = outputArg
  ? path.resolve(repoRoot, outputArg)
  : path.join(repoRoot, 'docs', 'research', 'upstream-sync-report-latest.md');

const map = readOwnershipMap();
const diff = collectSyncDiff(upstreamRef);

function renderSection(title, files) {
  const groups = classifyFiles(files, map);
  if (groups.length === 0) {
    return `## ${title}\n\n无\n`;
  }

  const lines = [`## ${title}`, ''];
  for (const group of groups) {
    lines.push(`### ${group.owner} · ${group.ruleId}`);
    lines.push('');
    lines.push(group.description);
    lines.push('');
    lines.push(formatMarkdownTable(
      group.files.map((file) => [file]),
      ['文件'],
    ));
    lines.push('');
  }
  return lines.join('\n');
}

const summaryTable = formatMarkdownTable([
  ['共同基线', diff.mergeBase],
  ['fork 独有文件', String(diff.forkExclusive.length)],
  ['官方独有文件', String(diff.upstreamExclusive.length)],
  ['双边都改', String(diff.bothChanged.length)],
], ['项目', '值']);

const markdown = [
  '# Upstream Sync Report',
  '',
  `- 仓库根目录：\`${repoRoot}\``,
  `- 上游引用：\`${upstreamRef}\``,
  `- 当前分支：\`${git(['branch', '--show-current'])}\``,
  '',
  '## Summary',
  '',
  summaryTable,
  '',
  '> 中文注释：功能名称「upstream 差异报告」。',
  '> 用法：同步官方前先运行 `npm run sync:report`，把官方独有、fork 独有、双边都改按 ownership map 自动归类，减少人工逐个 diff 的成本。',
  '',
  renderSection('Fork Exclusive', diff.forkExclusive),
  renderSection('Upstream Exclusive', diff.upstreamExclusive),
  renderSection('Both Changed', diff.bothChanged),
].join('\n');

if (writeFlag) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`Sync report written to ${path.relative(repoRoot, outputPath)}`);
} else {
  console.log(markdown);
}
