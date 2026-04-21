/**
 * builtin-tools/ask-user-question.ts — Native Runtime AskUserQuestion tool.
 *
 * Allows the model to ask the user structured multiple-choice questions.
 * Bridges the gap between the SDK Runtime (which has AskUserQuestion built in)
 * and the Native Runtime (which was missing this tool entirely).
 *
 * Flow:
 *   1. Model calls AskUserQuestion with { questions: [...] }
 *   2. Permission wrapper in agent-tools.ts intercepts (AskUserQuestion is in
 *      ALWAYS_ASK_TOOLS, so even trust mode shows the UI)
 *   3. Frontend PermissionPrompt.tsx renders AskUserQuestionUI when
 *      pendingPermission.toolName === 'AskUserQuestion'
 *   4. User picks options → frontend responds with updatedInput containing
 *      { questions, answers: Record<string, string> }
 *   5. Permission wrapper replaces `input` with `updatedInput`
 *   6. This tool's execute receives the enriched input and formats the
 *      answers for the model to consume
 *
 * The Zod schema only covers the MODEL's input (questions). The `answers`
 * field is injected by the permission flow and accessed via a runtime cast
 * in execute — this matches the SDK's behavior.
 *
 * Known limitation — IM/bridge sessions:
 * The bridge permission broker (permission-broker.ts) only supports
 * Allow/Deny responses, not structured updatedInput with answers.
 * Bridge users see a generic permission card and can approve/deny but
 * cannot pick options. Full bridge support requires interactive IM card
 * UIs per platform (Telegram inline keyboard, Feishu interactive card,
 * etc.) — tracked as a separate follow-up.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const ASK_USER_QUESTION_SYSTEM_PROMPT = `## User Interaction

When you need clarification or input from the user, use the AskUserQuestion tool.
It presents structured multiple-choice options to the user and returns their selections.

**When to use AskUserQuestion (IMPORTANT — do NOT skip these):**
- When there are multiple valid approaches and the user should choose (e.g., "Which UI framework?" or "React or Vue?")
- When you need to confirm the user's preference before proceeding (e.g., "Which color scheme?" or "API-first or UI-first?")
- When the task is ambiguous and you need the user to disambiguate (e.g., "Do you want a CLI tool or a web app?")
- When you need the user to pick between trade-offs (e.g., "Simple but limited vs. flexible but complex?")

**When NOT to use AskUserQuestion:**
- For simple yes/no questions — just proceed and the user will correct you if needed
- When the answer is obvious from context — just do the right thing
- For questions about implementation details the user doesn't care about — make a reasonable default choice

Always prefer asking over guessing when the choice significantly affects the outcome.`;

const QuestionSchema = z.object({
  /** Short header label shown above the question (e.g. "Project Setup") */
  header: z.string().optional(),
  /** The question text */
  question: z.string(),
  /** Available options for the user to pick from (2-4 recommended) */
  options: z.array(z.object({
    label: z.string(),
    description: z.string().optional(),
  })).min(1).max(6),
  /** Allow selecting multiple options. Default: false (single-select) */
  multiSelect: z.boolean().optional(),
});

const AskUserQuestionSchema = z.object({
  /** Array of questions to present (1-4 recommended) */
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
        // By the time execute runs, the permission wrapper has already:
        // 1. Emitted a permission_request SSE event
        // 2. Waited for the user's response (blocking the agent loop)
        // 3. Replaced `input` with updatedInput that includes { answers }
        //
        // The answers are injected by the frontend AskUserQuestionUI component
        // (PermissionPrompt.tsx:87-98) as Record<string, string> keyed by
        // question text, with selected option labels joined by ', '.
        const data = input as unknown as Record<string, unknown>;
        const answers = (data.answers || {}) as Record<string, string>;

        console.log('[AskUserQuestion.execute] received input:', {
          hasQuestions: !!(data.questions),
          questionCount: Array.isArray(data.questions) ? data.questions.length : 0,
          hasAnswers: !!data.answers,
          answerKeys: Object.keys(answers),
          answers,
          rawInputKeys: Object.keys(data),
        });

        if (Object.keys(answers).length === 0) {
          console.warn('[AskUserQuestion.execute] No answers found — user did not provide any input');
          return 'The user did not provide any answers.';
        }

        const formatted = Object.entries(answers)
          .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
          .join('\n\n');

        console.log('[AskUserQuestion.execute] returning:', formatted.slice(0, 500));
        return formatted;
      },
    }),
  };
}
