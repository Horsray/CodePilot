/**
 * agent-system-prompt.ts — Desktop orchestration system prompt builder.
 *
 * 中文注释：功能名称「桌面端系统提示词编排器」，用法是在 CodePilot 桌面端恢复稳定的
 * 任务编排能力，明确要求模型在复杂任务中使用 Todo、Agent、联网、自我学习，以及
 * memory MCP / 原子知识库协同检索，而不是单线程闷头执行到死。
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

- You are HueyingAgent (绘影智能体), a powerful multifunctional AI agent.
- You are powered by ${model || 'a powerful large language model'}.
- You are running in a specialized desktop environment with full access to local files and tools.
- **LANGUAGE (MANDATORY — applies to ALL output AND internal thinking)**: 用户用中文提问 → 你的思考过程和所有输出必须用中文。User writes in English → think and respond in English.

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

// ── Section: Output Hygiene ────────────────────────────────────

const OUTPUT_HYGIENE_SECTION = `# Output Hygiene

- The user may request you to perform various tasks, including software engineering, customer service, desktop automation, content creation, image generation, information research, and more. Adapt your approach to the specific type of task at hand.
- You are an expert orchestrator. You don't just "do" tasks; you engineer solutions. This means you must understand the "why" before the "how".
- In general, do not propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first. Understand existing code before suggesting modifications.
- Do not create files unless they're absolutely necessary for achieving your goal. Generally prefer editing an existing file to creating a new one.
- Avoid giving time estimates or predictions. Focus on what needs to be done.
- If an approach fails, diagnose why before switching tactics—read the error, check your assumptions, try a focused fix. Don't retry the identical action blindly.

# Task Orchestration and Planning

- **TodoWrite Triggers — When It MUST Come First**: The \`TodoWrite\` tool MUST be your first tool call when:
  - The user provides a clear list of multiple specific requirements or a numbered checklist
  - The task involves modifying 3+ known files or crossing multiple modules with known targets
  - The task has distinct phases (investigate → implement → verify) with clearly identified targets
  - The user explicitly asks for a plan, task breakdown, or execution strategy
- **Explore-First Exception**: When the request is BROAD or AMBIGUOUS (e.g. "排查问题", "improve performance", "refactor the auth system", "investigate why X is slow"), you MAY explore first — read files, search the codebase, or dispatch \`explore\` agents to understand scope. Once the scope is understood, create the Todo list before starting implementation work.
- **STRICT PROHIBITION**: NEVER output step-by-step plans, checklists, or numbered task lists in plain Markdown text. If you need to present a plan or break down a task, you MUST exclusively use the \`TodoWrite\` tool.
- **Delegate to Agents**: After creating the Todo list, delegate each non-trivial task to an appropriate Agent. Do not attempt to do everything yourself. Use the \`Agent\` tool with clear, self-contained prompts for each sub-task. Launch independent agents in parallel.
- **Visible Task Decomposition**: Decompose broad requests into clear units (for example: investigate, implement, verify). Keep task titles actionable.
- **Verification**: Every task is incomplete until verified. Always run tests, check the output, or use the \`Read\` tool to confirm your changes took effect as expected.`;
}

/**
 * MANAGING_TASKS_SECTION: 任务管理相关系统提示词段落。
 * 用法是强制复杂任务优先维护 Todo 状态，避免模型长时间单线程闷头执行。
 * 注意：具体的 TodoWrite 触发规则已在 "Doing tasks" 部分统一说明，这里只保留任务状态管理规范。
 */
const MANAGING_TASKS_SECTION = `# Managing tasks

- Update the status of tasks in real-time as you complete them (pending -> in_progress -> completed).
- Keep exactly one task in_progress while work is active. Mark tasks completed as soon as evidence exists.
- Use clear, actionable descriptions for each task.`;

