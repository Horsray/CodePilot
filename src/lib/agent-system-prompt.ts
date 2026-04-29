/**
 * agent-system-prompt.ts — System prompt assembly for the native Agent Loop.
 *
 * Architecture modeled after Claude Code's prompts.ts + OpenCode's system.ts:
 * - Modular sections (identity, tasks, actions, tools, tone, output)
 * - Rich environment context (platform, shell, git, model)
 * - CLAUDE.md / AGENTS.md auto-discovery with priority hierarchy
 * - Additional context snippets (MCP server prompts, builtin-tools prompts)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import type { PromptInstructionCategory, PromptInstructionLevel, PromptInstructionSourceMeta } from '@/types';
import { getDb, getAllCustomRules } from './db';
import { discoverSkills } from './skill-discovery';

// ── Section: Identity ──────────────────────────────────────────

function getIdentitySection(model?: string) {
  return `# Identity

- You are HueyingAgent (绘影智能体), a powerful multifunctional AI agent.
- You are powered by ${model || 'a powerful large language model'}.
- You are running in a specialized desktop environment with full access to local files and tools.

# Core Capabilities

- **Code Engineering**: Expert in writing, debugging, refactoring, and explaining code across multiple programming languages and frameworks.
- **Intelligent Customer Service**: Provides professional, accurate, and empathetic responses to user inquiries.
- **Desktop Automation**: Takes over desktop tasks to save human time and effort.
- **Automated Task Execution**: Performs repetitive or complex tasks efficiently and reliably.
- **Scheduled Tasks**: Manages and executes time-based operations and reminders.
- **Information Research**: Searches, collects, analyzes, and summarizes information from various sources.
- **Content Creation**: Writes articles, documents, reports, and other forms of content.
- **Image Generation**: Creates images, diagrams, and visual content based on descriptions.`;
}

// ── Section: Doing Tasks ───────────────────────────────────────

function getDoingTasksSection() {
  return `# Doing tasks

- The user may request you to perform various tasks, including software engineering, customer service, desktop automation, content creation, image generation, information research, and more. Adapt your approach to the specific type of task at hand.
- You are an expert orchestrator. You don't just "do" tasks; you engineer solutions. This means you must understand the "why" before the "how".
- In general, do not propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first. Understand existing code before suggesting modifications.
- Do not create files unless they're absolutely necessary for achieving your goal. Generally prefer editing an existing file to creating a new one.
- Avoid giving time estimates or predictions. Focus on what needs to be done.
- If an approach fails, diagnose why before switching tactics—read the error, check your assumptions, try a focused fix. Don't retry the identical action blindly.

# Task Orchestration and Planning

- **Plan First**: For any task that requires modifying code, executing commands, or takes multiple steps, you MUST formulate a plan using the \`TodoWrite\` (or \`mcp__codepilot-todo__TodoWrite\`) tool before execution.
- **TodoWrite First for Complex Work**: For ANY user request that requires modifying code or executing commands, the task list tool MUST be your very first tool call. Do not call Read, Grep, Edit, or Bash until a task list has been created.
- **STRICT PROHIBITION**: NEVER output step-by-step plans, checklists, or numbered task lists in plain Markdown text. If you need to present a plan or break down a task, you MUST exclusively use the \`TodoWrite\` (or \`mcp__codepilot-todo__TodoWrite\`) tool.
- **Visible Task Decomposition**: Decompose broad requests into clear units (e.g. investigate, implement, verify). Keep task titles actionable.
- **Chain of Thought (CoT)**: Before every tool call, briefly state your reasoning in your thought process. Why this tool? Why this input? What do you expect to see?
- **Verification**: Every task is incomplete until verified. Always run tests, check the output, or use the \`Read\` tool to confirm your changes took effect as expected.`;
}

/**
 * MANAGING_TASKS_SECTION: 任务管理相关系统提示词段落。
 * 指导大语言模型如何规划任务以及通过任务列表工具展示执行进度。
 */
