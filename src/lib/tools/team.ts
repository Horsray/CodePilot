import { tool } from 'ai';
import { z } from 'zod';
import { runTeamPipeline, TeamRunnerOptions } from '../team-runner';

export function createTeamTool(ctx: Omit<TeamRunnerOptions, 'goal'>) {
  return tool({
    description: 'Launch an OMC-style multi-agent team orchestration pipeline. The Orchestrator will dynamically plan a DAG, allocate 20+ specialized agents (like designer, architect, test-engineer, etc.) with parallel execution and auto-retry loops. \nCRITICAL: You MUST use this tool automatically for ANY complex tasks (e.g., "build a new page", "refactor this module", "add a new feature across frontend and backend", "create tests for X") EVEN IF the user does NOT explicitly type "/team". Do not do complex work yourself; delegate it using this tool.',
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