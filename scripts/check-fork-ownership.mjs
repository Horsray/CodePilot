#!/usr/bin/env node

import { classifyFiles, collectWorkingTreeFiles, formatMarkdownTable, readOwnershipMap } from './lib/fork-sync-utils.mjs';

const strict = process.argv.includes('--strict');
const map = readOwnershipMap();
const files = collectWorkingTreeFiles();

if (files.length === 0) {
  console.log('Working tree is clean.');
  process.exit(0);
}

const groups = classifyFiles(files, map);
const rows = groups.map((group) => [
  group.owner,
  group.ruleId,
  String(group.files.length),
  group.files.slice(0, 3).join('<br/>'),
]);

console.log('# Fork Ownership Check\n');
console.log('> 中文注释：功能名称「fork 差异边界检查」。');
console.log('> 用法：开发前或提交前运行 `npm run sync:ownership`，确认当前工作区改动是否落在预期的 fork/shared/core 边界内。\n');
console.log(formatMarkdownTable(rows, ['归属', '规则', '文件数', '示例文件']));

const unknownGroups = groups.filter((group) => group.owner === 'unknown');
if (unknownGroups.length > 0) {
  console.log('\n发现未映射文件，请补充 fork-ownership-map.json。');
}

if (strict) {
  const blockingGroups = groups.filter((group) => group.owner === 'unknown');
  if (blockingGroups.length > 0) {
    process.exit(1);
  }
}
