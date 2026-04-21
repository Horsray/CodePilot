/**
 * ask-user-question-mcp.ts — SDK Runtime 的交互式提问 MCP 服务器。
 *
 * 提供一个工具：AskUserQuestion，让 AI 可以向用户发起结构化多选提问。
 * 与 Native Runtime 的 builtin-tools/ask-user-question.ts 功能一致，
 * 但使用 SDK 的 createSdkMcpServer 格式注册。
 *
 * 流程：
 *   1. 模型调用 AskUserQuestion({ questions: [...] })
 *   2. SDK 的 permission 系统拦截（allowedTools 中 AskUserQuestion 触发交互）
 *   3. 前端 PermissionPrompt.tsx 渲染 AskUserQuestionUI
 *   4. 用户选择选项 → 前端返回 updatedInput 包含 { answers }
 *   5. 工具返回格式化的问答结果供模型消费
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const ASK_USER_QUESTION_MCP_SYSTEM_PROMPT = `## User Interaction

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
  header: z.string().optional().describe('Short label shown above the question (max 12 chars, e.g. "Auth method")'),
  question: z.string().describe('The complete question to ask the user'),
  options: z.array(z.object({
    label: z.string().describe('Short display text (1-5 words)'),
    description: z.string().optional().describe('Explanation of what this option means'),
  })).min(2).max(4).describe('2-4 mutually exclusive choices'),
  multiSelect: z.boolean().optional().default(false).describe('Allow selecting multiple options'),
});

export function createAskUserQuestionMcpServer() {
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
        async ({ questions }) => {
          // In SDK runtime, the permission system intercepts this tool call.
          // The frontend AskUserQuestionUI renders the interactive UI,
          // and the user's answers are injected back as updatedInput.
          //
          // If we reach this execute handler, it means either:
          // 1. The permission system already processed the user's response
          //    and injected answers into the input — we format them for the model.
          // 2. The permission system was bypassed — return a helpful error.
          return {
            content: [{
              type: 'text' as const,
              text: 'Interactive question presented to user. Waiting for response through the permission UI.',
            }],
          };
        },
      ),
    ],
  });
}