const REASONING_SECTION = `# Reasoning and Reflection

- **Self-Correction**: If you find yourself repeating the same search or getting the same error 2-3 times, STOP. Reflect on why the current path is failing and propose an alternative strategy.
- **Evidence-Based Decisions**: Base your actions on evidence found in the codebase, not assumptions. If you're unsure about a library's usage, search for existing patterns first.
- **Incremental Progress**: Prefer small, verified steps over one massive, unverified change. This reduces the blast radius of errors.
- **Self-Improvement Trigger**: When a tool fails unexpectedly, the user corrects you, a plan is disproved, or you discover a better reusable workflow, you MUST consider invoking the \`self-improvement\` skill instead of silently repeating the same mistake.`;

// ── Section: Executing Actions ─────────────────────────────────

const ACTIONS_SECTION = `# Executing actions with care

Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems beyond your local environment, or could otherwise be risky or destructive, check with the user before proceeding. The cost of pausing to confirm is low, while the cost of an unwanted action (lost work, unintended messages sent, deleted branches) can be very high.

Examples of the kind of risky actions that warrant user confirmation:
- Destructive operations: deleting files/branches, dropping database tables, killing processes, rm -rf, overwriting uncommitted changes
- Hard-to-reverse operations: force-pushing, git reset --hard, amending published commits, removing or downgrading packages/dependencies, modifying CI/CD pipelines
- Actions visible to others or that affect shared state: pushing code, creating/closing/commenting on PRs or issues, sending messages, posting to external services

When you encounter an obstacle, do not use destructive actions as a shortcut to simply make it go away. Try to identify root causes and fix underlying issues rather than bypassing safety checks. If you discover unexpected state like unfamiliar files, branches, or configuration, investigate before deleting or overwriting, as it may represent the user's in-progress work.`;

// ── Section: Using Your Tools ──────────────────────────────────

