/**
 * builtin-tools/ask-user-question.ts — Native Runtime AskUserQuestion tool.
 *
 * Allows the model to ask the user structured multiple-choice questions.
 * Bridges the gap between the SDK Runtime (which has AskUserQuestion built in)
 * and the Native Runtime (which was missing this tool entirely).
 */

import { tool } from 'ai';
import { z } from 'zod';

export const ASK_USER_QUESTION_SYSTEM_PROMPT = `## User Interaction

When you need clarification or input from the user, use the AskUserQuestion tool.
It presents structured multiple-choice options to the user and returns their selections.
Use this when you need the user to choose between alternatives, confirm preferences,
or provide input that's better expressed as a selection than free text.`;

const QuestionSchema = z.object({
  header: z.string().optional(),
  question: z.string(),
  options: z.array(z.object({
    label: z.string(),
    description: z.string().optional(),
  })).min(1).max(6),
  multiSelect: z.boolean().optional(),
});

const AskUserQuestionSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(6),
});

export function createAskUserQuestionTools() {
  return {
    AskUserQuestion: tool({
      description:
        'Ask the user structured multiple-choice questions. ' +
        'Present 1-4 questions with 2-4 options each. ' +
        'The user can pick options and optionally type a custom answer. ' +
        'Use this when you need explicit user input on preferences, choices, or confirmations.',
      inputSchema: AskUserQuestionSchema,
      execute: async (input) => {
        const data = input as unknown as Record<string, unknown>;
        const answers = (data.answers || {}) as Record<string, string>;

        if (Object.keys(answers).length === 0) {
          return 'The user did not provide any answers.';
        }

        return Object.entries(answers)
          .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
          .join('\n\n');
      },
    }),
  };
}
