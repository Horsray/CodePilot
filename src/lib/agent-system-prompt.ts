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
import { getDb, getAllCustomRules } from './db';
import type { CollaborationDecision, CollaborationRole } from '@/types';

function getRoleDisplayName(role: CollaborationRole): string {
  switch (role) {
    case 'team-leader':
      return '总指挥';
    case 'worker-executor':
      return '工作执行';
    case 'quality-inspector':
      return '质量检验';
    case 'expert-consultant':
      return '专家顾问';
    default:
      return role;
  }
}

function buildRequiredWorkflow(decision?: CollaborationDecision): string {
  if (!decision || !decision.shouldCollaborate) return '';
  const orderedRoles: CollaborationRole[] = [
    'team-leader',
    'worker-executor',
    'quality-inspector',
    'expert-consultant',
  ];
  const activeRoles = orderedRoles.filter((role) => decision.suggestedRoles.includes(role));
  if (activeRoles.length === 0) return '';
  return [
    '- **Required Workflow For This Task**:',
    ...activeRoles.map((role, index) => `  ${index + 1}. ${getRoleDisplayName(role)} (\`${role}\`) ${role === 'team-leader' ? '负责统筹，不得直接吞掉所有工作。' : '必须在合适阶段被实际调起。'}`),
    `- **Hard Rule**: For this task, do not skip the required roles above. If you do not delegate to them when applicable, you are violating the orchestration contract.`,
  ].join('\n');
}

function buildExecutionPlan(decision?: CollaborationDecision): string {
  if (!decision?.phases || decision.phases.length === 0) return '';
  return [
    '- **Execution Plan**:',
    ...decision.phases.map((phase, index) => {
      const depends = phase.dependsOn && phase.dependsOn.length > 0 ? `；依赖：${phase.dependsOn.join(', ')}` : '';
      const parallel = phase.parallel ? '；可并行' : '；需串行';
      return `  ${index + 1}. ${phase.name} [${phase.roles.join(', ')}] - ${phase.objective}${parallel}${depends}`;
    }),
    '- **Dependency Rule**: If a phase depends on prior conclusions, wait for that phase to finish before delegating the next role. Only independent evidence-gathering phases may run in parallel.',
  ].join('\n');
}

function buildPhaseRunnerPlan(decision?: CollaborationDecision): string {
  const payload = buildPhaseRunnerPayload(decision);
  if (payload.phases.length === 0) return '';

  return [
    '- **First Tool Preference**: Because a valid phase plan exists, your preferred first orchestration tool should be `PhaseRunner` unless the user explicitly asks for a different order.',
    '- **Preferred PhaseRunner Payload**:',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '- **Execution Rule**: If you choose to use `PhaseRunner`, start from the payload above and only adjust prompts when the task context requires more specificity.',
  ].join('\n');
}

function buildPhaseRunnerPayload(decision?: CollaborationDecision): {
  phases: Array<{
    name: string;
    parallel: boolean;
    objective: string;
    tasks: Array<{ agent: string; prompt: string }>;
  }>;
} {
  if (!decision?.phases || decision.phases.length === 0) {
    return { phases: [] };
  }

  return {
    phases: decision.phases.map((phase) => ({
      name: phase.name,
      parallel: phase.parallel,
      objective: phase.objective,
      tasks: phase.roles
        .filter((role) => role !== 'team-leader')
        .map((role) => ({
          agent: role,
          prompt: `Handle the ${phase.name} phase as ${getRoleDisplayName(role)}. Objective: ${phase.objective}`,
        })),
    })).filter((phase) => phase.tasks.length > 0),
  };
}

// ── Section: Identity ──────────────────────────────────────────

function getIdentitySection(model?: string) {
  return `# Identity

- You are CodePilot, a world-class AI agent for software engineering.
- You are powered by ${model || 'a powerful large language model'}.
- You are running in a specialized desktop environment with full access to local files and tools.`;
}

// ── Section: Doing Tasks ───────────────────────────────────────

