/**
 * Agent SDK Agents Adapter — bridges CodePilot's AgentDefinition
 * (agent-registry.ts) to the SDK's AgentDefinition format, then
 * registers them so they are injected into SDK query options.
 */

import type { AgentDefinition as SdkAgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { getSubAgents } from './agent-registry';

const GLOBAL_KEY = '__agentSdkAgents__' as const;

function getRegistry(): Map<string, SdkAgentDefinition> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, SdkAgentDefinition>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, SdkAgentDefinition>;
}

/**
 * Convert CodePilot AgentDefinition to SDK AgentDefinition format.
 */
function toSdkFormat(cp: import('./agent-registry').AgentDefinition): SdkAgentDefinition {
  return {
    name: cp.id,
    model: cp.model,
    description: cp.description || cp.displayName,
    prompt: cp.prompt || `You are a ${cp.displayName} sub-agent.`,
    systemPrompt: cp.prompt,
    tools: cp.allowedTools && cp.allowedTools.length > 0
      ? cp.allowedTools
      : undefined,
    disallowedTools: cp.disallowedTools && cp.disallowedTools.length > 0
      ? cp.disallowedTools
      : undefined,
  } as SdkAgentDefinition;
}

/**
 * Ensure all CodePilot sub-agents are registered in SDK format.
 * Called once at startup and on-demand when agents change.
 */
function syncAgentsIfNeeded() {
  const registry = getRegistry();
  const cpAgents = getSubAgents();

  // Re-sync if registry is empty or count differs
  if (registry.size === 0 || registry.size !== cpAgents.length) {
    registry.clear();
    for (const cp of cpAgents) {
      registry.set(cp.id, toSdkFormat(cp));
    }
  }
}

/**
 * Register a built-in agent definition in SDK format.
 */
export function registerAgent(name: string, definition: SdkAgentDefinition): void {
  getRegistry().set(name, definition);
}

/**
 * Unregister a built-in agent.
 */
export function unregisterAgent(name: string): void {
  getRegistry().delete(name);
}

/**
 * Get all registered agent definitions as a record suitable for SDK Options.agents.
 */
export function getRegisteredAgents(): Record<string, SdkAgentDefinition> {
  syncAgentsIfNeeded();
  const result: Record<string, SdkAgentDefinition> = {};
  for (const [name, def] of getRegistry()) {
    result[name] = def;
  }
  return result;
}

/**
 * Get a specific registered agent.
 */
export function getAgent(name: string): SdkAgentDefinition | undefined {
  return getRegistry().get(name);
}

/**
 * Check if any agents are registered.
 */
export function hasRegisteredAgents(): boolean {
  syncAgentsIfNeeded();
  return getRegistry().size > 0;
}
