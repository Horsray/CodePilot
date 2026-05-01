/**
 * agent-system-prompt.ts — Desktop context assembler.
 *
 * Builds CodePilot-specific context (environment, project instructions,
 * knowledge base, skills catalog) to append to the SDK's claude_code preset.
 * Behavioral instructions (task orchestration, tool usage, tone, etc.) are
 * handled natively by the SDK preset and OMC hooks — no duplication here.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import type { PromptInstructionSourceMeta } from '@/types';
import { getDb, getAllCustomRules } from './db';
import { discoverSkills } from './skill-discovery';

// ── Assembly ───────────────────────────────────────────────────

export interface SystemPromptOptions {
  sessionId?: string;
  workingDirectory?: string;
  contextSnippets?: string[];
  modelId?: string;
  omcPluginEnabled?: boolean;
  includeAgentsMd?: boolean;
  includeClaudeMd?: boolean;
  enableAgentsSkills?: boolean;
  syncProjectRules?: boolean;
  knowledgeBaseEnabled?: boolean;
  includeDiscoveredProjectInstructions?: boolean;
}

export interface SystemPromptResult {
  prompt: string;
  referencedFiles: string[];
  instructionSources: PromptInstructionSourceMeta[];
}

/**
 * Build CodePilot-specific context to append to the SDK's claude_code preset.
 * Behavioral instructions are handled by the SDK preset and OMC — we only
 * assemble environment context, project instructions, KB, and skills catalog.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): SystemPromptResult {
  const parts: string[] = [];
  const referencedFiles: string[] = [];
  const instructionSources: PromptInstructionSourceMeta[] = [];

  // Environment context (cwd, platform, shell, git)
  const envSection = buildEnvironmentSection(options);
  if (envSection) {
    parts.push(envSection);
    instructionSources.push({
      filename: 'Environment',
      level: 'workspace',
      category: 'environment',
    });
  }

  // CodePilot-hosted supplemental instructions (not CLAUDE.md/AGENTS.md — those are native)
  if (options.workingDirectory && options.includeDiscoveredProjectInstructions !== false) {
    const projectInstructions = discoverProjectInstructions(options.workingDirectory, options);
    if (projectInstructions) {
      parts.push(`# CodePilot Host Instructions\n\nThese are CodePilot-hosted supplemental instructions that are not part of Claude Code's native project/user instruction loading. Use them to supplement, not replace, Claude Code's default behavior.\n\n${projectInstructions.content}`);
      referencedFiles.push(...projectInstructions.files);
      // Map InstructionSource[] to PromptInstructionSourceMeta[]
      for (const src of projectInstructions.sources) {
        instructionSources.push({
          filename: src.filename,
          level: src.level,
          category: src.level === 'global' || src.level === 'personal' ? 'hard_rule' : 'repo_instruction',
          filePath: src.filePath,
        });
      }
    }
  }

  // Knowledge base (graphify)
  if (options.workingDirectory && options.knowledgeBaseEnabled !== false) {
    const kbInstructions = discoverKnowledgeBaseInstructions(options.workingDirectory);
    if (kbInstructions) {
      parts.push(`# Knowledge Base (Atomic Knowledge Graph)\n\nA Knowledge Graph built via 'graphify' exists for this workspace. Use it to understand architecture, god nodes, and community structures before searching raw files. This will significantly reduce token usage and improve accuracy.\n\n${kbInstructions.content}`);
      referencedFiles.push(...kbInstructions.files);
      instructionSources.push({
        filename: 'graphify-out/graph.json',
        level: 'workspace',
        category: 'knowledge_base',
        filePath: kbInstructions.files[0],
      });
    }
  }

  // MCP server prompts and other context snippets
  if (options.contextSnippets?.length) {
    for (const snippet of options.contextSnippets) {
      if (snippet.trim()) {
        parts.push(snippet);
      }
    }
  }

  // Skills catalog (lightweight visibility index)
  if (options.workingDirectory) {
    try {
      const skillsCatalog = buildDiscoveredSkillsCatalog(options.workingDirectory, 24, { lightweight: true });
      if (skillsCatalog) {
        parts.push(skillsCatalog);
        referencedFiles.push('Skills Catalog (Auto-discovered)');
        instructionSources.push({
          filename: 'Skills Catalog (Auto-discovered)',
          level: 'workspace',
          category: 'skill_catalog',
        });
      }
    } catch {
      // skills discovery failed — don't block prompt assembly
    }
  }

  return {
    prompt: parts.join('\n\n'),
    referencedFiles,
    instructionSources,
  };
}

// 中文注释：功能名称「环境上下文构建」，用法是恢复历史主控模式里的平台、Shell、
// 工作目录和 Git 摘要，给复杂任务判断和工具选择提供更强的环境背景。
function buildEnvironmentSection(options: SystemPromptOptions): string | null {
  const lines: string[] = ['# Environment'];

  if (options.workingDirectory) {
    lines.push(`- Primary working directory: ${options.workingDirectory}`);

    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: options.workingDirectory, encoding: 'utf-8', timeout: 3000, stdio: 'pipe',
      });
      lines.push('  - Is a git repository: true');
    } catch {
      lines.push('  - Is a git repository: false');
    }
  }

  lines.push(`- Platform: ${process.platform}`);
  const shell = process.env.SHELL ? path.basename(process.env.SHELL) : 'unknown';
  lines.push(`- Shell: ${shell}`);

  try {
    const osVersion = execSync('uname -sr', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim();
    lines.push(`- OS Version: ${osVersion}`);
  } catch {
    // ignore
  }

  if (options.modelId) {
    lines.push(`- Model: ${options.modelId}`);
  }

  lines.push(`- Current date: ${new Date().toISOString().split('T')[0]}`);

  if (options.workingDirectory) {
    const gitContext = getGitContext(options.workingDirectory);
    if (gitContext) {
      lines.push('');
      lines.push(gitContext);
    }
  }

  return lines.join('\n');
}

// ── Instruction source hierarchy ────────────────────────────────
// Modeled after Claude Code's claudemd.ts priority system.
// Priority (lower = higher precedence): user > project > workspace > parent

type InstructionLevel = 'global' | 'personal' | 'user' | 'project' | 'workspace' | 'parent';

interface InstructionSource {
  level: InstructionLevel;
  filename: string;
  content: string;
  filePath?: string;
}

const MAX_FILE_SIZE = 50 * 1024; // 50KB per file
const GLOBAL_RULE_FILE_LIMIT = 24;

// 中文注释：功能名称「规则路径规范化匹配」，用法是把路径统一成绝对路径，
// 供项目规则匹配和规则发现接口复用；这里只保留兼容外部调用所需的最小能力。
export function normalizeInstructionPathForMatch(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isSameOrDescendantPath(currentPath: string, targetPath: string): boolean {
  if (currentPath === targetPath) return true;
  return currentPath.startsWith(targetPath.endsWith(path.sep) ? targetPath : `${targetPath}${path.sep}`);
}

// 中文注释：功能名称「项目规则命中判断」，用法是判断当前目录是否位于目标项目根目录内，
// 兼容 worktree 和子目录场景；仅用于规则发现接口，不参与本轮 prompt steering。
export function matchesProjectRulePaths(currentPath: string, ruleTargets: string[]): boolean {
  if (!currentPath || !Array.isArray(ruleTargets) || ruleTargets.length === 0) return false;
  const normalizedCurrent = normalizeInstructionPathForMatch(currentPath);
  return ruleTargets.some((targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    const normalizedTarget = normalizeInstructionPathForMatch(targetPath);
    return isSameOrDescendantPath(normalizedCurrent, normalizedTarget);
  });
}

// 中文注释：功能名称「规则搜索根目录发现」，用法是返回当前目录、git 根目录和父目录，
// 供设置页规则同步接口复用，不改变主聊天链路的提示词内容。
export function getInstructionSearchRoots(cwd: string): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const addRoot = (candidate?: string) => {
    if (!candidate) return;
    const normalized = normalizeInstructionPathForMatch(candidate);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    roots.push(normalized);
  };

  addRoot(cwd);
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 1500,
      stdio: 'pipe',
    }).trim();
    addRoot(gitRoot);
  } catch {
    // ignore
  }
  const parent = path.dirname(cwd);
  if (parent !== cwd) addRoot(parent);
  return roots;
}

interface ExternalInstructionCandidate {
  filePath: string;
  label: string;
  level: InstructionLevel;
}

function walkMarkdownFiles(rootDir: string, maxFiles: number): string[] {
  const results: string[] = [];
  const visit = (currentDir: string) => {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
  };
  visit(rootDir);
  return results;
}

// 中文注释：功能名称「项目外规则候选发现」，用法是供规则同步接口读取用户级和全局级规则；
// 主聊天链路当前不额外依赖这个候选列表来做新增 steering。
export function getExternalInstructionCandidates(homeDir = os.homedir()): ExternalInstructionCandidate[] {
  const candidates: ExternalInstructionCandidate[] = [];
  const pushIfExists = (filePath: string, label: string, level: InstructionLevel) => {
    if (!fs.existsSync(filePath)) return;
    candidates.push({ filePath, label, level });
  };

  pushIfExists(path.join(homeDir, '.claude', 'CLAUDE.md'), 'CLAUDE.md (user)', 'user');
  pushIfExists(path.join(homeDir, '.claude', 'CLAUDE.local.md'), 'CLAUDE.local.md (user)', 'user');
  pushIfExists(path.join(homeDir, '.trae', 'rules', 'rules.md'), 'Trae Rules (user)', 'global');

  const codepilotRulesDir = path.join(homeDir, '.codepilot', 'rules');
  if (fs.existsSync(codepilotRulesDir)) {
    for (const filePath of walkMarkdownFiles(codepilotRulesDir, GLOBAL_RULE_FILE_LIMIT)) {
      const relative = path.relative(codepilotRulesDir, filePath) || path.basename(filePath);
      candidates.push({
        filePath,
        label: `CodePilot Rule (${relative})`,
        level: 'global',
      });
    }
  }
  return candidates;
}

// 中文注释：功能名称「技能目录摘要」，用法是生成轻量级 skills 可见性索引，
// 注入系统提示让模型在复杂任务开始前能主动发现可用的 Skill。
export function buildDiscoveredSkillsCatalog(
  cwd: string,
  maxSkills = 40,
  options: { lightweight?: boolean } = {},
): string | null {
  const skills = discoverSkills(cwd);
  if (skills.length === 0) return null;
  const lightweight = options.lightweight === true;
  const lines = [
    lightweight ? '## Lightweight Skills Visibility' : '## Auto-Discovered Skills Catalog',
    lightweight
      ? 'The following reusable skills are available via the `Skill` tool. This is a lightweight visibility index for local skills.'
      : 'The following reusable skills are available via the `Skill` tool. Prefer invoking `Skill` for matching workflows instead of re-deriving the workflow manually.',
  ];

  // 中文注释：将技能按类别分组显示，让模型快速定位而非逐条扫描
  const categories: { name: string; skills: typeof skills }[] = [
    { name: 'Build & Deploy', skills: [] },
    { name: 'Code Exploration', skills: [] },
    { name: 'Debug & Troubleshoot', skills: [] },
    { name: 'Test & Verify', skills: [] },
    { name: 'Integrations', skills: [] },
    { name: 'Knowledge', skills: [] },
    { name: 'Other', skills: [] },
  ];

  const classify = (s: typeof skills[0]): number => {
    const n = s.name.toLowerCase();
    const d = (s.description + ' ' + (s.whenToUse || '')).toLowerCase();
    if (n.includes('build') || n.includes('electron') || n.includes('package') || n.includes('deploy') || d.includes('构建') || d.includes('打包')) return 0;
    if (n.includes('explore') || n.includes('search') || n.includes('find') || n.includes('locate') || n.includes('discover') || n.includes('codebase') || d.includes('探索') || d.includes('搜索')) return 1;
    if (n.includes('debug') || n.includes('troubleshoot') || n.includes('diagnose') || n.includes('fix') || n.includes('recover') || n.includes('handle') || d.includes('调试') || d.includes('排查') || d.includes('修复')) return 2;
    if (n.includes('test') || n.includes('verif') || n.includes('check') || n.includes('valid') || d.includes('测试') || d.includes('验证')) return 3;
    if (n.includes('feishu') || n.includes('lark') || n.includes('wechat') || n.includes('telegram') || n.includes('bot') || n.includes('bridge') || n.includes('channel') || d.includes('飞书')) return 4;
    if (n.includes('knowledge') || n.includes('learn') || n.includes('research') || n.includes('memory') || n.includes('graphify') || d.includes('知识') || d.includes('学习') || d.includes('研究')) return 5;
    return 6;
  };

  let remaining = maxSkills;
  for (const s of skills) {
    if (remaining <= 0) break;
    categories[classify(s)].skills.push(s);
    remaining--;
  }

  for (const cat of categories) {
    if (cat.skills.length === 0) continue;
    lines.push(`\n### ${cat.name} (${cat.skills.length})`);
    for (const skill of cat.skills) {
      const description = (skill.description || 'No description provided').slice(0, 100);
      const whenToUse = (skill.whenToUse || '').slice(0, 140);
      const kind = skill.userInvocable ? 'slash+skill' : 'skill';
      lines.push(`- ${skill.name} [${kind}, ${skill.context}] — ${description}`);
      if (whenToUse) lines.push(`  triggers: ${whenToUse}`);
    }
  }
  if (skills.length > maxSkills) {
    lines.push(`\n... ${skills.length - maxSkills} more skills — call the Skill tool without arguments to see them all.`);
  }
  return lines.join('\n');
}

/**
 * Discover Knowledge Base instructions (graphify-out/graph.json).
 */
