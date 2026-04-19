import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import type { FileTreeNode, FilePreview } from '@/types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.output',
  'build',
]);

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  prisma: 'prisma',
  env: 'dotenv',
  lua: 'lua',
  r: 'r',
  php: 'php',
  dart: 'dart',
  zig: 'zig',
};

export function getFileLanguage(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return LANGUAGE_MAP[normalized] || 'plaintext';
}

export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

/**
 * Check if a path is a filesystem root (e.g., `/`, `C:\`, `D:\`).
 * Used to prevent using root as a baseDir for file browsing.
 */
export function isRootPath(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

export async function scanDirectory(dir: string, depth: number = 3): Promise<FileTreeNode[]> {
  const resolvedDir = path.resolve(dir);

  // turbopackIgnore hints: every fs.* / createReadStream here takes a runtime
  // user-supplied path, so Turbopack's NFT can't statically resolve what's
  // touched. Without these, Turbopack conservatively pulls the whole project
  // into the route's NFT list (and surfaces it as "next.config.ts was
  // unexpectedly traced" warnings on `npm run build`).
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedDir);
  } catch {
    return [];
  }

  return scanDirectoryRecursive(resolvedDir, depth);
}

async function scanDirectoryRecursive(dir: string, depth: number): Promise<FileTreeNode[]> {
  if (depth <= 0) return [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  // Sort: directories first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden files/dirs (except common config files)
    if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const children = await scanDirectoryRecursive(fullPath, depth - 1);
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, '');
      let size: number | undefined;
      try {
        const stat = await fs.stat(/*turbopackIgnore: true*/ fullPath);
        size = stat.size;
      } catch {
        // Skip files we can't stat
      }

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size,
        extension: ext || undefined,
      });
    }
  }

  return nodes;
}

export async function readFilePreview(filePath: string, maxLines: number = 200): Promise<FilePreview> {
  const resolvedPath = path.resolve(filePath);

  // Same turbopackIgnore rationale as scanDirectory — runtime-dynamic path.
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedPath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.stat(/*turbopackIgnore: true*/ resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  // Estimate total line count from file size (avoids reading entire file).
  // Heuristic: average ~60 bytes per line for source code.
  const estimatedTotalLines = Math.max(1, Math.ceil(stat.size / 60));

  // Stream-read only the first maxLines to avoid loading entire large files
  const collectedLines: string[] = [];
  let scannedLineCount = 0;
  let hitLimit = false;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(/*turbopackIgnore: true*/ resolvedPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      scannedLineCount++;
      if (collectedLines.length < maxLines) {
        collectedLines.push(line);
      } else {
        hitLimit = true;
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => resolve());
    rl.on('error', reject);
    stream.on('error', reject);
  });

  const ext = path.extname(resolvedPath).replace(/^\./, '');
  const language = getFileLanguage(ext);

  // If we read the entire file, scannedLineCount is exact.
  // If we hit the limit early, use the larger of scanned count vs size-based estimate.
  const lineCount = hitLimit
    ? Math.max(scannedLineCount, estimatedTotalLines)
    : scannedLineCount;

  return {
    path: resolvedPath,
    content: collectedLines.join('\n'),
    language,
    line_count: lineCount,
    line_count_exact: !hitLimit,
  };
}
