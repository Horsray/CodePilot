import { tool } from 'ai';
import { z } from 'zod';
import { runTeamPipeline } from '../team-runner';

export function createTeamTool(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
}) {
  return tool({
    description:
      'Run a multi-agent team pipeline (explore + search + plan + execute + verify) for complex tasks. ' +
      'Prefer this when the user explicitly asks for multi-agent collaboration or uses /team.',
    inputSchema: z.object({
      goal: z.string().describe('The user goal / task to accomplish'),
    }),
    execute: async ({ goal }) => {
      return runTeamPipeline({
        goal,
        ctx: {
          workingDirectory: ctx.workingDirectory,
          providerId: ctx.providerId,
          sessionProviderId: ctx.sessionProviderId,
          parentModel: ctx.parentModel,
          permissionMode: ctx.permissionMode,
          parentSessionId: ctx.parentSessionId,
          emitSSE: ctx.emitSSE,
          abortSignal: ctx.abortSignal,
        },
      });
    },
  });
}