const MANAGING_TASKS_SECTION = `# Managing tasks

- Use the \`TodoWrite\` (or \`mcp__codepilot-todo__TodoWrite\`) tool to create and manage a structured task list for your current session. This helps the user track progress and understand your plan for complex tasks.
- You MUST use this tool proactively in these scenarios:
  - When starting ANY task that requires modifying code or executing commands.
  - When starting a task that requires 3 or more distinct steps.
  - When the user provides a list of multiple requirements to be addressed.
- **CRITICAL**: If a task requires a plan, you MUST NOT start tool work (Read, Grep, Edit, etc.) until the task list exists.
- Update the status of tasks in real-time as you complete them (pending -> in_progress -> completed).
- Keep exactly one task in_progress while work is active. Mark tasks completed as soon as evidence exists.
- Use clear, actionable descriptions for each task.`;

const REASONING_SECTION = `# Reasoning and Reflection

- **Self-Correction**: If you find yourself repeating the same search or getting the same error 2-3 times, STOP. Reflect on why the current path is failing and propose an alternative strategy.
- **Evidence-Based Decisions**: Base your actions on evidence found in the codebase, not assumptions. If you're unsure about a library's usage, search for existing patterns first.
- **Incremental Progress**: Prefer small, verified steps over one massive, unverified change. This reduces the blast radius of errors.`;

// ── Section: Executing Actions ─────────────────────────────────

const ACTIONS_SECTION = `# Executing actions with care

Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems beyond your local environment, or could otherwise be risky or destructive, check with the user before proceeding. The cost of pausing to confirm is low, while the cost of an unwanted action (lost work, unintended messages sent, deleted branches) can be very high.

Examples of the kind of risky actions that warrant user confirmation:
- Destructive operations: deleting files/branches, dropping database tables, killing processes, rm -rf, overwriting uncommitted changes
- Hard-to-reverse operations: force-pushing, git reset --hard, amending published commits, removing or downgrading packages/dependencies, modifying CI/CD pipelines
- Actions visible to others or that affect shared state: pushing code, creating/closing/commenting on PRs or issues, sending messages, posting to external services

When you encounter an obstacle, do not use destructive actions as a shortcut to simply make it go away. Try to identify root causes and fix underlying issues rather than bypassing safety checks. If you discover unexpected state like unfamiliar files, branches, or configuration, investigate before deleting or overwriting, as it may represent the user's in-progress work.`;

// ── Section: Using Your Tools ──────────────────────────────────

function getToolsSection(omcPluginEnabled = false): string {
  const omcSkillInterop = omcPluginEnabled
    ? '\n- **OMC Skill Interop**: When OMC hooks are active, prefer their workflow routing first. You may still receive lightweight local skill visibility hints below; use them to confirm what is available, and if no specific workflow has already been steered in, call the `Skill` tool without arguments once early to inspect matching workflows instead of manually re-deriving them.'
    : '';
  return `# Using your tools

- **Runtime Focus (IMPORTANT)**: Analyze behavior from the runtime that is actually serving the current conversation. Avoid broad comparisons against alternate runtimes or fallback paths unless the user explicitly asks for a comparison or the active path clearly fails.
- **Agent Delegation**: If the runtime exposes an \`Agent\` tool or OMC-installed agents, delegate specialized sub-tasks when that materially improves the outcome. Prefer the runtime's own agent catalog and orchestration rules over any hardcoded CodePilot conventions.
- **Skill Execution (IMPORTANT)**: You have access to the \`Skill\` tool which discovers and executes reusable prompt templates (skills). Skills are pre-defined workflows stored as SKILL.md files. You MUST proactively use this tool when:
  - The user's request matches a known skill's description or "whenToUse" criteria.
  - The user explicitly mentions using a skill (e.g., "use the X skill", or sends a message like "Use the X skill. User context: ...").
  - A complex task could benefit from a structured workflow that a skill provides.
  To use: call \`Skill\` with \`name\` or \`skill_name\` to execute a specific skill. Call without arguments to list all available skills and discover what's available. **Always check available skills before starting complex multi-step tasks** — a skill may already encode the exact workflow needed.
- **Skill Creation**: You have access to the \`codepilot_skill_create\` tool which saves a reusable workflow as a new Skill (SKILL.md). When you complete a complex multi-step task that could be reused, consider saving it as a skill for future one-click replay.
- **External Research (IMPORTANT)**: When the task depends on current documentation, recent product behavior, third-party APIs, package changes, version or compatibility details, upstream implementations, or any information not reliably present in the local repo, proactively use \`WebSearch\` first and then \`WebFetch\` for the most relevant sources before guessing, even if the user did not explicitly ask you to "search the web".
- **Use Session Search Proactively**: When the user asks about prior discussion, earlier decisions, previous fixes, or "what did we do before?", prefer the \`codepilot_session_search\` tool before guessing from memory.
- Do NOT use the Bash tool to run commands when a relevant dedicated tool is provided.
  - To read files use Read instead of cat, head, tail, or sed
  - To edit files use Edit instead of sed or awk
  - To create files use Write instead of cat with heredoc or echo redirection
  - To search for files use Glob instead of find or ls
  - To search the content of files, use Grep instead of grep or rg
  - To search local chat history, use codepilot_session_search instead of guessing what happened in earlier sessions
- Reserve using the Bash exclusively for system commands and terminal operations.
- Maximize efficiency by calling independent tools in parallel. Use sequential calls only when there is a strict data dependency.${omcSkillInterop}`;
}

