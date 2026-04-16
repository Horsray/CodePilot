/**
 * tools/ask-user-question.ts — AskUserQuestion: trigger an interactive UI for clarification.
 *
 * This tool allows the AI to ask questions that require user selection or text input
 * through a specialized UI, rather than just plain text in the chat.
 *
 * 中文注释：AskUserQuestion 工具允许 AI 发起交互式提问，
 * 通过 UI 按钮或输入框获取用户反馈，提升交互体验。
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './index';

export function createAskUserQuestionTool(ctx: ToolContext) {
  return tool({
    description:
      'Ask the user a question to gather preferences, clarify instructions, or make implementation choices. ' +
      'Use this when you need a structured answer (e.g., selecting from options) or when you want to ' +
      'ensure the user sees your question prominently through an interactive UI.',
    inputSchema: z.object({
      questions: z.array(z.object({
        question: z.string().describe('The complete question to ask the user.'),
        header: z.string().optional().describe('A short label/tag for the question (max 12 chars).'),
        multiSelect: z.boolean().default(false).describe('Whether the user can select multiple options.'),
        options: z.array(z.object({
          label: z.string().describe('Short display text for the option.'),
          description: z.string().optional().describe('Helpful description of what this option means.'),
        })).min(2).max(4).describe('List of 2-4 mutually exclusive or multi-select choices.'),
      })).min(1).max(4).describe('The set of questions to ask the user.'),
    }),
    execute: async (input) => {
      const data = input as {
        questions?: Array<{ question: string }>;
        answers?: Record<string, string>;
      };

      const answers = data.answers || {};
      if (Object.keys(answers).length > 0) {
        return Object.entries(answers)
          .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
          .join('\n\n');
      }

      // In CodePilot design, this tool is intended to be INTERCEPTED by the permission system.
      // We don't actually "execute" anything here; the execution is suspended by the
      // wrapWithPermissions layer in agent-tools.ts, which emits a permission_request.
      //
      // If we ever reach here, it means the permission check was bypassed or failed.
      return JSON.stringify({ 
        status: 'error', 
        message: 'Interactive question was not intercepted by the permission system.' 
      });
    },
  });
}
