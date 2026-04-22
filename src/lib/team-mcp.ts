import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runTeamPipeline } from './team-runner';

export const TEAM_MCP_SYSTEM_PROMPT = `
- **Team Orchestration**: You have access to the \`mcp__codepilot-team__Team\` (or \`Team\`) tool. Use it when the user asks for multi-agent collaboration, or when the user uses the \`/team\` command. The tool runs a full pipeline: explore + search + plan + execute + verify, and returns an evidence-based report.
`;

export function createTeamMcpServer(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  abortSignal?: AbortSignal;
}) {
  return createSdkMcpServer({
    name: 'codepilot-team',
    version: '1.0.0',
    tools: [
      tool(
        'Team',
        'Run a multi-agent team pipeline (explore + search + plan + execute + verify) for complex tasks.',
        {
          goal: z.string().describe('The user goal / task to accomplish'),
        },
        async ({ goal }) => {
          const result = await runTeamPipeline({
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
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}

