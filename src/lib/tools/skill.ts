/**
 * tools/skill.ts — SkillTool: lets the model discover and invoke skills.
 *
 * Design: the LLM itself is the best matcher. The system prompt provides
 * a compact skills index; the model scans it and calls Skill(name) when
 * a skill matches. No programmatic keyword matching needed.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { discoverSkills, getSkill } from '../skill-discovery';
import { prepareSkillExecution } from '../skill-executor';

/**
 * Create the Skill tool. The model can use this to:
 * 1. List all available skills (no arguments)
 * 2. Execute a specific skill by name
 */
export function createSkillTool(workingDirectory: string) {
  return tool({
    description:
      'Discover and execute reusable workflow skills.\n' +
      'Modes:\n' +
      '- No arguments: list all available skills by category\n' +
      '- With `name`: execute the named skill\n\n' +
      'Before calling, check the skills index in the system prompt first. ' +
      'If a skill matches your task, call with its name directly.',
    inputSchema: z.object({
      name: z.string().optional().describe('Name of the skill to execute. Omit to list all skills.'),
      skill_name: z.string().optional().describe('Name of the skill to execute (legacy). Omit to list all skills.'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments to pass to the skill (key-value pairs)'),
    }),
    execute: async ({ name, skill_name, arguments: args }) => {
      const targetName = name || skill_name;

      // ── List mode ─────────────────────────────────────────────
      if (!targetName) {
        const skills = discoverSkills(workingDirectory);
        if (skills.length === 0) {
          return 'No skills available yet. Skills are automatically crystallized from recurring workflows as you work.';
        }

        const categories: { name: string; skills: typeof skills }[] = [
          { name: 'Build & Deploy', skills: [] },
          { name: 'Code Exploration & Search', skills: [] },
          { name: 'Debugging & Troubleshooting', skills: [] },
          { name: 'Testing & Verification', skills: [] },
          { name: 'Integrations', skills: [] },
          { name: 'Knowledge & Research', skills: [] },
          { name: 'Other Workflows', skills: [] },
        ];

        const classify = (s: typeof skills[0]): number => {
          const n = s.name.toLowerCase();
          const d = (s.description + ' ' + (s.whenToUse || '')).toLowerCase();
          if (n.includes('build') || n.includes('electron') || n.includes('package') || n.includes('deploy') || d.includes('构建') || d.includes('打包')) return 0;
          if (n.includes('explore') || n.includes('search') || n.includes('find') || n.includes('locate') || n.includes('discover') || n.includes('codebase') || d.includes('探索') || d.includes('搜索') || d.includes('查找代码')) return 1;
          if (n.includes('debug') || n.includes('troubleshoot') || n.includes('diagnose') || n.includes('fix') || n.includes('recover') || n.includes('handle') || d.includes('调试') || d.includes('排查') || d.includes('修复')) return 2;
          if (n.includes('test') || n.includes('verif') || n.includes('check') || n.includes('valid') || d.includes('测试') || d.includes('验证')) return 3;
          if (n.includes('feishu') || n.includes('lark') || n.includes('wechat') || n.includes('telegram') || n.includes('bot') || n.includes('bridge') || n.includes('channel') || d.includes('飞书')) return 4;
          if (n.includes('knowledge') || n.includes('learn') || n.includes('research') || n.includes('memory') || n.includes('graphify') || d.includes('知识') || d.includes('学习') || d.includes('研究')) return 5;
          return 6;
        };

        for (const s of skills) categories[classify(s)].skills.push(s);

        const lines: string[] = [`Found ${skills.length} skills:\n`];
        for (const cat of categories) {
          if (cat.skills.length === 0) continue;
          lines.push(`## ${cat.name} (${cat.skills.length})`);
          for (const s of cat.skills) {
            const parts = [`- **${s.name}**`];
            if (s.description) parts.push(`: ${s.description.slice(0, 80)}`);
            if (s.whenToUse) parts.push(` [When: ${s.whenToUse.slice(0, 100)}]`);
            if (s.context === 'fork') parts.push(' [fork]');
            lines.push(parts.join(''));
          }
          lines.push('');
        }
        return lines.join('\n');
      }

      // ── Execute mode ──────────────────────────────────────────
      const skill = getSkill(targetName, workingDirectory);
      if (!skill) {
        const available = discoverSkills(workingDirectory).map(s => s.name).join(', ');
        return `Skill "${targetName}" not found. Available: ${available || 'none'}\nTip: call with no arguments to browse all skills.`;
      }

      const result = prepareSkillExecution(skill, args);

      if (result.fork) {
        return `[SKILL_FORK]\nPrompt: ${result.prompt}\nAllowed tools: ${result.allowedTools?.join(', ') || 'all'}`;
      }

      return result.prompt;
    },
  });
}
