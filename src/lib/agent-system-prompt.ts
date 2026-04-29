/**
 * agent-system-prompt.ts — Host supplement prompt builder.
 *
 * 中文注释：功能名称「宿主补充提示词」，用法是在 Claude Code CLI 主链路里只补充
 * CodePilot 宿主环境的事实信息，不再承担 agent、skill、联网、规划等行为编排职责。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import type { PromptInstructionSourceMeta } from '@/types';
import { getDb, getAllCustomRules } from './db';
import { discoverSkills } from './skill-discovery';

// ── Section: Host Supplement ───────────────────────────────────

function getHostSupplementSection(model?: string): string {
  return `# CodePilot Host Supplement

- You are running inside the CodePilot desktop host on top of Claude Code.
- Model: ${model || 'current Claude Code model'}.
- Treat Claude Code native behavior, project/user \`CLAUDE.md\`, plugins, hooks, skills, and built-in agent orchestration as the primary decision layer.
- Use this host supplement only for CodePilot-specific capabilities such as UI widgets, dashboard integration, media helpers, notifications, and host-provided MCP servers.
- Do not restate raw tool traces, transport frames, or internal control payloads in user-facing answers.`;
}

// ── Section: Output Hygiene ────────────────────────────────────

const OUTPUT_HYGIENE_SECTION = `# Output Hygiene

- Keep user-facing answers concise and action-oriented.
- Prefer factual conclusions over verbose execution logs.
- When referencing code, use clickable file links when available.`;

// ── Assembly ───────────────────────────────────────────────────

export interface SystemPromptOptions {
  sessionId?: string;
  workingDirectory?: string;
  userPrompt?: string;
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
 * Build the host supplement prompt.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): SystemPromptResult {
  const { modelId } = options;
  const parts: string[] = [
    getHostSupplementSection(modelId),
    OUTPUT_HYGIENE_SECTION,
  ].filter(Boolean);

  const referencedFiles: string[] = [];

  // Environment section (platform, shell, working directory, git)
  const envSection = buildEnvironmentSection(options);
  if (envSection) {
    parts.push(envSection);
  }

  // 注意：当前处于过渡状态。
  // 此处的 discoverProjectInstructions() 手工拼接路径仍然保留，
  // 但 warmup 和 chat 路由均已显式传入 includeDiscoveredProjectInstructions: false，
  // 实际运行时此分支不会执行。
  // 目标状态：当 Claude Code/OMC 能原生发现 `CLAUDE.md`、`AGENTS.md`、`.trae/rules` 后，
  // 可移除此手工拼接逻辑，避免重复注入干扰决策。
  if (options.workingDirectory && options.includeDiscoveredProjectInstructions !== false) {
    const projectInstructions = discoverProjectInstructions(options.workingDirectory, options);
    if (projectInstructions) {
      parts.push(`# Project Instructions\n\nCodebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n${projectInstructions.content}`);
      referencedFiles.push(...projectInstructions.files);
    }
  }

  // Knowledge Base instructions (graphify)
  if (options.workingDirectory && options.knowledgeBaseEnabled !== false) {
    const kbInstructions = discoverKnowledgeBaseInstructions(options.workingDirectory);
    if (kbInstructions) {
      parts.push(`# Knowledge Base (Atomic Knowledge Graph)\n\nA Knowledge Graph built via 'graphify' exists for this workspace. Use it to understand architecture, god nodes, and community structures before searching raw files. This will significantly reduce token usage and improve accuracy.\n\n${kbInstructions.content}`);
      referencedFiles.push(...kbInstructions.files);
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

  // User-provided system prompt
  if (options.userPrompt) {
    parts.push(`# User Instructions\n\n${options.userPrompt}`);
  }

  return {
    prompt: parts.join('\n\n'),
    referencedFiles,
    instructionSources: [],
  };
}

// ── Environment Section ────────────────────────────────────────

function buildEnvironmentSection(options: SystemPromptOptions): string | null {
  const lines: string[] = ['# Environment'];

  if (options.workingDirectory) {
    lines.push(`- Primary working directory: ${options.workingDirectory}`);

    // Check if git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: options.workingDirectory, encoding: 'utf-8', timeout: 3000, stdio: 'pipe',
      });
      lines.push('  - Is a git repository: true');
    } catch {
      lines.push('  - Is a git repository: false');
    }
  }

  // Platform info
  lines.push(`- Platform: ${process.platform}`);
  const shell = process.env.SHELL ? path.basename(process.env.SHELL) : 'unknown';
  lines.push(`- Shell: ${shell}`);

  try {
    const osVersion = execSync('uname -sr', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim();
    lines.push(`- OS Version: ${osVersion}`);
  } catch { /* ignore */ }

  // Model info
  if (options.modelId) {
    lines.push(`- Model: ${options.modelId}`);
  }

  // Current date
  lines.push(`- Current date: ${new Date().toISOString().split('T')[0]}`);

  // Git context (branch, user, status, recent commits)
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

