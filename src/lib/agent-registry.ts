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
    id: 'general',
    displayName: 'General',
    description: 'General-purpose sub-agent for complex multi-step tasks.',
    mode: 'subagent',
    disallowedTools: ['Agent'], // prevent recursive sub-agents
    maxSteps: 30,
  },
  {
    id: 'architect',
    displayName: 'Architect',
    description: 'Specialized in high-level system design and planning. Proposes changes without executing them.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite'],
    maxSteps: 15,
    prompt: 'You are an Expert Architect. Your goal is to research the codebase and propose a detailed, step-by-step implementation plan. Do not modify files. Use TodoWrite to record the plan.',
  },
  {
    id: 'executor',
    displayName: 'Executor',
    description: 'Specialized in implementing code changes based on a plan.',
    mode: 'subagent',
    disallowedTools: ['Agent'],
    maxSteps: 40,
    prompt: 'You are an Expert Developer. Your goal is to implement the changes specified in the architectural plan. Focus on code quality and adherence to existing patterns.',
  },
  {
    id: 'verifier',
    displayName: 'Verifier',
    description: 'Specialized in quality assurance and validation. Runs tests and checks for errors.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'RunCommand', 'GetDiagnostics'],
    maxSteps: 20,
    prompt: 'You are an Expert QA Engineer. Your goal is to verify that the implemented changes work correctly and do not introduce regressions. Run tests and check linter diagnostics.',
  },
  {
    id: 'researcher',
    displayName: 'Researcher',
    description: 'Specialized in deep knowledge retrieval, external research, and knowledge crystallization.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'codepilot_browser_open', 'codepilot_browser_context', 'codepilot_memory_store', 'codepilot_kb_search', 'codepilot_kb_query'],
    maxSteps: 30,
    prompt: 'You are an Expert Researcher. Your goal is to gather all necessary context for a task and "crystallize" significant findings into the long-term knowledge base. \n\n' +
            '1. **Information Gathering**: Search the local codebase for patterns and search the web for latest documentation and best practices.\n' +
            '2. **Synthesis**: Summarize your findings clearly for the Architect.\n' +
            '3. **Crystallization**: If you discover important architectural decisions, library versions, or complex patterns, use `codepilot_memory_store` to save them. This ensures the team "learns" from this research and doesn\'t have to repeat it in the future.',
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
