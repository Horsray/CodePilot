/**
 * tools/write.ts — Write/create files.
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { recordFileModification } from '../file-checkpoint';
import type { ToolContext } from './index';

export function createWriteTool(ctx: ToolContext) {
  return tool({
    description:
      'Write content to a file. Creates the file and any parent directories if they don\'t exist. ' +
      'Overwrites the file if it already exists. Use Edit for modifying existing files.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file to write'),
      content: z.string().describe('The full content to write to the file'),
    }),
    execute: async ({ file_path, content }) => {
      const resolved = path.isAbsolute(file_path) ? file_path : path.resolve(ctx.workingDirectory, file_path);

      // Create parent directories
      const dir = path.dirname(resolved);
      // 中文注释：功能名称「异步创建目录」，用法是使用异步 IO 避免阻塞 SSE flush，
      // 让 tool_use 卡片能在写入过程中及时显示
      await fs.promises.mkdir(dir, { recursive: true });

      // Record modification BEFORE writing so we capture the "before" state
      recordFileModification(ctx.sessionId || '', path.relative(ctx.workingDirectory, resolved), ctx.workingDirectory);

      // 中文注释：功能名称「异步写文件」，用法是避免同步写入阻塞事件循环，导致 tool_use/tool_result 一起到达前端
      await fs.promises.writeFile(resolved, content, 'utf-8');
      
      const lines = content.split('\n').length;
      return `Successfully wrote ${lines} lines to ${resolved}`;
    },
  });
}
