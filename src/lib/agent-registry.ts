/**
 * agent-registry.ts — Sub-agent definition registry.
 *
 * Stores built-in and custom agent definitions that can be spawned
 * via the AgentTool. Each definition specifies tools, model, system prompt,
 * and execution constraints.
 */

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
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxSteps: 20,
    prompt: 'You are a fast codebase exploration agent. Search efficiently, report findings concisely. Do not modify any files.',
  },
  {
    id: 'search',
    displayName: 'Search',
    description: 'Deep codebase research and retrieval. Uses AI tools to find context.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'SearchCodebase'],
    maxSteps: 25,
    prompt: 'You are an expert codebase search agent. Find and summarize relevant context thoroughly. Do not modify any files.',
  },
  {
    id: 'analyst',
    displayName: 'Analyst',
    description: 'Deep logic and architecture analysis. Analyzes complex code flows.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'codepilot_kb_search', 'codepilot_kb_query'],
    maxSteps: 30,
    prompt: 'You are an architecture analyst. Analyze code flows and system design deeply. Provide structural insights. Do not modify files.',
  },
  {
    id: 'planner',
    displayName: 'Planner',
    description: 'Task breakdown and planning agent. Creates structured plans.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'codepilot_todo_write'],
    maxSteps: 25,
    prompt: 'You are a technical planner. Break down complex requests into actionable todo lists. Do not implement the code yourself.',
  },
  {
    id: 'executor',
    displayName: 'Executor',
    description: 'Heavy multi-file edit executor. Writes and edits code across files.',
    mode: 'subagent',
    disallowedTools: ['Agent'],
    maxSteps: 40,
    prompt: 'You are a code executor. Implement the requested changes across the codebase. Focus on writing and editing files efficiently.',
  },
  {
    id: 'verifier',
    displayName: 'Verifier',
    description: 'Verification agent. Runs checks/tests and reviews changes for correctness.',
    mode: 'subagent',
    disallowedTools: ['Agent'],
    maxSteps: 25,
    prompt: 'You are a verifier. Validate correctness with evidence. Run tests/commands if available. Report concrete pass/fail and risks. Do not modify files unless required to fix a verified issue.',
  },
  {
    id: 'general',
    displayName: 'General',
    description: 'General-purpose sub-agent for complex multi-step tasks.',
    mode: 'subagent',
    disallowedTools: ['Agent'], // prevent recursive sub-agents
    maxSteps: 30,
  },
];

// ── Registry ────────────────────────────────────────────────────

const agents = new Map<string, AgentDefinition>();

// Register built-ins
for (const agent of BUILTIN_AGENTS) {
  agents.set(agent.id, agent);
}

export function registerAgent(definition: AgentDefinition): void {
  agents.set(definition.id, definition);
}

export function getAgent(id: string): AgentDefinition | undefined {
  return agents.get(id);
}

export function getAllAgents(): AgentDefinition[] {
  return Array.from(agents.values());
}

export function getSubAgents(): AgentDefinition[] {
  return getAllAgents().filter(a => a.mode === 'subagent');
}
