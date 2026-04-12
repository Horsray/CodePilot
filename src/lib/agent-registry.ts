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
    displayName: 'Knowledge Searcher',
    description: 'Knowledge retrieval agent for codebase exploration, documentation lookup, and web research.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxSteps: 20,
    prompt: 'You are the Knowledge Searcher. Gather internal code context and external documentation efficiently. Do not modify files.',
  },
  {
    id: 'general',
    displayName: 'Worker Executor',
    description: 'Primary execution agent for implementation-heavy tasks.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'ParallelAgents', 'PhaseRunner'], // prevent recursive sub-agents
    maxSteps: 30,
  },
  {
    id: 'worker-executor',
    displayName: 'Worker Executor',
    description: 'Specialized in implementing code changes based on a plan.',
    mode: 'subagent',
    disallowedTools: ['Agent', 'ParallelAgents', 'PhaseRunner'],
    maxSteps: 40,
    prompt: 'You are the Worker Executor. Implement the assigned code or product task efficiently, keep output precise, and follow existing patterns.',
  },
  {
    id: 'quality-inspector',
    displayName: 'Quality Inspector',
    description: 'Specialized in quality assurance and validation. Runs tests and checks for errors.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'RunCommand', 'GetDiagnostics'],
    maxSteps: 20,
    prompt: 'You are the Quality Inspector. Verify that changes work correctly, check diagnostics, run tests, and report concrete issues.',
  },
  {
    id: 'knowledge-searcher',
    displayName: 'Knowledge Searcher',
    description: 'Specialized in deep knowledge retrieval, external research, and knowledge crystallization.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'codepilot_browser_open', 'codepilot_browser_context', 'codepilot_memory_store', 'codepilot_kb_search', 'codepilot_kb_query'],
    maxSteps: 30,
    prompt: 'You are the Knowledge Searcher. Your goal is to gather all necessary context for a task and "crystallize" significant findings into the long-term knowledge base. \n\n' +
            '1. **Information Gathering**: Search the local codebase for patterns and search the web for latest documentation and best practices.\n' +
            '2. **Synthesis**: Summarize your findings clearly for the Team Leader.\n' +
            '3. **Crystallization**: If you discover important architectural decisions, library versions, or complex patterns, use `codepilot_memory_store` to save them. This ensures the team "learns" from this research and doesn\'t have to repeat it in the future.',
  },
  {
    id: 'vision-understanding',
    displayName: 'Vision Understanding',
    description: 'Specialized in screenshots, images, UI understanding, and multimodal evidence extraction.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxSteps: 20,
    prompt: 'You are the Vision Understanding agent. Focus on screenshots, visual layouts, UI states, and image evidence. Extract concrete observations for the Team Leader.',
  },
  {
    id: 'expert-consultant',
    displayName: 'Expert Consultant',
    description: 'Senior escalation agent for difficult tasks, repeated failures, and disputed conclusions.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'RunCommand', 'GetDiagnostics', 'SearchHistory'],
    maxSteps: 25,
    prompt: 'You are the Expert Consultant. Step in when the Team Leader lacks confidence, prior attempts failed, or the user reports repeated invalid results. Review the evidence, challenge assumptions, and give a decisive expert recommendation.',
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
