import { tool } from 'ai';
import { z } from 'zod';
import { getBackgroundJob } from '../db';
import type { ToolContext } from './index';

/**
 * Tool to check the status and output of a background job.
 */
export function createCheckBackgroundJobTool(ctx: ToolContext) {
  return tool({
    description: 'Check the status and output of a background task/job using its Job ID. ' +
                 'Use this when a previous tool was moved to the background.',
    inputSchema: z.object({
      jobId: z.string().describe('The Job ID of the background task to check'),
    }),
    execute: async ({ jobId }) => {
      const job = getBackgroundJob(jobId);
      if (!job) {
        return `Background job with ID "${jobId}" not found.`;
      }

      let result = `Background Job Status: ${job.status}\n`;
      result += `Tool: ${job.tool_name}\n`;
      result += `Started: ${job.created_at}\n`;
      
      if (job.status === 'running') {
        result += `The task is still running in the background. Please check again later.`;
      } else if (job.status === 'completed') {
        result += `Finished: ${job.completed_at}\n\n`;
        result += `Output:\n${job.output || '(no output)'}`;
      } else if (job.status === 'failed') {
        result += `Finished: ${job.completed_at}\n\n`;
        result += `Error: ${job.error || 'Unknown error'}`;
      } else if (job.status === 'timeout') {
        result += `Finished: ${job.completed_at}\n\n`;
        result += `The task timed out in the background.`;
      }

      return result;
    },
  });
}

// 中文注释：功能名称「查询后台任务状态」，用法是 AI 通过 Job ID 轮询之前转入后台的任务执行进度。