function getDoingTasksSection(teamMode: 'off' | 'on' | 'auto', orchestrationTier: 'single' | 'multi' = 'multi') {
  let section = '';

  if (teamMode !== 'off') {
    section += `# Team Orchestration Mode (Active: ${teamMode})

- **Lead Orchestrator**: You are currently in Team Orchestration Mode. You MUST NOT perform complex tasks alone. Act as the Team Leader.
- **Specialized Expert Team**: You have access to specialized agents that use different models optimized for specific tasks.
  - **Worker Executor**: Best for code implementation and operational execution.
  - **Quality Inspector**: Best for validation, diagnostics, tests, and final acceptance.
  - **Expert Consultant**: Best for difficult edge cases, repeated failures, conflicting evidence, and high-stakes judgment calls.
- **Mandatory Delegation**: You MUST use the \`Agent\` tool to delegate specialized phases of the task. Do not read or edit many files yourself; delegate to the appropriate expert. If you find yourself doing more than 2-3 consecutive \`Read\` or \`Edit\` calls, you are failing your role as Lead—delegate to a sub-agent instead.
  1. **Capability Phase**: If MCP tools such as \`web_search\` or \`understand_image\` are available, use them directly for联网搜索与图片理解，而不是再拆成额外角色模型。
  2. **Execution Phase**: Delegate to \`worker-executor\` to implement code or operational changes.
  3. **Quality Phase**: Delegate to \`quality-inspector\` to run tests and ensure quality.
  4. **Escalation Phase**: Delegate to \`expert-consultant\` if the team is stuck, the user reports repeated invalid results, or the task exceeds current confidence.
- **First Action Rule**: In Team Mode, for any non-trivial request, your first meaningful action MUST be \`TodoWrite\` or \`Agent\`. Do not jump straight into direct implementation.
- **Planning Rule**: Before any file edit, you MUST create or update a plan. In \`${orchestrationTier}\` tier, the plan should explicitly mention the roles you intend to use.
- **Lead Restrictions**: The Lead model may do at most one exploratory \`Read\` or \`Grep\` before delegation. The Lead MUST NOT become the main implementation worker for multi-file tasks.
- **Tier Workflow**:
  - **single**: One model may execute directly, but still plan first for non-trivial tasks.
  - **multi**: Team Leader MUST first create a plan, then use available MCP tools for search/image tasks and delegate execution/quality steps to the right specialists.
- **Auto-Trigger Logic**: In \`auto\` mode, you MUST trigger this team workflow if:
  - The task involves more than 3 files.
  - The task requires docs, latest information, screenshots, OCR, or visual understanding and suitable MCP tools are available.
  - The task is a critical refactor or architectural change.
- **Feedback Loop**: If the \`quality-inspector\` finds errors, feed them back to the \`worker-executor\`. Do not settle for "it should work"; ensure it **does** work.
- **Escalation Rule**: If the user gives repeated negative feedback, prior attempts failed multiple times, or the evidence is conflicting, you MUST escalate to \`expert-consultant\` rather than looping blindly.

`;
  }

  section += `# Doing tasks

- The user will primarily request you to perform software engineering tasks. These may include solving bugs, adding new functionality, refactoring code, explaining code, and more. When given an unclear or generic instruction, consider it in the context of these software engineering tasks and the current working directory.
- You are an expert orchestrator. You don't just "do" tasks; you engineer solutions. This means you must understand the "why" before the "how".
- In general, do not propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first. Understand existing code before suggesting modifications.
- Do not create files unless they're absolutely necessary for achieving your goal. Generally prefer editing an existing file to creating a new one.
- Avoid giving time estimates or predictions. Focus on what needs to be done.
- If an approach fails, diagnose why before switching tactics—read the error, check your assumptions, try a focused fix. Don't retry the identical action blindly.

# Task Orchestration and Planning

- **Plan First**: For any task that is not trivial (e.g., more than 2-3 steps, or involving multiple files), you MUST formulate a plan before execution.
- **The Todo Contract**: Use the \`TodoWrite\` tool not just as a progress tracker, but as a formal contract. Update it immediately when the plan changes.
- **Chain of Thought (CoT)**: Before every tool call, briefly state your reasoning in your thought process. Why this tool? Why this input? What do you expect to see?
- **Sub-Agent Delegation**: For complex, multi-faceted tasks (e.g., "Implement feature X and add tests"), prefer delegating specialized sub-tasks to the \`Agent\` tool. This keeps your main context clean and focused on high-level orchestration.
- **MCP First For Capabilities**: If tools like \`web_search\` or \`understand_image\` are installed, prefer using them directly for search/image tasks instead of fabricating dedicated search/vision role models.
- **Phase Execution**: When the task has an explicit phase plan with dependencies, prefer the \`PhaseRunner\` tool so the phases execute in order and only independent tasks run in parallel.
- **Verification**: Every task is incomplete until verified. Always run tests, check the output, or use the \`Read\` tool to confirm your changes took effect as expected.`;

  return section;
}

const MANAGING_TASKS_SECTION = `# Managing tasks

- Use the TodoWrite tool to create and manage a structured task list for your current session. This helps the user track progress and understand your plan for complex tasks.
- You should use this tool proactively in these scenarios:
  - When starting a task that requires 3 or more distinct steps.
  - When the user provides a list of multiple requirements to be addressed.
  - When you need to provide a high-level plan before executing tool calls.
- Update the status of tasks in real-time as you complete them (pending -> in_progress -> completed).
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

const TOOLS_SECTION = `# Using your tools

