import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SkillKind } from '@/types';

export interface DiscoveredSkillFile {
  name: string;
  description: string;
  content: string;
  source: 'global' | 'project' | 'plugin' | 'installed' | 'sdk';
  kind: SkillKind;
  installedSource?: 'agents' | 'claude';
  filePath: string;
  autoExtracted?: boolean;
  loaded?: boolean;
  migratedFrom?: string[];
}

export interface LegacySkillMigrationResult {
  migratedNames: string[];
  conflictNames: string[];
}

export function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands');
}

export function getProjectCommandsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.claude', 'commands');
}

export function getGlobalSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

export function getProjectSkillsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.claude', 'skills');
}

function getOmcGlobalSkillsDir(): string {
  return path.join(os.homedir(), '.omc', 'skills');
}

function getOmcLearnedSkillsDir(): string {
  return path.join(getGlobalSkillsDir(), 'omc-learned');
}

function getProjectOmcSkillsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.omc', 'skills');
}

function getLegacyAgentsSkillsDir(): string {
  return path.join(os.homedir(), '.agents', 'skills');
}

function parseSkillFrontMatter(content: string): { name?: string; description?: string; autoExtracted?: boolean } {
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) return {};

  const frontMatter = fmMatch[1];
  const lines = frontMatter.split(/\r?\n/);
  const result: { name?: string; description?: string; autoExtracted?: boolean } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    const autoExtractedMatch = line.match(/^autoExtracted:\s*(true|false)/i);
    if (autoExtractedMatch) {
      result.autoExtracted = autoExtractedMatch[1].toLowerCase() === 'true';
      continue;
    }

    if (/^description:\s*\|/.test(line)) {
      const descLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+/.test(lines[j])) {
          descLines.push(lines[j].trim());
        } else {
          break;
        }
      }
      if (descLines.length > 0) {
        result.description = descLines.filter(Boolean).join(' ');
      }
      continue;
    }

    const descMatch = line.match(/^description:\s+(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }

  return result;
}

function scanDirectory(
  dir: string,
  source: 'global' | 'project' | 'plugin',
  prefix = '',
): DiscoveredSkillFile[] {
  const skills: DiscoveredSkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
        skills.push(...scanDirectory(fullPath, source, subPrefix));
        continue;
      }

      if (!entry.name.endsWith('.md')) continue;
      const baseName = entry.name.replace(/\.md$/, '');
      const name = prefix ? `${prefix}:${baseName}` : baseName;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const firstLine = content.split('\n')[0]?.trim() || '';
      const description = firstLine.startsWith('#')
        ? firstLine.replace(/^#+\s*/, '')
        : firstLine || `Skill: /${name}`;
      skills.push({
        name,
        description,
        content,
        source,
        kind: 'slash_command',
        filePath: fullPath,
      });
    }
  } catch {
    // ignore read errors
  }

  return skills;
}

function scanSkillsDirectory(
  dir: string,
  source: 'global' | 'project' | 'plugin',
  migratedFrom?: string[],
): DiscoveredSkillFile[] {
  const skills: DiscoveredSkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const meta = parseSkillFrontMatter(content);
      const name = meta.name || entry.name;
      const description = meta.description || `Skill: /${name}`;

      skills.push({
        name,
        description,
        content,
        source,
        kind: 'agent_skill',
        filePath: skillMdPath,
        autoExtracted: meta.autoExtracted,
        ...(migratedFrom?.length ? { migratedFrom } : {}),
      });
    }
  } catch {
    // ignore read errors
  }

  return skills;
}

