/**
 * tools/glob.ts — Find files by pattern.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'child_process';
import path from 'path';
import type { ToolContext } from './index';

export function createGlobTool(ctx: ToolContext) {
  return tool({
    description:
      'Find files matching a glob pattern. Returns file paths sorted by modification time. ' +
      'Use this to discover files by name pattern (e.g. "**/*.ts", "src/components/**/*.tsx").',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern to match files against'),
      path: z.string().optional().describe('Directory to search in (defaults to working directory)'),
    }),
    execute: async ({ pattern, path: searchPath }) => {
      const cwd = searchPath
        ? (path.isAbsolute(searchPath) ? searchPath : path.resolve(ctx.workingDirectory, searchPath))
        : ctx.workingDirectory;

      try {
        // Try ripgrep first since it handles gitignore and globs perfectly
        try {
          const rgResult = execSync(
            `rg --files -g '${pattern}' 2>/dev/null | head -200 | sort`,
            { cwd, encoding: 'utf-8', timeout: 10_000 },
          );
          const files = rgResult.trim().split('\n').filter(Boolean);
          if (files.length > 0) return files.join('\n');
        } catch {
          // rg failed or returned empty, fallback to find
        }

        // Use find + glob via bash for portability, with reasonable limits
        // Exclude common heavy directories
        const excludes = 'node_modules .git .next dist build coverage .cache __pycache__'
          .split(' ')
          .map(d => `-not -path "*/${d}/*"`)
          .join(' ');

        // If pattern contains '/', use -path with wildcards, else use -name
        const isPath = pattern.includes('/');
        const matchStr = isPath ? `*/${pattern.replace(/^\//, '').replace(/\*\*\//g, '')}` : pattern;
        const flag = isPath ? '-path' : '-name';

        const result = execSync(
          `find . -type f ${flag} '${matchStr}' ${excludes} 2>/dev/null | head -200 | sort`,
          { cwd, encoding: 'utf-8', timeout: 10_000 },
        );

        const files = result.trim().split('\n').filter(Boolean);
        if (files.length === 0) {
          return `No files found matching pattern "${pattern}" in ${cwd}`;
        }

        return files.join('\n');
      } catch {
        return `Error searching for files matching "${pattern}" in ${cwd}`;
      }
    },
  });
}