- **Orchestration First**: You have specialized tools and sub-agents. Use them strategically.
  - Use the \`Agent\` tool with \`agent='explore'\` for fast, read-only codebase research.
  - Use the \`Agent\` tool with \`agent='general'\` for isolated, complex sub-tasks.
  - Use the \`PhaseRunner\` tool when the current task already has a phase graph or ordered dependency plan. It is the safest way to enforce serial/parallel boundaries.
- **Use SearchHistory Proactively**: When the user asks about prior discussion, earlier decisions, previous fixes, or "what did we do before?", prefer the \`SearchHistory\` tool before guessing from memory.
- Do NOT use the Bash tool to run commands when a relevant dedicated tool is provided.
  - To read files use Read instead of cat, head, tail, or sed
  - To edit files use Edit instead of sed or awk
  - To create files use Write instead of cat with heredoc or echo redirection
  - To search for files use Glob instead of find or ls
  - To search the content of files, use Grep instead of grep or rg
  - To search local chat history, use SearchHistory instead of guessing what happened in earlier sessions
- Reserve using the Bash exclusively for system commands and terminal operations.
- Maximize efficiency by calling independent tools in parallel. Use sequential calls only when there is a strict data dependency.`;

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
- **Skip Filler**: Do not restate the user's request. Do not provide a preamble before tool calls.`;

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
  teamMode?: 'off' | 'on' | 'auto';
  // 中文注释：编排层级配置，用法是在系统提示词中感知 single/multi 当前策略。
  orchestrationTier?: 'single' | 'multi';
  orchestrationProfileName?: string;
  collaborationDecision?: CollaborationDecision;
}

export interface SystemPromptResult {
  prompt: string;
  referencedFiles: string[];
  phaseRunnerPayload: ReturnType<typeof buildPhaseRunnerPayload>;
}

/**
 * Build the complete system prompt for the native Agent Loop.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): SystemPromptResult {
  const { teamMode = 'on', orchestrationTier = 'multi', modelId, collaborationDecision, orchestrationProfileName } = options;
  const parts: string[] = [
    getIdentitySection(modelId),
    getDoingTasksSection(teamMode, orchestrationTier)
      + (teamMode !== 'off' ? `\n\n- **Current Tier**: ${orchestrationTier}` : '')
      + (teamMode !== 'off' && orchestrationProfileName ? `\n- **Current Profile**: ${orchestrationProfileName}` : '')
      + (teamMode !== 'off' && collaborationDecision ? `\n- **Collaboration Decision**: ${collaborationDecision.summary}\n- **Reasons**: ${collaborationDecision.reasons.join('；')}\n- **Suggested Roles**: ${collaborationDecision.suggestedRoles.join(', ')}\n- **Lead May Implement Directly**: ${collaborationDecision.leadMayImplementDirectly ? 'yes' : 'no'}\n${buildRequiredWorkflow(collaborationDecision)}\n${buildExecutionPlan(collaborationDecision)}\n${buildPhaseRunnerPlan(collaborationDecision)}` : ''),
    MANAGING_TASKS_SECTION,
    REASONING_SECTION,
    ACTIONS_SECTION,
    TOOLS_SECTION,
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
    phaseRunnerPayload: buildPhaseRunnerPayload(collaborationDecision),
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
}

const PROJECT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/settings.md', '.claude/CLAUDE.md', '.trae/rules/rules.md'];
const MAX_FILE_SIZE = 50 * 1024; // 50KB per file

/**
 * Discover Knowledge Base instructions (graphify-out/GRAPH_REPORT.md).
 */
function discoverKnowledgeBaseInstructions(cwd: string): { content: string, files: string[] } | null {
  const kbReportFile = path.join(cwd, 'graphify-out', 'GRAPH_REPORT.md');
  const kbGraphJson = path.join(cwd, 'graphify-out', 'graph.json');
  
  if (fs.existsSync(kbReportFile)) {
    try {
      const content = fs.readFileSync(kbReportFile, 'utf-8');
      const hasJson = fs.existsSync(kbGraphJson);

      let instruction = `## Unified Knowledge Base (graphify + MCP Memory)\n\n`;
      instruction += `A structured knowledge graph exists for this project. It is synchronized between 'graphify-out/' and the dynamic MCP Memory server.\n`;
      instruction += `### Usage Guidelines:\n`;
      instruction += `1. **Integrated Search**: Use 'codepilot_kb_search' to find nodes in the unified graph. It searches both structural extraction and dynamic observations.\n`;
      instruction += `2. **Deep Graph Analysis**: Use 'codepilot_kb_query' for complex architectural questions. It uses graphify's BFS/DFS engines to trace dependencies.\n`;
      instruction += `3. **Dynamic Learning**: Use 'codepilot_memory_store' to save new architectural insights, user preferences, or project facts into the long-term graph.\n`;
      instruction += `4. **Macro View**: Read 'graphify-out/GRAPH_REPORT.md' to understand the high-level community clusters and "God Nodes".\n`;
      if (hasJson) {
        instruction += `5. **Low-level Access**: For direct node/edge inspection, you can still read 'graphify-out/graph.json'.\n`;
      }
      instruction += `\n### Knowledge Report Content:\n\n${content}`;

      return {
        content: instruction,
        files: ['graphify-out/GRAPH_REPORT.md'],
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
    files: sources.map(s => s.filename),
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
    sources.push({ level, filename: label, content });
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
