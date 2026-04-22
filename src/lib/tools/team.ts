import { tool } from 'ai';
import { z } from 'zod';
import { runTeamPipeline, TeamRunnerOptions } from '../team-runner';

export function createTeamTool(ctx: Omit<TeamRunnerOptions, 'goal'>) {
  return tool({
    description: 'Launch an OMC-style multi-agent team orchestration pipeline (search -> planner -> executor -> verifier). Use this when the user explicitly requests "/team" or complex multi-step orchestration.',
    inputSchema: z.object({
      goal: z.string().describe('The overall goal for the team to accomplish'),
    }),
    execute: async ({ goal }) => {
      const result = await runTeamPipeline({
        ...ctx,
        goal,
      });
      return result;
    },
  });
}