function listMarketplacePluginRoots(pluginsRoot: string): string[] {
  const roots: string[] = [];
  const marketplacesDir = path.join(pluginsRoot, 'marketplaces');
  if (!fs.existsSync(marketplacesDir)) return roots;

  try {
    const marketplaces = fs.readdirSync(marketplacesDir);
    for (const marketplace of marketplaces) {
      const marketplaceDir = path.join(marketplacesDir, marketplace);
      if (fs.existsSync(path.join(marketplaceDir, '.claude-plugin', 'plugin.json'))) {
        roots.push(marketplaceDir);
      }

      const pluginsDir = path.join(marketplaceDir, 'plugins');
      if (!fs.existsSync(pluginsDir)) continue;
      const plugins = fs.readdirSync(pluginsDir);
      for (const plugin of plugins) {
        const pluginDir = path.join(pluginsDir, plugin);
        if (fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'))) {
          roots.push(pluginDir);
        }
      }
    }
  } catch {
    // ignore marketplace plugin scan errors
  }

  return roots;
}

function hashDirectory(dir: string): string {
  const hash = crypto.createHash('sha1');

  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);
      hash.update(relativePath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        hash.update(fs.readFileSync(fullPath));
      }
    }
  };

  walk(dir);
  return hash.digest('hex');
}

