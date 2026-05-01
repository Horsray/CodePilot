/**
 * tools/skill.ts — SkillTool: lets the model discover and invoke skills.
 *
 * Design: the tool description is written as a natural-language guide,
 * not a rigid rulebook. The model discovers skills organically through
 * the "suggest" mode, which matches task descriptions to skill triggers.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { discoverSkills, getSkill } from '../skill-discovery';
import { prepareSkillExecution } from '../skill-executor';

/**
 * Create the Skill tool. The model can use this to:
 * 1. List all available skills (no arguments)
 * 2. Get skill suggestions for a task (suggest mode)
 * 3. Execute a specific skill by name
 */
export function createSkillTool(workingDirectory: string) {
  return tool({
    description:
      'Access reusable workflow templates (skills) that encode proven solutions for recurring tasks. ' +
      'Skills are distilled from past successful workflows — building, debugging, deployment, ' +
      'code exploration, platform integration, and more. ' +
      'Use this tool when you sense the current task might have been solved before, ' +
      'or when a multi-step workflow feels like it should be reusable. ' +
      'Call with no arguments to browse all skills. ' +
      'Call with `suggest` and a task description to find the best matching skill. ' +
      'Call with `name` to execute a specific skill.',
    inputSchema: z.object({
      name: z.string().optional().describe('Name of the skill to execute. Omit to list or suggest.'),
      suggest: z.string().optional().describe('Describe what you are trying to do. The tool will return skills whose trigger conditions match your task.'),
      skill_name: z.string().optional().describe('Name of the skill to execute (legacy). Omit to list all skills.'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments to pass to the skill (key-value pairs)'),
    }),
    execute: async ({ name, skill_name, suggest, arguments: args }) => {
      const targetName = name || skill_name;

      // ── Suggest mode ──────────────────────────────────────────
      if (suggest && !targetName) {
        const skills = discoverSkills(workingDirectory);
        if (skills.length === 0) {
          return 'No skills available yet. Skills are automatically crystallized from recurring workflows.';
        }

        const query = suggest.toLowerCase();
        const scored = skills
          .map(s => {
            let score = 0;
            const nameLC = s.name.toLowerCase();
            const descLC = (s.description || '').toLowerCase();
            const triggerLC = (s.whenToUse || '').toLowerCase();
            const bodyLC = (s.body || '').toLowerCase().slice(0, 500);

            // Exact keyword matches
            const queryWords = query.split(/\s+/).filter(w => w.length > 2);
            for (const word of queryWords) {
              if (nameLC.includes(word)) score += 3;
              if (triggerLC.includes(word)) score += 4;
              if (descLC.includes(word)) score += 2;
              if (bodyLC.includes(word)) score += 1;
            }

            // Category bonus: if the task domain matches the skill domain
            const domains: [RegExp, string][] = [
              [/\b(build|compile|package|deploy|electron|打包|构建|部署)\b/i, 'build'],
              [/\b(debug|fix|error|bug|troubleshoot|修复|调试|排查)\b/i, 'debug'],
              [/\b(test|verify|check|validate|测试|验证)\b/i, 'test'],
              [/\b(search|find|explore|locate|查找|搜索|探索)\b/i, 'explore'],
              [/\b(git|merge|rebase|branch|commit|分支|合并)\b/i, 'git'],
              [/\b(ui|style|css|layout|component|样式|界面|组件)\b/i, 'ui'],
              [/\b(database|sql|query|migration|数据库)\b/i, 'db'],
            ];
            for (const [pattern, domain] of domains) {
              if (pattern.test(query) && (nameLC.includes(domain) || triggerLC.includes(domain) || descLC.includes(domain))) {
                score += 5;
              }
            }

            return { skill: s, score };
          })
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        if (scored.length === 0) {
          return `No skills match "${suggest}". Try listing all skills (no arguments) to browse available ones.`;
        }

        const lines = [`Skills matching "${suggest}":\n`];
        for (const { skill: s, score } of scored) {
          const parts = [`- **${s.name}** (match: ${score})`];
          if (s.description) parts.push(`: ${s.description.slice(0, 120)}`);
          if (s.whenToUse) parts.push(`\n  When: ${s.whenToUse.slice(0, 150)}`);
          lines.push(parts.join(''));
        }
        lines.push('\nCall with `name` to execute a matching skill.');
        return lines.join('\n');
      }

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

        const lines: string[] = [
          `Found ${skills.length} skills. Use \`suggest\` with a task description to find the best match.\n`,
        ];
        for (const cat of categories) {
          if (cat.skills.length === 0) continue;
          lines.push(`## ${cat.name} (${cat.skills.length})`);
          for (const s of cat.skills) {
            const parts = [`- **${s.name}**`];
            if (s.description) parts.push(`: ${s.description.slice(0, 100)}`);
            if (s.whenToUse) parts.push(` [When: ${s.whenToUse.slice(0, 120)}]`);
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
        return `Skill "${targetName}" not found. Available: ${available || 'none'}\nTip: use \`suggest\` with a task description to find matching skills.`;
      }

      const result = prepareSkillExecution(skill, args);

      if (result.fork) {
        return `[SKILL_FORK]\nPrompt: ${result.prompt}\nAllowed tools: ${result.allowedTools?.join(', ') || 'all'}`;
      }

      return result.prompt;
    },
  });
}
