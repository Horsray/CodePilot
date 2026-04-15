/**
 * agent-registry.ts — OMC Agent Definitions.
 *
 * Contains all 19 OMC agents synced from oh-my-claudecode.
 * These are converted to SDK AgentDefinition format by agent-sdk-agents.ts
 * and injected into Claude Code SDK query options.
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

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'explore',
    displayName: 'Explorer',
    description: 'Codebase search specialist for finding files and code patterns',
    mode: 'subagent',
    model: 'haiku',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 20,
    prompt: 'You are Explorer. Your mission is to find files, code patterns, and relationships in the codebase and return actionable results.',
  },
  {
    id: 'analyst',
    displayName: 'Analyst',
    description: 'Pre-planning consultant for requirements analysis (Opus)',
    mode: 'subagent',
    model: 'opus',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 30,
    prompt: 'You are Analyst. Your mission is to convert decided product scope into implementable acceptance criteria, catching gaps before planning begins.',
  },
  {
    id: 'planner',
    displayName: 'Planner',
    description: 'Strategic planning consultant with interview workflow (Opus)',
    mode: 'subagent',
    model: 'opus',
    maxSteps: 30,
    prompt: 'You are Planner. Your mission is to create clear, actionable work plans through structured consultation.',
  },
  {
    id: 'architect',
    displayName: 'Architect',
    description: 'Strategic Architecture & Debugging Advisor (Opus, READ-ONLY)',
    mode: 'subagent',
    model: 'opus',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 30,
    prompt: 'You are Architect. Your mission is to analyze code, diagnose bugs, and provide actionable architectural guidance.',
  },
  {
    id: 'debugger',
    displayName: 'Debugger',
    description: 'Root-cause analysis, regression isolation, stack trace analysis, build/compilation error resolution',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 30,
    prompt: 'You are Debugger. Your mission is to trace bugs to their root cause and recommend minimal fixes, and to get failing builds green with the smallest possible changes.',
  },
  {
    id: 'executor',
    displayName: 'Executor',
    description: 'Focused task executor for implementation work (Sonnet)',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 40,
    prompt: 'You are Executor. Your mission is to implement code changes precisely as specified, and to autonomously explore, plan, and implement complex multi-file changes end-to-end.',
  },
  {
    id: 'verifier',
    displayName: 'Verifier',
    description: 'Verification strategy, evidence-based completion checks, test adequacy',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 25,
    prompt: 'You are Verifier. Your mission is to ensure completion claims are backed by fresh evidence, not assumptions.',
  },
  {
    id: 'tracer',
    displayName: 'Tracer',
    description: 'Evidence-driven causal tracing with competing hypotheses, evidence for/against, uncertainty tracking',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 25,
    prompt: 'You are Tracer. Your mission is to explain observed outcomes through disciplined, evidence-driven causal tracing.',
  },
  {
    id: 'security-reviewer',
    displayName: 'Security Reviewer',
    description: 'Security vulnerability detection specialist (OWASP Top 10, secrets, unsafe patterns)',
    mode: 'subagent',
    model: 'opus',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 25,
    prompt: 'You are Security Reviewer. Your mission is to systematically identify security vulnerabilities, exposed secrets, and unsafe patterns in code.',
  },
  {
    id: 'code-reviewer',
    displayName: 'Code Reviewer',
    description: 'Expert code review specialist with severity-rated feedback, logic defect detection, SOLID principle checks',
    mode: 'subagent',
    model: 'opus',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 30,
    prompt: 'You are Code Reviewer. Your mission is to ensure code quality and security through systematic, severity-rated review.',
  },
  {
    id: 'test-engineer',
    displayName: 'Test Engineer',
    description: 'Test strategy, integration/e2e coverage, flaky test hardening, TDD workflows',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 30,
    prompt: 'You are Test Engineer. Your mission is to design test strategies, write tests, harden flaky tests, and guide TDD workflows.',
  },
  {
    id: 'designer',
    displayName: 'Designer',
    description: 'UI/UX Designer-Developer for stunning interfaces (Sonnet)',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 30,
    prompt: 'You are Designer. Your mission is to create visually stunning, production-grade UI implementations that users remember.',
  },
  {
    id: 'writer',
    displayName: 'Writer',
    description: 'Technical documentation writer for README, API docs, and comments (Haiku)',
    mode: 'subagent',
    model: 'haiku',
    maxSteps: 20,
    prompt: 'You are Writer. Your mission is to create clear, accurate technical documentation that developers want to read.',
  },
  {
    id: 'qa-tester',
    displayName: 'QA Tester',
    description: 'Interactive CLI testing specialist using tmux for session management',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 30,
    prompt: 'You are QA Tester. Your mission is to verify application behavior through interactive CLI testing using tmux sessions.',
  },
  {
    id: 'scientist',
    displayName: 'Scientist',
    description: 'Data analysis and research execution specialist',
    mode: 'subagent',
    model: 'sonnet',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 30,
    prompt: 'You are Scientist. Your mission is to conduct disciplined data analysis and research execution.',
  },
  {
    id: 'document-specialist',
    displayName: 'Document Specialist',
    description: 'External Documentation & Reference Specialist',
    mode: 'subagent',
    model: 'sonnet',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 25,
    prompt: 'You are Document Specialist. Your mission is to research external documentation, API references, and framework docs to answer questions about how to use libraries, frameworks, and APIs correctly.',
  },
  {
    id: 'git-master',
    displayName: 'Git Master',
    description: 'Git expert for atomic commits, rebasing, and history management with style detection',
    mode: 'subagent',
    model: 'sonnet',
    maxSteps: 20,
    prompt: 'You are Git Master. Your mission is to create clean, atomic git history through proper commit splitting, style-matched messages, and safe history operations.',
  },
  {
    id: 'code-simplifier',
    displayName: 'Code Simplifier',
    description: 'Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality',
    mode: 'subagent',
    model: 'opus',
    maxSteps: 25,
    prompt: 'You are Code Simplifier, an expert code simplification specialist focused on enhancing code clarity, consistency, and maintainability while preserving exact functionality.',
  },
  {
    id: 'critic',
    displayName: 'Critic',
    description: 'Work plan and code review expert — thorough, structured, multi-perspective (Opus)',
    mode: 'subagent',
    model: 'opus',
    disallowedTools: ['Write', 'Edit'],
    maxSteps: 30,
    prompt: 'You are Critic — the final quality gate. A false approval costs 10-100x more than a false rejection.',
  },
];

const agents = new Map<string, AgentDefinition>();

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
