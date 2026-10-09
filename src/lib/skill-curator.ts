/**
 * skill-curator.ts — Periodic skill consolidation and lifecycle management.
 *
 * Runs as a background task (on-demand or scheduled) to:
 * 1. Cluster skills by prefix/domain
 * 2. Identify stale skills (unused for 30+ days)
 * 3. Archive dead skills (unused for 90+ days)
 * 4. Merge overlapping skills into umbrella skills
 * 5. Report on skill health
 */

import * as fs from 'fs';
import * as path from 'path';
import { discoverSkills } from './skill-discovery';

// ── Types ───────────────────────────────────────────────────────

export interface SkillHealth {
  name: string;
  path: string;
  lastModified: Date;
  daysSinceModified: number;
  status: 'active' | 'stale' | 'dead';
  cluster?: string;
}

export interface CurationReport {
  totalSkills: number;
  active: number;
  stale: number;
  dead: number;
  clusters: Array<{
    prefix: string;
    skills: string[];
    shouldMerge: boolean;
  }>;
  actions: string[];
}

// ── Skill Health Analysis ───────────────────────────────────────

/**
 * Analyze health of all skills in the workspace.
 */
export function analyzeSkillHealth(workspacePath: string): SkillHealth[] {
  const skills = discoverSkills(workspacePath);
  const now = Date.now();

  return skills.map(s => {
    const skillDir = path.join(workspacePath, '.claude', 'skills', s.name);
    let lastModified = new Date(0);
    try {
      const stat = fs.statSync(path.join(skillDir, 'SKILL.md'));
      lastModified = stat.mtime;
    } catch {
      // skill may be in global dir — try alternate path
      try {
        const globalDir = path.join(require('os').homedir(), '.claude', 'skills', s.name);
        const stat = fs.statSync(path.join(globalDir, 'SKILL.md'));
        lastModified = stat.mtime;
      } catch {
        // can't determine age
      }
    }

    const daysSince = Math.floor((now - lastModified.getTime()) / (1000 * 60 * 60 * 24));
    let status: SkillHealth['status'] = 'active';
    if (daysSince > 90) status = 'dead';
    else if (daysSince > 30) status = 'stale';

    return {
      name: s.name,
      path: skillDir,
      lastModified,
      daysSinceModified: daysSince,
      status,
      cluster: extractCluster(s.name),
    };
  });
}

/**
 * Extract cluster prefix from skill name.
 * e.g., "debug-css-purge" → "debug", "lark-calendar" → "lark"
 */
function extractCluster(name: string): string {
  const knownPrefixes = [
    'debug', 'fix', 'build', 'test', 'deploy',
    'lark', 'ckm', 'ui', 'code', 'git',
    'electron', 'wechat', 'photo', 'web',
  ];
  const first = name.split('-')[0];
  return knownPrefixes.includes(first) ? first : name;
}

// ── Clustering ──────────────────────────────────────────────────

/**
 * Group skills by cluster and identify merge candidates.
 */
export function clusterSkills(health: SkillHealth[]): CurationReport['clusters'] {
  const clusters = new Map<string, string[]>();

  for (const h of health) {
    const key = h.cluster || 'other';
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(h.name);
  }

  return [...clusters.entries()].map(([prefix, skills]) => ({
    prefix,
    skills,
    shouldMerge: skills.length >= 3 && prefix !== 'other',
  }));
}

// ── Curation Report ─────────────────────────────────────────────

/**
 * Generate a full curation report with recommended actions.
 */
export function generateCurationReport(workspacePath: string): CurationReport {
  const health = analyzeSkillHealth(workspacePath);
  const clusters = clusterSkills(health);

  const active = health.filter(h => h.status === 'active').length;
  const stale = health.filter(h => h.status === 'stale').length;
  const dead = health.filter(h => h.status === 'dead').length;

  const actions: string[] = [];

  // Stale skill warnings
  const staleSkills = health.filter(h => h.status === 'stale');
  if (staleSkills.length > 0) {
    actions.push(`⚠️ ${staleSkills.length} 个技能超过 30 天未更新，可能已过时: ${staleSkills.map(s => s.name).join(', ')}`);
  }

  // Dead skill archive suggestions
  const deadSkills = health.filter(h => h.status === 'dead');
  if (deadSkills.length > 0) {
    actions.push(`🗑️ ${deadSkills.length} 个技能超过 90 天未更新，建议归档: ${deadSkills.map(s => s.name).join(', ')}`);
  }

  // Merge suggestions
  const mergeCandidates = clusters.filter(c => c.shouldMerge);
  for (const cluster of mergeCandidates) {
    actions.push(`🔄 "${cluster.prefix}" 领域有 ${cluster.skills.length} 个技能，建议合并为 umbrella skill: ${cluster.skills.join(', ')}`);
  }

  return {
    totalSkills: health.length,
    active,
    stale,
    dead,
    clusters,
    actions,
  };
}

// ── Lifecycle Management ────────────────────────────────────────

/**
 * Archive a dead skill by moving it to .archive/skills/.
 */
export function archiveSkill(workspacePath: string, skillName: string): boolean {
  const srcDir = path.join(workspacePath, '.claude', 'skills', skillName);
  const archiveDir = path.join(workspacePath, '.claude', 'skills', '.archive');

  if (!fs.existsSync(srcDir)) return false;

  fs.mkdirSync(archiveDir, { recursive: true });
  const destDir = path.join(archiveDir, skillName);

  try {
    fs.renameSync(srcDir, destDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the curation prompt for AI to evaluate merge candidates.
 */
export function buildMergeEvaluationPrompt(cluster: {
  prefix: string;
  skills: string[];
}): string {
  return `评估以下 "${cluster.prefix}" 领域的技能是否应该合并：

技能列表：${cluster.skills.join(', ')}

请分析：
1. 这些技能的共同主题是什么？
2. 合并后的 umbrella skill 应该叫什么？
3. 哪些内容应该保留，哪些应该降级为 references/？
4. 合并后的触发条件应该是什么？

严格按 JSON 格式输出：
{
  "shouldMerge": true/false,
  "umbrellaName": "合并后的名称",
  "description": "一句话描述",
  "whenToUse": "触发条件",
  "keepSkills": ["保留为子技能的名称"],
  "archiveSkills": ["归档的名称"],
  "mergedContent": "合并后的 Markdown 内容"
}`;
}
