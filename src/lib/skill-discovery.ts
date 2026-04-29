import { parseSkillFile, type SkillDefinition } from './skill-parser';
import { discoverEffectiveSkillFiles } from './skills-registry';

// Cache for discovered skills (invalidated on re-scan)
let cachedSkills: SkillDefinition[] | null = null;
let cacheWorkingDir: string | null = null;

/**
 * Discover all available skills for the given working directory.
 * Results are cached per working directory.
 */
export function discoverSkills(workingDirectory?: string): SkillDefinition[] {
  const cwd = workingDirectory || process.cwd();

  if (cachedSkills && cacheWorkingDir === cwd) {
    return cachedSkills;
  }

  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  // 中文注释：功能名称「统一技能发现桥接」，用法是复用共享注册表扫描结果，
  // 让 Skill 工具与管理页看到同一批技能文件，避免目录来源不一致。
  for (const entry of discoverEffectiveSkillFiles({ cwd })) {
    try {
      const skill = parseSkillFile(entry.content, entry.filePath);
      const key = skill.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        skills.push(skill);
      }
    } catch {
      // Skip unparseable files
    }
  }

  cachedSkills = skills;
  cacheWorkingDir = cwd;
  return skills;
}

/**
 * Invalidate the skill cache (call after skill files change).
 */
export function invalidateSkillCache(): void {
  cachedSkills = null;
  cacheWorkingDir = null;
}

/**
 * Get a skill by name.
 */
export function getSkill(name: string, workingDirectory?: string): SkillDefinition | undefined {
  const skills = discoverSkills(workingDirectory);
  return skills.find(s => s.name === name || s.name.toLowerCase() === name.toLowerCase());
}