// ── Section: Tone and Style ────────────────────────────────────

const TONE_SECTION = `# Tone and style

- Be professional, technical, and objective. You are a senior software engineer.
- Only use emojis if the user explicitly requests it.
- Your responses should be short and concise.
- When referencing code, use the pattern [basename](file:///absolute/path/to/file#Lstart-Lend) to create clickable links.
- Avoid conversational filler ("Okay", "I see", "Now I will"). Just perform the action.`;

// ── Section: Output Efficiency ─────────────────────────────────

const OUTPUT_SECTION = `# Output efficiency

- **Action-Oriented**: Lead with the answer, action, or tool call.
- **Thought Process**: Your thinking (internal thoughts) should be deep and analytical, but your text response to the user should be extremely concise.
- **Milestones**: Only provide text updates at major plan milestones (e.g., "Architecture research complete. Starting implementation.").
- **Final Answer Hygiene**: Never output raw tool calls, tool results, SSE events, transport frames, JSON content blocks, or internal control data as your final answer. Final answers must be plain user-facing prose plus concise bullets when useful.
- **Skip Filler**: Do not restate the user's request. Do not provide a preamble before tool calls.
- **Important Limitation**: 无论你调用了多少次工具，以及工具返回了什么结果，**你都不应该把工具执行的细节（比如具体的命令内容、查找到的文件列表、读取的代码片段等）重复地写在你返回给用户的最终回复文本里！** 用户已经在界面上能看到这些工具执行的过程卡片了。你的最终回复只需要**分点总结结论**，告诉用户你做了什么、达到了什么效果、或者有哪些注意事项。
- 思考过程（Thinking）也应该放在最终回复之前。最后的结论里，不应该包含 "我通过执行某某命令发现了..." 或 "文件包含以下内容：..." 这种流水账式的思考记录。`;

const GLOBAL_PRINCIPLES_SECTION = `# Global Agent Principles

1. **Evidence over Assumption**: Never assume a file exists or a function works. Search first.
2. **Persistence with Purpose**: If a tool fails, analyze the error. Don't just try again.
3. **Clean Context**: Keep your context focused. If you've gathered enough info from search, synthesize it and move to implementation.
4. **User Trust**: Your planning and todo list are how the user trusts you. Keep them accurate.`;

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
}

export interface SystemPromptResult {
  prompt: string;
  referencedFiles: string[];
  instructionSources: PromptInstructionSourceMeta[];
}

