import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const mapPath = path.join(repoRoot, 'fork-ownership-map.json');

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.quotepath',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).replace(/\s+$/, '');
}

export function readOwnershipMap() {
  const raw = fs.readFileSync(mapPath, 'utf8');
  return JSON.parse(raw);
}

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  const normalized = pattern.replace(/\\/g, '/');
  let regex = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      regex += '[^/]*';
      continue;
    }
    regex += escapeRegex(char);
  }
  regex += '$';
  return new RegExp(regex);
}

export function matchOwnershipRule(filePath, map = readOwnershipMap()) {
  const normalized = normalizeGitPath(filePath);
  for (const rule of map.rules) {
    if (rule.patterns.some((pattern) => globToRegex(pattern).test(normalized))) {
      return rule;
    }
  }
  return {
    id: 'unmapped',
    owner: map.defaultOwner || 'unknown',
    description: '未命中 ownership map，需要人工补规则。',
    patterns: [],
  };
}

function decodeGitQuotedPath(filePath) {
  if (!(filePath.startsWith('"') && filePath.endsWith('"'))) {
    return filePath;
  }

  const raw = filePath.slice(1, -1);
  const bytes = [];
  const escapedChars = {
    '\\': '\\',
    '"': '"',
    n: '\n',
    r: '\r',
    t: '\t',
  };

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0));
      continue;
    }

    const octal = raw.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
      continue;
    }

    const next = raw[i + 1];
    if (next && escapedChars[next]) {
      bytes.push(escapedChars[next].charCodeAt(0));
      i += 1;
      continue;
    }

    if (next) {
      bytes.push(next.charCodeAt(0));
      i += 1;
    }
  }

  return Buffer.from(bytes).toString('utf8');
}

function normalizeGitPath(filePath) {
  return decodeGitQuotedPath(String(filePath).trim()).replace(/\\/g, '/');
}

export function collectSyncDiff(upstreamRef = 'upstream/main') {
  const mergeBase = git(['merge-base', 'HEAD', upstreamRef]);
  const forkOnly = new Set(
    git(['diff', '--name-only', `${mergeBase}..HEAD`])
      .split('\n')
      .filter(Boolean)
      .map(normalizeGitPath),
  );
  const upstreamOnly = new Set(
    git(['diff', '--name-only', `${mergeBase}..${upstreamRef}`])
      .split('\n')
      .filter(Boolean)
      .map(normalizeGitPath),
  );
  const bothChanged = [...forkOnly].filter((file) => upstreamOnly.has(file)).sort();
  const forkExclusive = [...forkOnly].filter((file) => !upstreamOnly.has(file)).sort();
  const upstreamExclusive = [...upstreamOnly].filter((file) => !forkOnly.has(file)).sort();

  return {
    mergeBase,
    forkExclusive,
    upstreamExclusive,
    bothChanged,
  };
}

export function classifyFiles(files, map = readOwnershipMap()) {
  const grouped = new Map();

  for (const file of files) {
    const rule = matchOwnershipRule(file, map);
    const key = `${rule.owner}:${rule.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        owner: rule.owner,
        ruleId: rule.id,
        description: rule.description,
        files: [],
      });
    }
    grouped.get(key).files.push(file);
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.owner !== b.owner) return a.owner.localeCompare(b.owner);
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export function collectWorkingTreeFiles() {
  const output = git(['status', '--short']);
  if (!output) return [];

  // 中文注释：功能名称「工作区改动文件提取」。
  // 用法：从 git status --short 中提取最后一个路径字段，供 ownership 检查脚本判断是否越界。
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const payload = line.slice(3).trim();
      if (!payload) return null;
      const renamed = payload.includes(' -> ') ? payload.split(' -> ').at(-1) : payload;
      return renamed ? normalizeGitPath(renamed) : null;
    })
    .filter(Boolean);
}

export function formatMarkdownTable(rows, headers) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, separator, ...body].join('\n');
}

export { git, repoRoot };