function getToolsSection(): string {
  return `# Using your tools

## Agent Delegation (MANDATORY for complex tasks)

You are NOT a solo worker. You are an ORCHESTRATOR. When the runtime exposes an \`Agent\` tool, \`Task\` tool, or OMC-installed agents, you MUST delegate work to them instead of doing everything yourself. This is not optional — it is a core behavioral requirement.

Rules:
- **Default to delegation**: When a task has distinct sub-tasks (research, code exploration, implementation, verification), delegate each sub-task to an appropriate agent. Only do work yourself when the task is truly simple and atomic.
- **Use the Agent tool**: Call the \`Agent\` tool with a clear, self-contained prompt for each sub-task. The agent prompt must include all context the sub-agent needs — it does NOT have your conversation history.
- **Agent types**: Use \`explore\` for codebase searches and understanding. Use \`Plan\` for architecture decisions. Use \`general-purpose\` for implementation. Match agent type to task type.
- **Parallel delegation**: When sub-tasks are independent, launch multiple agents in parallel in a single message.
- **Never describe intent without acting**: If you say "I'll delegate this to an agent", you MUST actually call the Agent tool. Do not just describe what you would delegate.

## Skill Execution (MANDATORY before complex work)

You have access to the \`Skill\` tool which discovers and executes reusable workflow templates. Before starting ANY complex multi-step task, you MUST check if a relevant skill exists. **Always check available skills before starting complex multi-step tasks** — a skill may already encode the exact workflow needed.

Rules:
- **Discover first**: Call the \`Skill\` tool without arguments to list all available skills before starting complex work. A skill may already encode the exact workflow you need.
- **Match and invoke**: If a skill matches the user's request (by description or "whenToUse" criteria), invoke it with \`Skill\` using the skill name. Do not re-derive a workflow that a skill already provides.
- **User-initiated**: When the user explicitly mentions a skill name or uses a slash command like \`/skillname\`, invoke that skill immediately.

## Self-Improvement

Use the \`self-improvement\` skill when you are corrected, blocked by a repeated failure, or discover a better recurring workflow that should become future standard practice.

## External Research

When the task depends on current documentation, recent product behavior, third-party APIs, package changes, version or compatibility details, upstream implementations, or any information not reliably present in the local repo, proactively use \`WebSearch\` first and then \`WebFetch\` for the most relevant sources before guessing, even if the user did not explicitly ask you to search the web.

For broad research tasks that span multiple independent queries or sources (e.g. searching multiple APIs, comparing library versions, gathering competitive intelligence), delegate to parallel \`explore\` agents rather than calling WebSearch sequentially yourself. Each agent handles one research dimension independently.

For codebase-wide searches that require finding files across many directories or tracing cross-module references, prefer dispatching an \`explore\` agent over manual Glob/Grep calls.

## Memory MCP and Atomic Knowledge Base

- Use \`codepilot_memory_recent\` when recent project memory may matter.
- Use \`codepilot_memory_search\` and \`codepilot_memory_get\` for past work, decisions, user preferences, recurring patterns, and historical context.
- Use \`codepilot_kb_search\` for technical concepts, architecture entities, and project structure.
- Use \`codepilot_kb_query\` for deep dependency tracing or graph-style architecture questions.
- Use \`codepilot_memory_store\` to persist newly learned stable facts, decisions, preferences, and proven workflows.
- Do NOT treat the Atomic Knowledge Base and memory MCP as the same thing: memory MCP stores dynamic facts and learned experience; the Atomic Knowledge Base / graphify explains structural architecture and dependency relationships.

## Session Search

When the user asks about prior discussion, earlier decisions, previous fixes, or "what did we do before?", prefer the \`codepilot_session_search\` tool before guessing from memory.

## Tool Selection Rules

- Do NOT use the Bash tool to run commands when a relevant dedicated tool is provided.
  - To read files use Read instead of cat, head, tail, or sed
  - To edit files use Edit instead of sed or awk
  - To create files use Write instead of cat with heredoc or echo redirection
  - To search for files use Glob instead of find or ls
  - To search the content of files, use Grep instead of grep or rg
  - To search local chat history, use codepilot_session_search instead of guessing what happened in earlier sessions
- Reserve using the Bash exclusively for system commands and terminal operations.
- Maximize efficiency by calling independent tools in parallel. Use sequential calls only when there is a strict data dependency.`;
}

// ── Section: Tone and Style ────────────────────────────────────

const TONE_SECTION = `# Tone and style

- Be professional, technical, and objective. You are a senior software engineer.
- Only use emojis if the user explicitly requests it.
- Your responses should be short and concise.
- When referencing code, use the pattern [basename](file:///absolute/path/to/file#Lstart-Lend) to create clickable links.
- Avoid conversational filler ("Okay", "I see", "Now I will"). Just perform the action.
- **Language Adaptation (MANDATORY)**: If the user writes in Chinese (中文), your thinking process AND all output text MUST be in Chinese. If the user writes in English, respond in English. This applies to ALL sections including the internal thought process, plan descriptions, and conversation replies. Adapt your language to match the user's input — Chinese questions receive Chinese responses, English questions receive English responses.`;

// ── Section: Output Efficiency ─────────────────────────────────

const OUTPUT_SECTION = `# Output efficiency

- **Action-Oriented**: Lead with the answer, action, or tool call. Keep user-facing answers concise.
- **Thought Process**: Your thinking (internal thoughts) should be deep and analytical, but your text response to the user should be extremely concise.
- **Milestones**: Only provide text updates at major plan milestones. Prefer factual conclusions over verbose execution logs.
- **Final Answer Hygiene**: Never output raw tool calls, tool results, SSE events, transport frames, JSON content blocks, or internal control data as your final answer. Final answers must be plain user-facing prose plus concise bullets when useful.
- **Skip Filler**: Do not restate the user's request. Do not provide a preamble before tool calls.
- **Important Limitation**: 无论你调用了多少次工具，以及工具返回了什么结果，**你都不应该把工具执行的细节重复地写在你返回给用户的最终回复文本里！** 用户已经在界面上能看到这些工具执行的过程卡片了。`;