function discoverKnowledgeBaseInstructions(cwd: string): { content: string, files: string[] } | null {
  const kbGraphJson = path.join(cwd, 'graphify-out', 'graph.json');
  
  if (fs.existsSync(kbGraphJson)) {
    try {
      let instruction = `## Unified Knowledge Base (graphify + MCP Memory)\n\n`;
      instruction += `A structured knowledge graph exists for this project. It is synchronized between 'graphify-out/' and the dynamic MCP Memory server.\n`;
      instruction += `### Usage Guidelines:\n`;
      instruction += `1. **Integrated Search**: Use 'codepilot_kb_search' to find nodes in the unified graph. It searches both structural extraction and dynamic observations.\n`;
      instruction += `2. **Deep Graph Analysis**: Use 'codepilot_kb_query' for complex architectural questions. It uses graphify's BFS/DFS engines to trace dependencies.\n`;
      instruction += `3. **Dynamic Learning**: Use 'codepilot_memory_store' to save new architectural insights, user preferences, or project facts into the long-term graph.\n`;
      instruction += `4. **Low-level Access**: For direct node/edge inspection, you can still read 'graphify-out/graph.json'.\n`;

      return {
        content: instruction,
        files: ['graphify-out/graph.json'],
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Discover CodePilot-hosted supplemental instructions.
 * Native Claude Code project/user instructions are intentionally excluded here,
 * because the SDK already loads them through settingSources.
 */
function discoverProjectInstructions(cwd: string, options: SystemPromptOptions = {}): { content: string, files: string[], sources: InstructionSource[] } | null {
  const sources: InstructionSource[] = [];
  const seen = new Set<string>(); // dedup by resolved path

  // 1. Custom Database Rules (Personal & Project)
  try {
    const customRules = getAllCustomRules().filter(r => r.enabled);
    
    // Personal rules (apply to all)
    const personalRules = customRules.filter(r => r.type === 'personal');
    for (const rule of personalRules) {
      sources.push({
        filename: `Rule: ${rule.name} (Global)`,
        content: rule.content,
        level: 'global'
      });
    }

    // Project rules (apply if matched)
    const currentPath = (() => {
      if (options.sessionId) {
        const db = getDb();
        const session = db.prepare('SELECT working_directory FROM chat_sessions WHERE id = ?').get(options.sessionId) as any;
        if (session?.working_directory) return session.working_directory as string;
      }
      return options.workingDirectory;
    })();

    if (currentPath) {
      const projectRules = customRules.filter(r => {
        if (r.type !== 'project') return false;
        try {
          const targetPaths = JSON.parse(r.project_ids);
          return matchesProjectRulePaths(currentPath, targetPaths);
        } catch { return false; }
      });

      for (const rule of projectRules) {
        sources.push({
          filename: `Rule: ${rule.name} (Project)`,
          content: rule.content,
          level: 'project'
        });
      }
    }
  } catch (err) {
    console.error('[agent-system-prompt] Failed to load custom rules from DB:', err);
  }

  // 2. Project .claude/rules/ directory (filesystem — supplements DB rules)
  const projectRulesDir = path.join(cwd, '.claude', 'rules');
  if (fs.existsSync(projectRulesDir)) {
    try {
      const ruleFiles = walkMarkdownFiles(projectRulesDir, GLOBAL_RULE_FILE_LIMIT);
      for (const filePath of ruleFiles) {
        if (seen.has(path.resolve(filePath))) continue;
        const content = tryReadFile(filePath);
        if (content) {
          seen.add(path.resolve(filePath));
          sources.push({
            level: 'project',
            filename: `Rule: ${path.basename(filePath, '.md')} (Project .claude/rules)`,
            content,
            filePath,
          });
        }
      }
    } catch {
      // ignore filesystem rule scan errors
    }
  }

  // 3. User ~/.claude/rules/ directory (filesystem — supplements DB rules)
  const homeRulesDir = path.join(os.homedir(), '.claude', 'rules');
  if (fs.existsSync(homeRulesDir) && homeRulesDir !== projectRulesDir) {
    try {
      const ruleFiles = walkMarkdownFiles(homeRulesDir, GLOBAL_RULE_FILE_LIMIT);
      for (const filePath of ruleFiles) {
        if (seen.has(path.resolve(filePath))) continue;
        const content = tryReadFile(filePath);
        if (content) {
          seen.add(path.resolve(filePath));
          sources.push({
            level: 'user',
            filename: `Rule: ${path.basename(filePath, '.md')} (User .claude/rules)`,
            content,
            filePath,
          });
        }
      }
    } catch {
      // ignore filesystem rule scan errors
    }
  }

  // 4. Progressive Subdirectory Hints (Hermes P1)
  // These are appended dynamically during tool calls by agent-loop, but we also
  // inject them here so the agent sees any previously discovered hints in the
  // system prompt when it resumes.
  if (options.workingDirectory) {
    try {
      const { SubdirectoryHintTracker } = require('./subdirectory-hint-tracker');
      const tracker = (globalThis as any).__subdirTracker as import('./subdirectory-hint-tracker').SubdirectoryHintTracker;
      if (tracker) {
        const hints = tracker.dumpKnownHints();
        if (hints) {
          sources.push({
            level: 'workspace',
            filename: 'Subdirectory Hints (Auto-discovered)',
            content: hints,
          });
        }
      }
    } catch (e) {
      // Ignore errors if tracker not yet loaded
    }
  }

  if (sources.length === 0) return null;

  // Format with level tags
  return {
    content: sources
      .map(s => `## ${s.filename} [${s.level}]\n\n${s.content}`)
      .join('\n\n'),
    files: sources.map(s => s.filePath || s.filename),
    sources,
  };
}

function addSource(
  sources: InstructionSource[],
  seen: Set<string>,
  filePath: string,
  level: InstructionLevel,
  label: string,
): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  const content = tryReadFile(filePath);
  if (content) {
    sources.push({ level, filename: label, content, filePath: resolved });
  }
}

// ── Git context ────────────────────────────────────────────────

let _gitContextCache: { cwd: string; result: string | null; ts: number } | null = null;
const GIT_CACHE_TTL = 30_000; // 30s

function getGitContext(cwd: string): string | null {
  if (_gitContextCache && _gitContextCache.cwd === cwd && Date.now() - _gitContextCache.ts < GIT_CACHE_TTL) {
    return _gitContextCache.result;
  }

  try {
    const run = (cmd: string) => execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();

    const branch = run('git rev-parse --abbrev-ref HEAD 2>/dev/null');
    if (!branch) { _gitContextCache = { cwd, result: null, ts: Date.now() }; return null; }

    const user = run('git config user.name 2>/dev/null') || 'unknown';
    const status = run('git status --short 2>/dev/null').slice(0, 500);
    const recentCommits = run('git log --oneline -5 2>/dev/null');

    const parts = ['Git context:', `  Branch: ${branch}`, `  User: ${user}`];
    if (status) parts.push(`\n  Status:\n${status.split('\n').map((l: string) => '    ' + l).join('\n')}`);
    if (recentCommits) parts.push(`\n  Recent commits:\n${recentCommits.split('\n').map((l: string) => '    ' + l).join('\n')}`);

    const result = parts.join('\n');
    _gitContextCache = { cwd, result, ts: Date.now() };
    return result;
  } catch {
    _gitContextCache = { cwd, result: null, ts: Date.now() };
    return null;
  }
}

function tryReadFile(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return null;
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}
