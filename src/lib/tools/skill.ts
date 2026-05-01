/**
 * tools/skill.ts — SkillTool: lets the model discover and invoke skills.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { discoverSkills, getSkill } from '../skill-discovery';
import { prepareSkillExecution } from '../skill-executor';

/**
 * Create the Skill tool. The model can use this to:
 * 1. List available skills (no arguments)
 * 2. Execute a specific skill by name
 */
export function createSkillTool(workingDirectory: string) {
  return tool({
    description:
      'Execute reusable workflow templates (skills) from the project and global skill directories. ' +
      'Skills encode proven multi-step workflows for common tasks: building, testing, debugging, ' +
      'code exploration, deployment, reverse-engineering, troubleshooting, code review, and more. ' +
      'Call WITHOUT arguments to list all available skills with their descriptions and "use when" criteria. ' +
      'Scan the listing for skills whose description or "use when" criteria matches the current task. ' +
      'Call WITH `name` (the exact name from the listing) to execute a matching skill. ' +
      'Before starting any complex multi-step task, check available skills first — ' +
      'a skill may already encode the exact workflow you need, saving time and avoiding mistakes.',
    inputSchema: z.object({
      name: z.string().optional().describe('Name of the skill to execute. Omit to list all skills.'),
      skill_name: z.string().optional().describe('Name of the skill to execute (legacy). Omit to list all skills.'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments to pass to the skill (key-value pairs)'),
    }),
    execute: async ({ name, skill_name, arguments: args }) => {
      const targetName = name || skill_name;
      // List mode
      if (!targetName) {
        const skills = discoverSkills(workingDirectory);
        if (skills.length === 0) {
          return 'No skills available. Skills can be added as SKILL.md files in .claude/skills/ or ~/.claude/skills/.';
        }

        // 中文注释：功能名称「技能分类输出」，用法是按类别组织技能列表，
        // 让模型能快速定位相关技能而不是在 100+ 平铺列表中逐个扫描。
        const categories: { name: string; skills: typeof skills }[] = [
          { name: 'Build & Deploy', skills: [] },
          { name: 'Code Exploration & Search', skills: [] },
          { name: 'Debugging & Troubleshooting', skills: [] },
          { name: 'Testing & Verification', skills: [] },
          { name: 'Integrations (Feishu/Telegram/etc.)', skills: [] },
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

        const lines: string[] = [];
        for (const cat of categories) {
          if (cat.skills.length === 0) continue;
          lines.push(`## ${cat.name} (${cat.skills.length})`);
          for (const s of cat.skills) {
            const parts = [`- **${s.name}**`];
            if (s.description) parts.push(`: ${s.description.slice(0, 100)}`);
            if (s.whenToUse) parts.push(` [Triggers: ${s.whenToUse.slice(0, 120)}]`);
            if (s.context === 'fork') parts.push(' [fork]');
            lines.push(parts.join(''));
          }
          lines.push('');
        }
        return lines.join('\n');
      }

      // Execute mode
      const skill = getSkill(targetName, workingDirectory);
      if (!skill) {
        const available = discoverSkills(workingDirectory).map(s => s.name).join(', ');
        return `Skill "${targetName}" not found. Available skills: ${available || 'none'}`;
      }

      const result = prepareSkillExecution(skill, args);

      if (result.fork) {
        // Fork mode — return the prompt for the agent loop to spawn a sub-agent
        // The agent-loop should detect this and route to the AgentTool
        return `[SKILL_FORK]\nPrompt: ${result.prompt}\nAllowed tools: ${result.allowedTools?.join(', ') || 'all'}`;
      }

      // Inline mode — return the prompt for injection into the conversation
      return result.prompt;
    },
  });
}