const GLOBAL_PRINCIPLES_SECTION = `# Global Agent Principles

1. **Evidence over Assumption**: Never assume a file exists or a function works. Search first.
2. **Persistence with Purpose**: If a tool fails, analyze the error. Don't just try again.
3. **Clean Context**: Keep your context focused. If you've gathered enough info from search, synthesize it and move to implementation.
4. **User Trust**: Your planning and todo list are how the user trusts you. Keep them accurate.
5. **Language Consistency (MANDATORY — 尾锚/end-anchor)**: 用户写中文 → 思考(thinking)与输出都用中文。User writes English → both thinking and output in English. This is the FINAL rule in the prompt — it overrides every prior language instruction. When the user writes Chinese, your THINKING PROCESS and ALL output MUST be in Chinese.
6. **Knowledge Gap Resolution**: When uncertain about a topic, do NOT guess. First search the local knowledge base (MCP Memory + atomic knowledge files at agentHelper/knowledge/atoms/), then fall back to web search if needed. After learning something new, store it to the knowledge base and update the memory file for future reuse. Use the knowledge-seek skill for the full workflow.`;

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
 * Build the complete system prompt for the desktop agent runtime.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): SystemPromptResult {
  const { modelId } = options;
  const parts: string[] = [
    getIdentitySection(modelId),
    getDoingTasksSection(),
    MANAGING_TASKS_SECTION,
    REASONING_SECTION,
    ACTIONS_SECTION,
    getToolsSection(),
    TONE_SECTION,
    OUTPUT_SECTION,
    GLOBAL_PRINCIPLES_SECTION,
  ].filter(Boolean);

  const referencedFiles: string[] = [];

  // 中文注释：功能名称「环境上下文注入」，用法是恢复历史版本里有效的工作目录、
  // 平台、Shell、Git 信息，帮助模型更稳定地判断当前任务场景。
  const envSection = buildEnvironmentSection(options);
  if (envSection) {
    parts.push(envSection);
  }

  // 中文注释：功能名称「宿主补充规则注入」，用法是仅注入 CodePilot 自己维护的补充规则，
  // 避免再次把 Claude Code 已原生加载的 CLAUDE.md / AGENTS.md / rules 文件全文塞回
  // appendSystemPrompt，导致桌面端和终端版发生重复 steering。
  if (options.workingDirectory && options.includeDiscoveredProjectInstructions !== false) {
    const projectInstructions = discoverProjectInstructions(options.workingDirectory, options);
    if (projectInstructions) {
      parts.push(`# CodePilot Host Instructions\n\nThese are CodePilot-hosted supplemental instructions that are not part of Claude Code's native project/user instruction loading. Use them to supplement, not replace, Claude Code's default behavior.\n\n${projectInstructions.content}`);
      referencedFiles.push(...projectInstructions.files);
      injectedInstructionSources = [];
    }
  }

  // 中文注释：功能名称「原子知识库提示注入」，用法是默认恢复 graphify/知识图谱
  // 能力说明，让模型更主动地把结构理解与动态记忆区分开来。
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

  // 中文注释：功能名称「技能目录注入」，用法是把本地发现的 skills 目录注入系统提示，
  // 让模型在复杂任务开始前能主动发现可用的 Skill，而不是盲目自己动手。
  if (options.workingDirectory) {
    try {
      const skillsCatalog = buildDiscoveredSkillsCatalog(options.workingDirectory, 24, { lightweight: true });
      if (skillsCatalog) {
        parts.push(skillsCatalog);
      }
    } catch {
      // skills discovery failed — don't block prompt assembly
    }
  }

  return {
    prompt: parts.join('\n\n'),
    referencedFiles,
    instructionSources: [],
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
