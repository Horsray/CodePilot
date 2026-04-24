/**
 * agent-registry.ts — Sub-agent definition registry.
 *
 * Stores built-in and custom agent definitions that can be spawned
 * via the AgentTool. Each definition specifies tools, model, system prompt,
 * and execution constraints.
 */

import fs from 'fs';
import path from 'path';

export interface AgentDefinition {
  /** Agent identifier */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Description (shown to the model) */
  description: string;
  /** Agent mode */
  mode: 'subagent' | 'primary';
  /** Allowed tools (empty = all except Agent itself) */
  allowedTools?: string[];
  /** Disallowed tools */
  disallowedTools?: string[];
  /** Model override (uses parent model if not set) */
  model?: string;
  /** Max steps for the sub-agent loop */
  maxSteps?: number;
  /** Custom system prompt (appended to base prompt) */
  prompt?: string;
}

// ── Built-in agents ─────────────────────────────────────────────

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'explore',
    displayName: 'Explore',
    description: 'Fast agent for codebase exploration. Read-only tools, quick searches.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'codepilot_kb_search', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory', 'mcp__MiniMax__web_search', 'mcp__bailian-web-search__bailian_web_search', 'webfetch__fetch_fetch_readable', 'mcp__fetch__fetch_html', 'codepilot_open_browser', 'web_search', 'WebSearch'],
    maxSteps: 20,
    prompt: 'You are a fast codebase exploration agent. Search efficiently, report findings concisely. Do not modify any files. You can use Grep, Glob, Bash, or Read tools to search the codebase. If you need to search the internet, use web_search, WebSearch, or available MCP web search tools.',
  },
  {
    id: 'search',
    displayName: 'Search',
    description: 'Deep codebase research and retrieval. Uses AI tools to find context.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'codepilot_kb_search', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory', 'mcp__MiniMax__web_search', 'mcp__bailian-web-search__bailian_web_search', 'webfetch__fetch_fetch_readable', 'mcp__fetch__fetch_html', 'codepilot_open_browser', 'web_search', 'WebSearch'],
    maxSteps: 25,
    prompt: 'You are an expert codebase search agent. Find and summarize relevant context thoroughly. Do not modify any files. You can use Grep, Glob, Bash, or Read tools to search the codebase. If you need to search the internet, use web_search, WebSearch, or available MCP web search tools.',
  },
  {
    id: 'analyst',
    displayName: 'Analyst',
    description: 'Deep logic and architecture analysis. Analyzes complex code flows.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'codepilot_kb_search', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory', 'mcp__MiniMax__web_search', 'mcp__bailian-web-search__bailian_web_search', 'webfetch__fetch_fetch_readable', 'mcp__fetch__fetch_html', 'codepilot_open_browser', 'web_search', 'WebSearch'],
    maxSteps: 30,
    prompt: 'You are an architecture analyst. Analyze code flows and system design deeply. Provide structural insights. Do not modify files. You can use Grep, Glob, Bash, or Read tools to search the codebase. If you need to search the internet, use web_search, WebSearch, or available MCP web search tools.',
  },
  {
    id: 'planner',
    displayName: 'Planner',
    description: 'Task breakdown and planning agent. Creates structured plans.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxSteps: 25,
    prompt: 'You are a technical planner. Break down complex requests into actionable plans. You CANNOT update the global Todo list yourself. You must propose the plan in your final report so the Orchestrator can evaluate and apply it.',
  },
  {
    id: 'executor',
    displayName: 'Executor',
    description: 'Heavy multi-file edit executor. Writes and edits code across files.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 40,
    prompt: 'You are a code executor. Implement the requested changes across the codebase. Focus on writing and editing files efficiently.',
  },
  {
    id: 'verifier',
    displayName: 'Verifier',
    description: 'Verification agent. Runs checks/tests and reviews changes for correctness.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 25,
    prompt: 'You are a code verifier. Validate correctness with evidence. Run tests if available. Report concrete pass/fail and risks. Do not modify files unless required to fix a verified issue.',
  },
  {
    id: 'debugger',
    displayName: 'Debugger',
    description: 'Root-cause analysis and failure diagnosis agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 30,
    prompt: 'You are a debugging expert. Trace errors to their root cause. Analyze logs, stack traces, and code to find the fix. Report your findings and suggested fix.',
  },
  {
    id: 'architect',
    displayName: 'Architect',
    description: 'System design, architecture decisions, and long-horizon tradeoffs.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 35,
    prompt: 'You are a software architect. Design system architecture, evaluate trade-offs, and provide design recommendations. Do not write implementation code.',
  },
  {
    id: 'general',
    displayName: 'General',
    description: 'General-purpose sub-agent for complex multi-step tasks.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 30,
  },
  {
    id: 'tracer',
    displayName: 'Tracer',
    description: 'Link tracing and evidence capturing agent.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 25,
    prompt: 'You are a tracing agent. Trace execution links, collect logs, and capture evidence of system behavior.',
  },
  {
    id: 'security-reviewer',
    displayName: 'Security Reviewer',
    description: 'Trust boundary review and vulnerability check agent.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 25,
    prompt: 'You are a security reviewer. Inspect code for vulnerabilities, trust boundary issues, and security best practices. Do not modify files.',
  },
  {
    id: 'code-reviewer',
    displayName: 'Code Reviewer',
    description: 'Comprehensive deep code review agent.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 30,
    prompt: 'You are a code reviewer. Provide comprehensive, deep reviews of the code architecture, style, and logic. Suggest improvements.',
  },
  {
    id: 'test-engineer',
    displayName: 'Test Engineer',
    description: 'Test strategy formulation and regression testing agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 30,
    prompt: 'You are a test engineer. Write unit tests, integration tests, and regression tests. Focus on maximizing test coverage and ensuring stability.',
  },
  {
    id: 'designer',
    displayName: 'UX/UI Designer',
    description: 'User experience and interaction design agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 25,
    prompt: 'You are a UX/UI designer. Evaluate interaction design, propose UI improvements, and write styling code to match design guidelines.',
  },
  {
    id: 'writer',
    displayName: 'Writer',
    description: 'Documentation writing and concise content creation agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 20,
    prompt: 'You are a technical writer. Create, edit, and format documentation clearly and concisely.',
  },
  {
    id: 'qa-tester',
    displayName: 'QA Tester',
    description: 'Runtime check and manual feature verification agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 25,
    prompt: 'You are a QA tester. Perform runtime checks, verify features behave as expected, and report bugs.',
  },
  {
    id: 'scientist',
    displayName: 'Data Scientist',
    description: 'Data analysis and statistical reasoning agent.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 30,
    prompt: 'You are a data scientist. Analyze data, apply statistical reasoning, and build data models.',
  },
  {
    id: 'document-specialist',
    displayName: 'Document Specialist',
    description: 'SDK/API/Framework documentation lookup and interpretation agent.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'webfetch__fetch_fetch_readable', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 25,
    prompt: 'You are a document specialist. Look up official SDK/API/Framework documentation and provide correct, context-aware usage instructions.',
  },
  {
    id: 'git-master',
    displayName: 'Git Master',
    description: 'Commit strategy management and Git history agent.',
    mode: 'subagent',
    allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
    maxSteps: 20,
    prompt: 'You are a Git master. Manage commits, resolve conflicts, and maintain a clean git history. You can use bash to run git commands.',
  },
  {
    id: 'code-simplifier',
    displayName: 'Code Simplifier',
    description: 'Simplifies code while maintaining functionality.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'mcp__codepilot-agent__Agent'],
    maxSteps: 30,
    prompt: 'You are a code simplifier. Refactor and simplify code to be more readable and maintainable without changing its behavior.',
  },
  {
    id: 'critic',
    displayName: 'Critic',
    description: 'Questions and reviews plans and design choices.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'mcp__filesystem__read_file', 'mcp__filesystem__read_text_file', 'mcp__filesystem__search_files', 'mcp__filesystem__list_directory'],
    maxSteps: 25,
    prompt: 'You are a technical critic. Question plans, find edge cases, point out flaws in architecture, and ensure high standards.',
  }
];