// 中文注释：功能名称「旧技能目录迁移」，用法是把历史上留在 `~/.agents/skills`
// 的技能目录自动迁入 `~/.claude/skills`，让前端展示、编辑和运行时注入都回到
// Claude 层同一套目录，避免“界面看到一份、会话实际读另一份”。
export function migrateLegacyAgentSkillsToClaude(): LegacySkillMigrationResult {
  const legacyDir = getLegacyAgentsSkillsDir();
  const targetDir = getGlobalSkillsDir();
  const migratedNames = new Set<string>();
  const conflictNames = new Set<string>();

  if (!fs.existsSync(legacyDir)) {
    return { migratedNames: [], conflictNames: [] };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(legacyDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const legacySkillDir = path.join(legacyDir, entry.name);
    const legacySkillFile = path.join(legacySkillDir, 'SKILL.md');
    if (!fs.existsSync(legacySkillFile)) continue;

    const targetSkillDir = path.join(targetDir, entry.name);
    if (!fs.existsSync(targetSkillDir)) {
      fs.cpSync(legacySkillDir, targetSkillDir, { recursive: true });
      migratedNames.add(entry.name);
      continue;
    }

    if (hashDirectory(legacySkillDir) !== hashDirectory(targetSkillDir)) {
      conflictNames.add(entry.name);
    }
  }

  return {
    migratedNames: Array.from(migratedNames).sort(),
    conflictNames: Array.from(conflictNames).sort(),
  };
}

function getPluginCommandsDirs(): string[] {
  const dirs: string[] = [];
  const pluginsRoot = path.join(os.homedir(), '.claude', 'plugins');
  for (const pluginRoot of listMarketplacePluginRoots(pluginsRoot)) {
    const commandsDir = path.join(pluginRoot, 'commands');
    if (fs.existsSync(commandsDir)) dirs.push(commandsDir);
  }

  const externalDir = path.join(pluginsRoot, 'external_plugins');
  if (fs.existsSync(externalDir)) {
    try {
      const externals = fs.readdirSync(externalDir);
      for (const plugin of externals) {
        const commandsDir = path.join(externalDir, plugin, 'commands');
        if (fs.existsSync(commandsDir)) dirs.push(commandsDir);
      }
    } catch {
      // ignore
    }
  }

  return dirs;
}

function getPluginSkillsDirs(): string[] {
  const dirs: string[] = [];
  const pluginsRoot = path.join(os.homedir(), '.claude', 'plugins');
  for (const pluginRoot of listMarketplacePluginRoots(pluginsRoot)) {
    const skillsDir = path.join(pluginRoot, 'skills');
    if (fs.existsSync(skillsDir)) dirs.push(skillsDir);
  }

  const externalDir = path.join(pluginsRoot, 'external_plugins');
  if (fs.existsSync(externalDir)) {
    try {
      const externals = fs.readdirSync(externalDir);
      for (const plugin of externals) {
        const skillsDir = path.join(externalDir, plugin, 'skills');
        if (fs.existsSync(skillsDir)) dirs.push(skillsDir);
      }
    } catch {
      // ignore
    }
  }

  return dirs;
}

export interface DiscoverEffectiveSkillsOptions {
  cwd?: string;
  loadedPluginPaths?: Set<string> | null;
}

// 中文注释：功能名称「统一技能注册表扫描」，用法是让技能管理页、Slash 弹窗和运行时发现共用同一批文件系统技能来源，
// 避免前端与 Skill 工具分别扫描不同目录导致“界面能看到但 AI 用不到”。
export function discoverEffectiveSkillFiles(options: DiscoverEffectiveSkillsOptions = {}): DiscoveredSkillFile[] {
  const cwd = options.cwd || process.cwd();
  const migratedSkills = migrateLegacyAgentSkillsToClaude();
  const globalCommands = scanDirectory(getGlobalCommandsDir(), 'global');
  const globalAgentSkills = scanSkillsDirectory(
    getGlobalSkillsDir(),
    'global',
    migratedSkills.migratedNames.length > 0 ? ['.agents/skills'] : undefined,
  );
  // 中文注释：功能名称「OMC 技能目录兼容」，用法是把 OMC 自己维护的 learned skills
  // 目录一起纳入统一技能发现，避免终端能命中而桌面端注册表完全看不到。
  const globalOmcSkills = [
    ...scanDirectory(getOmcGlobalSkillsDir(), 'global', 'omc'),
    ...scanDirectory(getOmcLearnedSkillsDir(), 'global', 'omc-learned'),
  ];
  const projectCommands = scanDirectory(getProjectCommandsDir(cwd), 'project');
  const projectLevelSkills = scanSkillsDirectory(getProjectSkillsDir(cwd), 'project');
  const projectOmcSkills = scanDirectory(getProjectOmcSkillsDir(cwd), 'project', 'omc');
  const projectCommandNames = new Set(projectCommands.map((skill) => skill.name));
  const dedupedProjectSkills = projectLevelSkills.filter((skill) => !projectCommandNames.has(skill.name));
  const projectKnownNames = new Set([
    ...projectCommandNames,
    ...dedupedProjectSkills.map((skill) => skill.name),
  ].map((name) => name.toLowerCase()));
  const dedupedProjectOmcSkills = projectOmcSkills.filter((skill) => !projectKnownNames.has(skill.name.toLowerCase()));
  const globalCommandNames = new Set(globalCommands.map((skill) => skill.name));
  const dedupedGlobalAgentSkills = globalAgentSkills.filter((skill) => !globalCommandNames.has(skill.name));
  const globalKnownNames = new Set([
    ...globalCommandNames,
    ...dedupedGlobalAgentSkills.map((skill) => skill.name),
  ].map((name) => name.toLowerCase()));
  const dedupedGlobalOmcSkills = globalOmcSkills.filter((skill) => !globalKnownNames.has(skill.name.toLowerCase()));

  const pluginSkills: DiscoveredSkillFile[] = [];
  for (const dir of getPluginCommandsDirs()) {
    pluginSkills.push(...scanDirectory(dir, 'plugin'));
  }
  for (const dir of getPluginSkillsDirs()) {
    pluginSkills.push(...scanSkillsDirectory(dir, 'plugin'));
  }

  const annotatedPluginSkills = pluginSkills.map((skill) => ({
    ...skill,
    loaded: options.loadedPluginPaths
      ? (() => {
          let dir = path.dirname(skill.filePath);
          while (dir && dir !== path.dirname(dir)) {
            if (options.loadedPluginPaths!.has(dir)) return true;
            dir = path.dirname(dir);
          }
          return false;
        })()
      : undefined,
  }));

  return [
    ...globalCommands,
    ...dedupedGlobalAgentSkills,
    ...dedupedGlobalOmcSkills,
    ...projectCommands,
    ...dedupedProjectSkills,
    ...dedupedProjectOmcSkills,
    ...annotatedPluginSkills,
  ];
}
