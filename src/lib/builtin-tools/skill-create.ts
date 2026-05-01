/**
 * skill-create.ts — Quality-gated skill crystallization.
 *
 * Enforces structured templates, dedup checks, and content quality
 * before writing a SKILL.md file. Replaces the old free-form creation.
 */

import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { discoverSkills } from '../skill-discovery';
import { markPromoted } from '../pattern-tracker';

// ── Quality Gates ───────────────────────────────────────────────

interface QualityCheckResult {
  pass: boolean;
  issues: string[];
}

/**
 * Validate skill content against quality criteria.
 */
function validateSkillContent(name: string, content: string, whenToUse: string): QualityCheckResult {
  const issues: string[] = [];

  // 1. Name format
  if (!/^[a-z][a-z0-9-]{2,50}$/.test(name)) {
    issues.push(`Name "${name}" must be lowercase-with-dashes, 3-50 chars`);
  }

  // 2. Content length — too short means it's not a real workflow
  if (content.length < 100) {
    issues.push('Content too short (< 100 chars) — not a meaningful workflow');
  }

  // 3. Must have structured sections
  const requiredSections = ['触发条件', '工作流步骤'];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      issues.push(`Missing required section: ${section}`);
    }
  }

  // 4. whenToUse must be specific, not generic
  const genericPhrases = ['当用户需要帮助时', '当用户提问时', 'When the user asks'];
  if (genericPhrases.some(p => whenToUse.includes(p))) {
    issues.push('whenToUse is too generic — be specific about trigger conditions');
  }

  // 5. Must not contain project-specific paths
  const projectSpecificPatterns = [
    /\/Users\/\w+\/Documents/i,
    /\/Users\/\w+\/Desktop/i,
    /C:\\Users/i,
    /localhost:\d+/,
  ];
  for (const pattern of projectSpecificPatterns) {
    if (pattern.test(content)) {
      issues.push('Content contains project-specific paths — generalize the workflow');
      break;
    }
  }

  return { pass: issues.length === 0, issues };
}

/**
 * Check if a skill with similar name already exists.
 */
function checkDuplicate(name: string, workspacePath: string): boolean {
  try {
    const existingSkills = discoverSkills(workspacePath);
    return existingSkills.some(s => s.name === name);
  } catch {
    return false;
  }
}

// ── Skill Content Builder ───────────────────────────────────────

/**
 * Build structured SKILL.md content from raw parts.
 */
function buildSkillContent(input: {
  name: string;
  description: string;
  whenToUse: string;
  content: string;
  patternKey?: string;
}): string {
  const frontmatter = [
    '---',
    `name: ${input.name}`,
    `description: "${input.description.replace(/"/g, '\\"')}"`,
    `whenToUse: "${input.whenToUse.replace(/"/g, '\\"')}"`,
    'autoExtracted: true',
    'reuseScore: medium',
    input.patternKey ? `patternKey: ${input.patternKey}` : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${frontmatter}

${input.content}
`;
}

// ── Tool Definition ─────────────────────────────────────────────

export const createSkillCreateTool = (workspacePath: string) => tool({
  description: 'Crystallize a proven, recurring workflow into a reusable SKILL.md file. ' +
    'Use this ONLY when a pattern has been observed multiple times and verified to work. ' +
    'One-off solutions, debugging logs, and project-specific fixes should NOT be crystallized. ' +
    'Content must include: 触发条件, 前置条件, 工作流步骤, 预期结果, 不适用场景.',
  inputSchema: z.object({
    name: z.string().describe('Lowercase-with-dashes name (e.g., "electron-rebuild", "fork-sync")'),
    description: z.string().describe('One-sentence description of the reusable workflow'),
    whenToUse: z.string().describe('Specific trigger conditions — when should the AI invoke this skill?'),
    content: z.string().describe('Structured Markdown with: 触发条件, 前置条件, 工作流步骤, 预期结果, 不适用场景'),
    patternKey: z.string().optional().describe('Pattern-key from the pattern tracker (e.g., "build.electron.rebuild")'),
  }),
  execute: async ({ name, description, whenToUse, content, patternKey }: {
    name: string;
    description: string;
    whenToUse: string;
    content: string;
    patternKey?: string;
  }) => {
    try {
      // Quality gate 1: validate content
      const validation = validateSkillContent(name, content, whenToUse);
      if (!validation.pass) {
        return `Skill creation rejected (quality gate):\n${validation.issues.map(i => `- ${i}`).join('\n')}\n\nPlease improve the content and try again.`;
      }

      // Quality gate 2: dedup check
      if (checkDuplicate(name, workspacePath)) {
        return `Skill "${name}" already exists. Consider updating the existing skill instead of creating a duplicate.`;
      }

      // Write the skill
      const skillsDir = path.join(workspacePath, '.claude', 'skills', name);
      fs.mkdirSync(skillsDir, { recursive: true });

      const skillContent = buildSkillContent({ name, description, whenToUse, content, patternKey });
      const filePath = path.join(skillsDir, 'SKILL.md');
      fs.writeFileSync(filePath, skillContent, 'utf-8');

      // Mark pattern as promoted if patternKey provided
      if (patternKey) {
        try {
          markPromoted(workspacePath, patternKey, name);
        } catch {
          // pattern tracker may not exist yet — non-fatal
        }
      }

      // Notify
      try {
        const { sendNotification } = await import('@/lib/notification-manager');
        await sendNotification({
          title: '技能结晶',
          body: `模式 "${patternKey || name}" 已提炼为可复用技能：${name}`,
          priority: 'normal',
        });
      } catch (e) {
        console.error('[skill-create] Failed to notify:', e);
      }

      return `Skill crystallized: ${name} → ${filePath}\nTrigger: ${whenToUse}`;
    } catch (e) {
      return `Failed to create skill: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