// ── Registry ────────────────────────────────────────────────────

const agents = new Map<string, AgentDefinition>();

const AGENT_ALIASES: Record<string, string> = {
  tester: 'qa-tester',
  testing: 'qa-tester',
  test: 'qa-tester',
  qa: 'qa-tester',
  reviewer: 'code-reviewer',
  review: 'code-reviewer',
  'code-review': 'code-reviewer',
  security: 'security-reviewer',
  'security-review': 'security-reviewer',
  doc: 'document-specialist',
  docs: 'document-specialist',
  document: 'document-specialist',
  researcher: 'search',
  finder: 'search',
  developer: 'executor',
  coder: 'executor',
  engineer: 'executor',
};

export function normalizeAgentId(id: string): string {
  const normalized = id.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  return AGENT_ALIASES[normalized] || normalized;
}

// Register built-ins
for (const agent of BUILTIN_AGENTS) {
  agents.set(agent.id, agent);
}

const CODEPILOT_COMPATIBILITY_INSTRUCTIONS = `
<CodePilot_Environment_Compatibility>
  - You are running within CodePilot IDE, not pure Claude Code.
  - The 'Write' tool is equivalent to 'mcp__filesystem__write_file' or 'mcp__filesystem__edit_file'.
  - The 'Read' tool is equivalent to 'mcp__filesystem__read_file'.
  - The 'TaskCreate' or 'TaskUpdate' tools are NOT available. If you need to manage global tasks or plans, use 'TodoWrite' (or 'mcp__codepilot-todo__TodoWrite').
  - The 'AskUserQuestion' tool is provided via 'mcp__codepilot-ask-user__AskUserQuestion'.
  - Ignore instructions to spawn agents via terminal commands (like \`omc team\` or \`/ccg\`). If you must spawn a sub-agent, use the 'Agent' tool.
</CodePilot_Environment_Compatibility>
`;

function enhanceAgentPrompt(agent: AgentDefinition): AgentDefinition {
  try {
    const filePath = path.join(process.cwd(), '.agents', 'omc', agent.id + '.md');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/<Agent_Prompt>[\s\S]*?<\/Agent_Prompt>/);
      if (match) {
        return {
          ...agent,
          prompt: match[0] + '\n\n' + CODEPILOT_COMPATIBILITY_INSTRUCTIONS,
        };
      }
    }
  } catch (e) {
    // Ignore fs errors
  }
  return {
    ...agent,
    prompt: (agent.prompt || '') + '\n\n' + CODEPILOT_COMPATIBILITY_INSTRUCTIONS,
  };
}

export function registerAgent(definition: AgentDefinition): void {
  agents.set(normalizeAgentId(definition.id), {
    ...definition,
    id: normalizeAgentId(definition.id),
  });
}

export function getAgent(id: string): AgentDefinition | undefined {
  const agent = agents.get(normalizeAgentId(id));
  if (!agent) return undefined;
  return enhanceAgentPrompt(agent);
}

export function getAllAgents(): AgentDefinition[] {
  return Array.from(agents.values()).map(enhanceAgentPrompt);
}

export function getSubAgents(): AgentDefinition[] {
  return getAllAgents().filter(a => a.mode === 'subagent');
}