const PROJECT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/settings.md', '.claude/CLAUDE.md', '.trae/rules/rules.md'];
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

// 中文注释：功能名称「技能目录摘要」，用法是仅为测试和兼容导出保留轻量摘要生成能力；
// 当前主聊天链路不会自动把这份目录再注入系统提示。
export function buildDiscoveredSkillsCatalog(
  cwd: string,
  maxSkills = 24,
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
  for (const skill of skills.slice(0, maxSkills)) {
    const description = (skill.description || 'No description provided').slice(0, 120);
    const whenToUse = (skill.whenToUse || '').slice(0, 160);
    const kind = skill.userInvocable ? 'slash+skill' : 'skill';
    lines.push(`- ${skill.name} [${kind}, ${skill.context}] — ${description}`);
    if (whenToUse) lines.push(`  when: ${whenToUse}`);
    if (!lightweight) {
      const source = (path.relative(cwd, skill.filePath) || skill.filePath).slice(0, 120);
      if (source) lines.push(`  source: ${source}`);
    }
  }
  if (skills.length > maxSkills) {
    lines.push(`- ... ${skills.length - maxSkills} more skills available via the Skill tool`);
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
 * Discover project instructions with formal priority hierarchy.
 * Each source is tagged with its level for transparency.
 */
function discoverProjectInstructions(cwd: string, options: SystemPromptOptions = {}): { content: string, files: string[] } | null {
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
    if (options.sessionId) {
      // Find the project name/path for this session to match against project_ids
      const db = getDb();
      const session = db.prepare('SELECT working_directory FROM chat_sessions WHERE id = ?').get(options.sessionId) as any;
      if (session) {
        const currentPath = session.working_directory;
        const projectRules = customRules.filter(r => {
          if (r.type !== 'project') return false;
          try {
            const targetPaths = JSON.parse(r.project_ids);
            return Array.isArray(targetPaths) && targetPaths.includes(currentPath);
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
    }
  } catch (err) {
    console.error('[agent-system-prompt] Failed to load custom rules from DB:', err);
  }

  // 2. User-level (~/.claude/CLAUDE.md)
  // Always load CLAUDE.md — OMC instructions are critical for multi-agent
  // orchestration in both SDK and native runtime paths. The SDK runtime may
  // also load CLAUDE.md natively via settingSources, but duplication of
  // OMC instructions is harmless (it only reinforces the priority).
  if (options.includeClaudeMd !== false) {
    const userFile = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    addSource(sources, seen, userFile, 'user', 'CLAUDE.md (user)');
  }

  // 3. Project-level (working directory)
  for (const filename of PROJECT_FILES) {
    const isClaude = filename.includes('CLAUDE.md') || filename === 'CLAUDE.local.md';
    const isAgents = filename.includes('AGENTS.md');
    const isTraeRules = filename === '.trae/rules/rules.md';

    if (isClaude && options.includeClaudeMd === false) continue;
    if (isAgents && options.includeAgentsMd === false) continue;
    if (isTraeRules && options.syncProjectRules === false) continue;

    addSource(sources, seen, path.join(cwd, filename), 'project', filename);
  }

  // 3.5. Progressive Subdirectory Hints (Hermes P1)
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

  // 4. Parent directory (monorepo root)
  const parent = path.dirname(cwd);
  if (parent !== cwd) {
  if (options.includeClaudeMd !== false) {
      addSource(sources, seen, path.join(parent, 'CLAUDE.md'), 'parent', 'CLAUDE.md (parent)');
    }
    if (options.includeAgentsMd !== false) {
      addSource(sources, seen, path.join(parent, 'AGENTS.md'), 'parent', 'AGENTS.md (parent)');
    }
  }

  // 5. Custom Skills (.agents/skills/*.md)
  if (options.enableAgentsSkills !== false) {
    const skillsDir = path.join(cwd, '.agents', 'skills');
    try {
      if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
        const files = fs.readdirSync(skillsDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            addSource(sources, seen, path.join(skillsDir, file), 'project', `.agents/skills/${file}`);
          }
        }
      }
    } catch { /* ignore readdir/stat errors */ }
  }

  if (sources.length === 0) return null;

  // Format with level tags
  return {
    content: sources
      .map(s => `## ${s.filename} [${s.level}]\n\n${s.content}`)
      .join('\n\n'),
    files: sources.map(s => s.filePath || s.filename),
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
    if (status) parts.push(`\n  Status:\n${status.split('\n').map(l => '    ' + l).join('\n')}`);
    if (recentCommits) parts.push(`\n  Recent commits:\n${recentCommits.split('\n').map(l => '    ' + l).join('\n')}`);

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
