import { parseSkillFile, type SkillDefinition } from './skill-parser';
import { discoverEffectiveSkillFiles } from './skills-registry';
import { getSetting } from './db';

// Cache for discovered skills (invalidated on re-scan)
let cachedSkills: SkillDefinition[] | null = null;
let cacheWorkingDir: string | null = null;

/**
 * Get the set of disabled skill names from the DB settings.
 * Returns a lowercased Set for efficient lookup.
 */
function getDisabledSkills(): Set<string> {
  try {
    const raw = getSetting('disabled_skills');
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((s: string) => s.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Discover all available skills for the given working directory.
 * Results are cached per working directory. Disabled skills are excluded.
 */
export function discoverSkills(workingDirectory?: string): SkillDefinition[] {
  const cwd = workingDirectory || process.cwd();

  if (cachedSkills && cacheWorkingDir === cwd) {
    return cachedSkills;
  }

  const disabledSkills = getDisabledSkills();
  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of discoverEffectiveSkillFiles({ cwd })) {
    // Skip disabled skills globally
    if (disabledSkills.has(entry.name.toLowerCase())) continue;

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
