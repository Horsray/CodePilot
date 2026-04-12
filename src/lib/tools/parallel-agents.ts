import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getAgent } from '../agent-registry';
import { runAgentLoop } from '../agent-loop';
import { assembleTools } from '../agent-tools';
import { findProviderIdByModel, getProvider, getProviderOptions } from '../db';
import type { SSEEvent } from '@/types';
import { resolveAgentModelForTier } from '../orchestration-routing';
import { getCollaborationProfileLabel, resolveCollaborationBinding } from '../collaboration-strategy';

export interface ParallelAgentsToolOptions {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  permissionMode?: string;
  parentSessionId?: string;
  orchestrationTier?: 'single' | 'multi';
  orchestrationProfileId?: string;
  emitSSE?: (event: SSEEvent) => void;
  abortSignal?: AbortSignal;
}

export function createParallelAgentsTool(ctx: ParallelAgentsToolOptions) {
  return tool({
    description:
      'Run multiple independent sub-agents in parallel for evidence-gathering phases. ' +
      'Use only when the tasks do not depend on each other. Good for knowledge-searcher + vision-understanding in parallel.',
    inputSchema: z.object({
      tasks: z.array(z.object({
        agent: z.string().describe('Sub-agent type to run'),
        prompt: z.string().describe('Task prompt for the sub-agent'),
      })).min(2).max(3).describe('Independent sub-agent tasks that can run in parallel'),
    }),
    execute: async ({ tasks }) => {
      const results = await Promise.all(tasks.map((task, index) => runParallelTask(ctx, task, index + 1)));
      return results
        .map((result) => `## ${result.requestedAgent} -> ${result.resolvedRole}\n${result.output || '(Sub-agent produced no text output)'}`)
        .join('\n\n');
    },
  });
}

async function runParallelTask(
  ctx: ParallelAgentsToolOptions,
  task: { agent: string; prompt: string },
  slot: number,
): Promise<{ requestedAgent: string; resolvedRole: string; output: string }> {
  const agentDef = getAgent(task.agent || 'general');
  if (!agentDef) {
    return {
      requestedAgent: task.agent,
      resolvedRole: 'unknown',
      output: `Error: Unknown agent "${task.agent}"`,
    };
  }

  const fallback = resolveAgentModelForTier(task.agent || 'general', ctx.orchestrationTier || 'single', ctx.parentModel);
  const strategy = getProviderOptions('__global__').collaboration_strategy;
  const role = resolveSubAgentRole(task.agent || 'general', ctx.orchestrationTier || 'single');
  const binding = resolveCollaborationBinding({
    strategy,
    tier: ctx.orchestrationTier || 'single',
    role,
    profileId: ctx.orchestrationProfileId,
    fallbackProviderId: ctx.providerId || ctx.sessionProviderId,
    fallbackModel: fallback.model || agentDef.model || ctx.parentModel,
  });
  const model = binding.model || fallback.model || agentDef.model || ctx.parentModel;
  let providerId = binding.providerId || ctx.providerId || ctx.sessionProviderId;
  if (model && !binding.providerId) {
    const specializedProviderId = findProviderIdByModel(model);
    if (specializedProviderId) providerId = specializedProviderId;
  }
  const providerName = providerId ? (getProvider(providerId)?.name || providerId) : undefined;
  const profileName = getCollaborationProfileLabel(strategy, ctx.orchestrationProfileId);

  const permissionContext = (ctx.parentSessionId && ctx.emitSSE && ctx.permissionMode)
    ? {
        sessionId: ctx.parentSessionId,
        permissionMode: (ctx.permissionMode || 'normal') as import('../permission-checker').PermissionMode,
        emitSSE: ctx.emitSSE,
        abortSignal: ctx.abortSignal,
      }
    : undefined;

  const { tools: allTools } = assembleTools({
    workingDirectory: ctx.workingDirectory,
    providerId,
    sessionProviderId: providerId,
    model,
    orchestrationTier: ctx.orchestrationTier,
    orchestrationProfileId: ctx.orchestrationProfileId,
    permissionContext,
  });
  const subTools = filterTools(allTools, agentDef.allowedTools, [...(agentDef.disallowedTools || []), 'Agent', 'ParallelAgents']);
  const systemPrompt = agentDef.prompt
    ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}`
    : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}`;

  if (ctx.emitSSE) {
    ctx.emitSSE({
      type: 'status',
      data: JSON.stringify({
        message: `Parallel sub-agent #${slot} ${task.agent} -> ${role} is working...`,
        agent: role,
        requestedAgent: task.agent,
        model,
        providerId,
        providerName,
        orchestrationProfileName: profileName,
      }),
    });
  }

  const stream = runAgentLoop({
    prompt: task.prompt,
    sessionId: `parallel-sub-${Date.now()}-${slot}`,
    providerId,
    sessionProviderId: providerId,
    model,
    agentName: role,
    systemPrompt,
    workingDirectory: ctx.workingDirectory,
    tools: subTools,
    maxSteps: agentDef.maxSteps || 30,
    permissionMode: ctx.permissionMode,
  });

  const reader = stream.getReader();
  const textParts: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const lines = value.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event: SSEEvent = JSON.parse(line.slice(6));
          if (ctx.emitSSE && !['done', 'result'].includes(event.type)) {
            ctx.emitSSE(event);
          }
          if (event.type === 'text') textParts.push(event.data);
        } catch {
          // ignore malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    requestedAgent: task.agent,
    resolvedRole: role,
    output: textParts.join(''),
  };
}

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }

  if (disallowedTools && disallowedTools.length > 0) {
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, value] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = value;
    }
    return filtered;
  }

  return allTools;
}

function resolveSubAgentRole(
  agentId: string,
  tier: 'single' | 'multi',
): import('@/types').CollaborationRole {
  const normalized = agentId.toLowerCase();
  if (tier === 'single') return 'team-leader';
  if (normalized === 'explore' || normalized === 'researcher' || normalized === 'knowledge-searcher' || normalized === 'search') {
    return 'knowledge-searcher';
  }
  if (normalized === 'vision' || normalized === 'vision-understanding' || normalized === 'vlm') {
    return 'vision-understanding';
  }
  if (normalized === 'expert' || normalized === 'expert-consultant' || normalized === 'consultant') {
    return 'expert-consultant';
  }
  if (normalized === 'verifier' || normalized === 'quality-inspector') {
    return 'quality-inspector';
  }
  if (normalized === 'executor' || normalized === 'worker-executor' || normalized === 'general') {
    return 'worker-executor';
  }
  return 'team-leader';
}