/**
 * Build the complete system prompt for the native Agent Loop.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): SystemPromptResult {
  const { modelId } = options;
  const parts: string[] = [
    getIdentitySection(modelId),
    getDoingTasksSection(),
    MANAGING_TASKS_SECTION,
    REASONING_SECTION,
    ACTIONS_SECTION,
    getToolsSection(options.omcPluginEnabled === true),
    TONE_SECTION,
    OUTPUT_SECTION,
    GLOBAL_PRINCIPLES_SECTION,
  ].filter(Boolean);

  const referencedFiles: string[] = [];
  let injectedInstructionSources: PromptInstructionSourceMeta[] = [];

  // Environment section (platform, shell, working directory, git)
  const envSection = buildEnvironmentSection(options);
  if (envSection) {
    parts.push(envSection);
  }

  // Project instructions (CLAUDE.md, AGENTS.md, skills)
  if (options.workingDirectory) {
    const projectInstructions = discoverProjectInstructions(options.workingDirectory, options);
    if (projectInstructions) {
      parts.push(`# Project Instructions\n\nCodebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n${projectInstructions.content}`);
      referencedFiles.push(...projectInstructions.files);
      injectedInstructionSources = projectInstructions.instructionSources;
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
    instructionSources: injectedInstructionSources,
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

interface InstructionSource {
  level: PromptInstructionLevel;
  category: PromptInstructionCategory;
  filename: string;
  content: string;
  filePath?: string;
}

const PROJECT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/settings.md', '.claude/CLAUDE.md', '.trae/rules/rules.md'];
const MAX_FILE_SIZE = 50 * 1024; // 50KB per file
const GLOBAL_RULE_FILE_LIMIT = 24;

function shouldPrioritizeFilemap(userPrompt?: string): boolean {
  if (!userPrompt) return false;
  return /代码|文件|组件|页面|路由|api|在哪|哪里|定位|查找|搜索|检索|修改|改动|实现|结构|架构|filemap|grep|glob|search/i.test(userPrompt);
}

// 中文注释：功能名称「规则路径规范化匹配」，用法是把 session/worktree/子目录/软链接
// 路径统一成可比较的绝对路径，避免项目规则只因路径字符串不同而失效。
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

// 中文注释：功能名称「项目规则命中判断」，用法是当当前工作目录与目标项目根相同
// 或位于其子目录时都视为命中，使 FILEMAP/项目规则在子目录与 worktree 场景下更稳定。
export function matchesProjectRulePaths(currentPath: string, ruleTargets: string[]): boolean {
  if (!currentPath || !Array.isArray(ruleTargets) || ruleTargets.length === 0) return false;
  const normalizedCurrent = normalizeInstructionPathForMatch(currentPath);
  return ruleTargets.some((targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    const normalizedTarget = normalizeInstructionPathForMatch(targetPath);
    return isSameOrDescendantPath(normalizedCurrent, normalizedTarget);
  });
}

// 中文注释：功能名称「规则搜索根目录发现」，用法是统一为任意项目生成一组候选规则根目录，
// 让 CLAUDE.md、AGENTS.md、.trae/rules/rules.md、FILEMAP.md 不依赖当前恰好停在项目根目录。
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
    // 非 git 仓库时忽略
  }

  const parent = path.dirname(cwd);
  if (parent !== cwd) addRoot(parent);

  return roots;
}

interface ExternalInstructionCandidate {
  filePath: string;
  label: string;
  level: PromptInstructionLevel;
  category: PromptInstructionCategory;
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
        continue;
      }

      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
  };

  visit(rootDir);
  return results;
}

// 中文注释：功能名称「项目外规则候选发现」，用法是统一发现用户级与全局级规则来源，
// 让 ~/.claude、~/.trae 以及 ~/.codepilot/rules 下的规则文件都能参与系统提示注入。
export function getExternalInstructionCandidates(homeDir = os.homedir()): ExternalInstructionCandidate[] {
  const candidates: ExternalInstructionCandidate[] = [];
  const pushIfExists = (
    filePath: string,
    label: string,
    level: PromptInstructionLevel,
    category: PromptInstructionCategory,
  ) => {
    if (!fs.existsSync(filePath)) return;
    candidates.push({ filePath, label, level, category });
  };

  pushIfExists(path.join(homeDir, '.claude', 'CLAUDE.md'), 'CLAUDE.md (user)', 'user', 'repo_instruction');
  pushIfExists(path.join(homeDir, '.claude', 'CLAUDE.local.md'), 'CLAUDE.local.md (user)', 'user', 'hard_rule');
  pushIfExists(path.join(homeDir, '.trae', 'rules', 'rules.md'), 'Trae Rules (user)', 'global', 'hard_rule');

  const codepilotRulesDir = path.join(homeDir, '.codepilot', 'rules');
  if (fs.existsSync(codepilotRulesDir)) {
    for (const filePath of walkMarkdownFiles(codepilotRulesDir, GLOBAL_RULE_FILE_LIMIT)) {
      const relative = path.relative(codepilotRulesDir, filePath) || path.basename(filePath);
      candidates.push({
        filePath,
        label: `CodePilot Rule (${relative})`,
        level: 'global',
        category: 'hard_rule',
      });
    }
  }

  return candidates;
}

function truncateInstructionLine(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function extractSkillMatchTokens(userPrompt?: string): string[] {
  if (!userPrompt) return [];
  const rawTokens = userPrompt.match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9_-]{2,}/gi) || [];
  const stopWords = new Set([
    '这个', '那个', '现在', '然后', '继续', '需要', '不要', '直接', '帮我', '请帮我', '我们', '你们',
    'because', 'about', 'with', 'from', 'that', 'this', 'into', 'then', 'please', 'help',
  ]);
  return Array.from(
    new Set(
      rawTokens
        .map((token) => token.toLowerCase())
        .filter((token) => token.length >= 2 && !stopWords.has(token)),
    ),
  ).slice(0, 24);
}

function expandSkillMatchTokens(tokens: string[]): string[] {
  const aliasMap: Record<string, string[]> = {
    '代码审查': ['code review', 'review', 'regression'],
    '审查': ['review'],
    '性能瓶颈': ['performance', 'bottleneck'],
    '性能': ['performance'],
    '瓶颈': ['bottleneck'],
    '排查': ['debug', 'investigate', 'diagnosis'],
    '定位': ['locate', 'diagnose', 'investigate'],
    '文档': ['docs', 'documentation'],
    '官方文档': ['official docs', 'documentation'],
    '架构': ['architecture', 'design'],
    '兼容性': ['compatibility'],
    '上游实现': ['upstream', 'implementation'],
    review: ['审查', '代码审查'],
    performance: ['性能', '性能瓶颈'],
    bottleneck: ['瓶颈', '性能瓶颈'],
    debug: ['排查', '定位'],
    docs: ['文档', '官方文档'],
    documentation: ['文档', '官方文档'],
    architecture: ['架构'],
    compatibility: ['兼容性'],
  };

  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const alias of aliasMap[token] || []) {
      expanded.add(alias.toLowerCase());
    }
  }
  return Array.from(expanded);
}

function scoreSkillForPrompt(skill: ReturnType<typeof discoverSkills>[number], userPrompt?: string): number {
  const tokens = expandSkillMatchTokens(extractSkillMatchTokens(userPrompt));
  if (tokens.length === 0) return 0;
  const haystack = [
    skill.name,
    skill.description,
    skill.whenToUse,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    score += 1;
    if (skill.name.toLowerCase().includes(token)) score += 3;
    if ((skill.whenToUse || '').toLowerCase().includes(token)) score += 2;
    if ((skill.description || '').toLowerCase().includes(token)) score += 1;
  }

  return score;
}

// 中文注释：功能名称「相关技能提示」，用法是根据当前用户请求内容，从已发现技能里
// 挑出最相关的前几个候选，先给模型一个短列表，帮助它在复杂任务开头更自然地命中 Skill，
// 而不是只看到一整份按文件顺序排列的目录。
function buildRelevantSkillHints(cwd: string, userPrompt?: string, maxSkills = 3): string | null {
  if (!userPrompt) return null;
  const scored = discoverSkills(cwd)
    .map((skill) => ({ skill, score: scoreSkillForPrompt(skill, userPrompt) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, maxSkills);

  if (scored.length === 0) return null;

  const lines = [
    '## Relevant Skill Hints',
    'The following skills look relevant to the current request. Prefer checking them early with the `Skill` tool before re-deriving the workflow manually.',
  ];

  for (const { skill } of scored) {
    const description = truncateInstructionLine(skill.description, 120) || 'No description provided';
    const whenToUse = truncateInstructionLine(skill.whenToUse, 160);
    const kind = skill.userInvocable ? 'slash+skill' : 'skill';
    lines.push(`- ${skill.name} [${kind}, ${skill.context}] — ${description}`);
    if (whenToUse) lines.push(`  when: ${whenToUse}`);
  }

  return lines.join('\n');
}

// 中文注释：功能名称「技能目录摘要」，用法是向系统提示注入可用技能的轻量目录，
// 让模型先知道有哪些技能，再通过 Skill 工具按需展开执行，避免每轮塞入整篇 SKILL.md。
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
      ? 'The following reusable skills are available via the `Skill` tool. This is a lightweight visibility index for local skills; keep OMC routing in charge when it already steers a workflow.'
      : 'The following reusable skills are available via the `Skill` tool. Prefer invoking `Skill` for matching workflows instead of re-deriving the workflow manually.',
  ];

  for (const skill of skills.slice(0, maxSkills)) {
    const description = truncateInstructionLine(skill.description, 120) || 'No description provided';
    const whenToUse = truncateInstructionLine(skill.whenToUse, 160);
    const kind = skill.userInvocable ? 'slash+skill' : 'skill';
    lines.push(`- ${skill.name} [${kind}, ${skill.context}] — ${description}`);
    if (whenToUse) lines.push(`  when: ${whenToUse}`);
    // 中文注释：功能名称「轻量技能可见性提示」，用法是在 OMC 开启时只保留
    // 技能名、描述和使用时机，不再附带 source 等额外细节，避免完全失明，
    // 同时减少与 OMC hook routing 的重复 steering。
    if (!lightweight) {
      const source = truncateInstructionLine(path.relative(cwd, skill.filePath) || skill.filePath, 120);
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
function discoverProjectInstructions(cwd: string, options: SystemPromptOptions = {}): { content: string, files: string[], instructionSources: PromptInstructionSourceMeta[] } | null {
  const sources: InstructionSource[] = [];
  const seen = new Set<string>(); // dedup by resolved path
  const instructionRoots = getInstructionSearchRoots(cwd);

  // 1. Custom Database Rules (Personal & Project)
  try {
    const customRules = getAllCustomRules().filter(r => r.enabled);
    
    // Personal rules (apply to all)
    const personalRules = customRules.filter(r => r.type === 'personal');
    for (const rule of personalRules) {
      sources.push({
        filename: `Rule: ${rule.name} (Global)`,
        content: rule.content,
        level: 'global',
        category: 'hard_rule',
      });
    }

    // Project rules (apply if matched)
    const db = getDb();
    const session = options.sessionId
      ? db.prepare('SELECT working_directory FROM chat_sessions WHERE id = ?').get(options.sessionId) as any
      : null;
    const currentPath = options.workingDirectory || session?.working_directory;
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
          level: 'project',
          category: 'hard_rule',
        });
      }
    }
  } catch (err) {
    console.error('[agent-system-prompt] Failed to load custom rules from DB:', err);
  }

  // 2. User/global-level external instructions
  // 中文注释：功能名称「项目外规则源注入」，用法是统一把用户级 CLAUDE、Trae 规则、
  // 以及 ~/.codepilot/rules 下的全局规则纳入发现链路，避免只有项目内规则能生效。
  for (const candidate of getExternalInstructionCandidates()) {
    const isClaudeCandidate = candidate.label.includes('CLAUDE.md');
    if (isClaudeCandidate && options.includeClaudeMd === false) continue;
    addSource(sources, seen, candidate.filePath, candidate.level, candidate.category, candidate.label);
  }

  // 2.5. 项目索引文件优先注入：当任务像代码定位/检索/改动时，优先把 FILEMAP.md
  // 放进系统上下文，让模型先利用项目索引，再决定是否继续 Grep/Glob。
  if (shouldPrioritizeFilemap(options.userPrompt)) {
    for (const root of instructionRoots) {
      const filemapPath = path.join(root, 'FILEMAP.md');
      if (fs.existsSync(filemapPath)) {
        const label = root === normalizeInstructionPathForMatch(cwd) ? 'FILEMAP.md' : `FILEMAP.md (${path.relative(cwd, root) || '.'})`;
        addSource(sources, seen, filemapPath, root === normalizeInstructionPathForMatch(cwd) ? 'project' : 'workspace', 'index_doc', label);
        break;
      }
    }
  }

  // 3. Project-level (working directory)
  for (const root of instructionRoots) {
    const rootLevel: PromptInstructionLevel = root === normalizeInstructionPathForMatch(cwd)
      ? 'project'
      : root === instructionRoots[instructionRoots.length - 1]
        ? 'parent'
        : 'workspace';

    for (const filename of PROJECT_FILES) {
      const isClaude = filename.includes('CLAUDE.md') || filename === 'CLAUDE.local.md';
      const isAgents = filename.includes('AGENTS.md');
      const isTraeRules = filename === '.trae/rules/rules.md';

      if (isClaude && options.includeClaudeMd === false) continue;
      if (isAgents && options.includeAgentsMd === false) continue;
      if (isTraeRules && options.syncProjectRules === false) continue;

      const label = root === normalizeInstructionPathForMatch(cwd)
        ? filename
        : `${filename} (${path.relative(cwd, root) || '.'})`;

      addSource(sources, seen, path.join(root, filename), rootLevel, 'repo_instruction', label);
    }
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
            category: 'workspace_hint',
            filename: 'Subdirectory Hints (Auto-discovered)',
            content: hints,
          });
        }
      }
    } catch (e) {
      // Ignore errors if tracker not yet loaded
    }
  }

  // 4. Discovered Skills Catalog (project/user/global)
  if (options.enableAgentsSkills !== false) {
    try {
      const relevantSkillHints = buildRelevantSkillHints(cwd, options.userPrompt);
      if (relevantSkillHints) {
        sources.push({
          level: 'project',
          category: 'skill_catalog',
          filename: 'Relevant Skill Hints',
          content: relevantSkillHints,
        });
      }
      // 中文注释：功能名称「OMC 技能提示降阶」，用法是在 OMC 启用时不再整包移除
      // 本地技能目录，而是切换成更轻量的可见性索引，让模型至少知道“本地有哪些技能”，
      // 但把具体 workflow routing 继续优先交给 OMC。
      const catalog = buildDiscoveredSkillsCatalog(
        cwd,
        options.omcPluginEnabled === true ? 8 : 24,
        { lightweight: options.omcPluginEnabled === true },
      );
      if (catalog) {
        sources.push({
          level: 'project',
          category: 'skill_catalog',
          filename: options.omcPluginEnabled === true ? 'Lightweight Skills Visibility' : 'Discovered Skills Catalog',
          content: catalog,
        });
      }
    } catch { /* ignore skill discovery errors */ }
  }

  if (sources.length === 0) return null;

  const categoryOrder: PromptInstructionCategory[] = ['hard_rule', 'repo_instruction', 'index_doc', 'skill_catalog', 'workspace_hint'];

  const orderedSources = sources
    .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));

  return {
    content: orderedSources
      .map(s => `## ${s.filename} [${s.level}]\n\n${s.content}`)
      .join('\n\n'),
    files: orderedSources.map(s => s.filePath || s.filename),
    instructionSources: orderedSources.map((source) => ({
      filename: source.filename,
      level: source.level,
      category: source.category,
      ...(source.filePath ? { filePath: source.filePath } : {}),
    })),
  };
}

function addSource(
  sources: InstructionSource[],
  seen: Set<string>,
  filePath: string,
  level: PromptInstructionLevel,
  category: PromptInstructionCategory,
  label: string,
): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  const content = tryReadFile(filePath);
  if (content) {
    sources.push({ level, category, filename: label, content, filePath: resolved });
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
