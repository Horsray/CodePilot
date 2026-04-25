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
import { getDb, getAllCustomRules, getSetting } from './db';

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

function getToolsSection(): string {
  const sdkFull = getSetting('sdk_full_capabilities') === 'true';

  if (sdkFull) {
    // OMC handles agent delegation, team orchestration, skills, session search.
    // Only keep CodePilot-unique tool guidance.
    return `# Using your tools

- Do NOT use the Bash tool to run commands when a relevant dedicated tool is provided.
  - To read files use Read instead of cat, head, tail, or sed
  - To edit files use Edit instead of sed or awk
  - To create files use Write instead of cat with heredoc or echo redirection
  - To search for files use Glob instead of find or ls
  - To search the content of files, use Grep instead of grep or rg
- Reserve using the Bash exclusively for system commands and terminal operations.
- Maximize efficiency by calling independent tools in parallel. Use sequential calls only when there is a strict data dependency.`;
  }

  return `# Using your tools

- **Agent Delegation (CRITICAL)**: You have access to the \`Agent\` (or \`mcp__codepilot-agent__Agent\`) tool which allows you to spawn specialized sub-agents. If the user's request matches the capabilities of an available sub-agent (e.g., "explore" for codebase exploration, or a custom agent like "web search"), you are **STRICTLY PROHIBITED** from performing the task manually. You MUST delegate it to the specialized agent using this tool.
- **Team Orchestration**: You have access to the \`Team\` (or \`mcp__codepilot-team__Team\`) tool which runs a full multi-agent pipeline (explore + search + plan + execute + verify). If the user uses \`/team\`, call Team immediately and pass the remaining request as the goal.
- **Skill Execution (IMPORTANT)**: You have access to the \`Skill\` tool which discovers and executes reusable prompt templates (skills). Skills are pre-defined workflows stored as SKILL.md files. You MUST proactively use this tool when:
  - The user's request matches a known skill's description or "whenToUse" criteria.
  - The user explicitly mentions using a skill (e.g., "use the X skill", or sends a message like "Use the X skill. User context: ...").
  - A complex task could benefit from a structured workflow that a skill provides.
  To use: call \`Skill\` with \`skill_name\` to execute a specific skill. Call without arguments to list all available skills and discover what's available. **Always check available skills before starting complex multi-step tasks** — a skill may already encode the exact workflow needed.
- **Skill Creation**: You have access to the \`codepilot_skill_create\` tool which saves a reusable workflow as a new Skill (SKILL.md). When you complete a complex multi-step task that could be reused, consider saving it as a skill for future one-click replay.
- **Use Session Search Proactively**: When the user asks about prior discussion, earlier decisions, previous fixes, or "what did we do before?", prefer the \`codepilot_session_search\` tool before guessing from memory.
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
  includeAgentsMd?: boolean;
  includeClaudeMd?: boolean;
  enableAgentsSkills?: boolean;
  syncProjectRules?: boolean;
  knowledgeBaseEnabled?: boolean;
}

export interface SystemPromptResult {
  prompt: string;
  referencedFiles: string[];
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
    getToolsSection(),
    TONE_SECTION,
    OUTPUT_SECTION,
    GLOBAL_PRINCIPLES_SECTION,
  ].filter(Boolean);

  const referencedFiles: string[] = [];

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
  // When sdk_full_capabilities is enabled, Claude Code natively loads CLAUDE.md
  // via settingSources. Skip manual loading to avoid duplication.
  const sdkFullCapabilities = getSetting('sdk_full_capabilities') === 'true';
  if (options.includeClaudeMd !== false && !sdkFullCapabilities) {
    const userFile = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    addSource(sources, seen, userFile, 'user', 'CLAUDE.md (user)');
  }

  // 3. Project-level (working directory)
  for (const filename of PROJECT_FILES) {
    const isClaude = filename.includes('CLAUDE.md') || filename === 'CLAUDE.local.md';
    const isAgents = filename.includes('AGENTS.md');
    const isTraeRules = filename === '.trae/rules/rules.md';

    // Skip CLAUDE.md when sdk_full_capabilities — Claude Code loads it natively.
    // Keep AGENTS.md, CLAUDE.local.md, .trae/rules — these may not be native.
    if (isClaude && filename !== 'CLAUDE.local.md' && sdkFullCapabilities) continue;
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
    if (options.includeClaudeMd !== false && !sdkFullCapabilities) {
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
