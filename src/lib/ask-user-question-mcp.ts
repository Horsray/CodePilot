/**
 * ask-user-question-mcp.ts — SDK Runtime 的交互式提问 MCP 服务器。
 *
 * 提供一个工具：AskUserQuestion，让 AI 可以向用户发起结构化多选提问。
 *
 * 与 canUseTool 权限流程不同的是，这里的 execute handler 自己发射 SSE 事件
 * 并等待用户响应。原因是 permissionMode: 'bypassPermissions' 下 SDK 不会调用
 * canUseTool，必须从工具执行内部驱动交互流程。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const ASK_USER_QUESTION_MCP_SYSTEM_PROMPT = `## User Interaction — AskUserQuestion

You have a powerful interactive questioning tool: AskUserQuestion.

**CRITICAL — You MUST use AskUserQuestion when:**
- Multiple valid approaches exist and the choice affects architecture, UX, or user-facing behavior
- The user's preference determines the entire direction of the implementation
- You're choosing between frameworks, libraries, or design patterns with different trade-offs
- The task description is ambiguous about a decision that matters (e.g. "build a dashboard" — which data? which layout?)
- You need the user to pick between concrete trade-offs (e.g. "fast & simple vs. flexible & complex")

**Examples of good AskUserQuestion usage:**
- "Should I use React or Vue for this new component?"
- "Do you want a CLI tool or a web interface?"
- "Which deployment target: Vercel, Docker, or bare metal?"
- "Should this be a single page or multi-page app?"

**You may skip AskUserQuestion only when:**
- There is clearly one correct approach
- The choice is a trivial implementation detail the user would not care about

When in doubt, ASK. Guessing wrong wastes far more time than asking once.`;

const QuestionSchema = z.object({
  header: z.string().optional().describe('Short label shown above the question (max 12 chars, e.g. "Auth method")'),
  question: z.string().describe('The complete question to ask the user'),
  options: z.array(z.object({
    label: z.string().describe('Short display text (1-5 words)'),
    description: z.string().optional().describe('Explanation of what this option means'),
  })).min(2).max(4).describe('2-4 mutually exclusive choices'),
  multiSelect: z.boolean().optional().default(false).describe('Allow selecting multiple options'),
});

/** Callback signature for driving the interactive permission UI from the tool handler. */
export type AskUserQuestionHandler = (
  toolName: string,
  input: Record<string, unknown>,
  toolUseId?: string,
) => Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny' }>;

export function createAskUserQuestionMcpServer(handler?: AskUserQuestionHandler) {
  return createSdkMcpServer({
    name: 'codepilot-ask-user',
    version: '1.0.0',
    tools: [
      tool(
        'AskUserQuestion',
        'Ask the user structured multiple-choice questions to gather preferences, clarify instructions, or make implementation choices. ' +
        'Present 1-4 questions with 2-4 options each. The user can pick options and optionally type a custom answer. ' +
        'Use this when you need explicit user input on preferences, choices, or confirmations — DO NOT guess when the choice matters.',
        {
          questions: z.array(QuestionSchema).min(1).max(4)
            .describe('The set of questions to ask the user (1-4 questions)'),
        },
        async ({ questions }, extra) => {
          if (!handler) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Interactive question presented to user. Waiting for response through the permission UI.',
              }],
            };
          }

          const toolUseId = (extra as Record<string, unknown> | undefined)?.toolUseID as string | undefined;
          const result = await handler('AskUserQuestion', { questions } as Record<string, unknown>, toolUseId);

          if (result.behavior === 'deny') {
            return {
              content: [{ type: 'text' as const, text: 'User denied the question.' }],
              isError: true,
            };
          }

          // Format answers for the model
          const updatedInput = result.updatedInput || {};
          const answers = (updatedInput.answers || {}) as Record<string, string>;
          if (Object.keys(answers).length === 0) {
            return {
              content: [{ type: 'text' as const, text: 'The user did not provide any answers.' }],
            };
          }

          const formatted = Object.entries(answers)
            .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
            .join('\n\n');

          return { content: [{ type: 'text' as const, text: formatted }] };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}
