import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

export const createSkillCreateTool = (workspacePath: string) => tool({
  description: 'Auto-crystallize a successful workflow into a reusable SKILL.md file. Use this ONLY after you have successfully completed a complex task (like setting up an environment or fixing a bug) to save the exact steps for future use.',
  inputSchema: z.object({
    name: z.string().describe('The name of the skill, lowercase with dashes (e.g., "setup-nginx", "fix-cors")'),
    description: z.string().describe('A short, one-sentence description of what this skill does.'),
    whenToUse: z.string().describe('When should the AI use this skill? (e.g., "When the user asks to configure Nginx")'),
    content: z.string().describe('The actual Markdown content of the skill. This should include the exact Bash commands, file paths, or code snippets that were proven to work in this session.'),
  }),
  execute: async ({ name, description, whenToUse, content }: { name: string; description: string; whenToUse: string; content: string }) => {
    try {
      const skillsDir = path.join(workspacePath, '.claude', 'skills', name);
      fs.mkdirSync(skillsDir, { recursive: true });

      const skillContent = `---
name: ${name}
description: "${description.replace(/"/g, '\\"')}"
whenToUse: "${whenToUse.replace(/"/g, '\\"')}"
---

${content}
`;

      const filePath = path.join(skillsDir, 'SKILL.md');
      fs.writeFileSync(filePath, skillContent, 'utf-8');

      try {
        const { sendNotification } = await import('@/lib/notification-manager');
        await sendNotification({
          title: '技能习得',
          body: `已成功保存新技能：${name}`,
          priority: 'low'
        });
      } catch (e) {
        console.error('[skill-create] Failed to notify:', e);
      }

      return `Successfully crystallized skill! Saved to ${filePath}. In future conversations, you can call this skill by its name "${name}".`;
    } catch (e) {
      return `Failed to create skill: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
