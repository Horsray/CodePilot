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

export const ASK_USER_QUESTION_SYSTEM_PROMPT = `## User Interaction — AskUserQuestion

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
