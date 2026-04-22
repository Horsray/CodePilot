import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runTeamPipeline, TeamRunnerOptions } from './team-runner';

export const TEAM_MCP_SYSTEM_PROMPT = `
- **OMC Team Orchestration**: You have access to the \`mcp__codepilot-team__Team\` (or \`Team\`) tool. When the user says "/team" or requests a multi-agent orchestration, you MUST use this tool to delegate the ENTIRE pipeline (search -> plan -> execute -> verify). Do NOT try to orchestrate manually.
`;

export function createTeamMcpServer(ctx: Omit<TeamRunnerOptions, 'goal'>) {
  return createSdkMcpServer({
    name: 'codepilot-team',
    version: '1.0.0',
    tools: [
      tool(
        'Team',
        'Launch an OMC-style multi-agent team orchestration pipeline. Automatically orchestrates explore -> planner -> executor -> verifier.',
        {
          goal: z.string().describe('The overall goal for the team to accomplish'),
        },
        async ({ goal }) => {
          const result = await runTeamPipeline({
            ...ctx,
            goal,
          });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      )
    ]
  });
}