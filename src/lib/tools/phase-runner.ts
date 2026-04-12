import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getAgent } from '../agent-registry';
import { runAgentLoop } from '../agent-loop';
import { assembleTools } from '../agent-tools';
import { findProviderIdByModel, getProvider, getProviderOptions } from '../db';
import type { SSEEvent } from '@/types';
import { resolveAgentModelForTier } from '../orchestration-routing';
import { getCollaborationProfileLabel, resolveCollaborationBinding } from '../collaboration-strategy';

export interface PhaseRunnerToolOptions {
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

export function createPhaseRunnerTool(ctx: PhaseRunnerToolOptions) {
  return tool({
    description:
      'Execute a multi-phase agent plan. Phases run sequentially, but tasks inside a phase may run in parallel when parallel=true. ' +
      'Use this when a task has explicit dependencies between roles.',
    inputSchema: z.object({
      phases: z.array(z.object({
        name: z.string().describe('Phase name'),
        parallel: z.boolean().describe('Whether all tasks in this phase are independent and may run in parallel'),
        objective: z.string().describe('What this phase is trying to achieve'),
        tasks: z.array(z.object({
          agent: z.string().describe('Sub-agent type'),
          prompt: z.string().describe('Task prompt'),
        })).min(1).max(3),
      })).min(1).max(5),
    }),
    execute: async ({ phases }) => {
      const phaseOutputs: string[] = [];

      for (const [phaseIndex, phase] of phases.entries()) {
        const phaseHeader = `# Phase ${phaseIndex + 1}: ${phase.name}\nObjective: ${phase.objective}\nMode: ${phase.parallel ? 'parallel' : 'serial'}`;
        if (ctx.emitSSE) {
          ctx.emitSSE({
            type: 'status',
            data: JSON.stringify({
              message: `PhaseRunner starting ${phase.name} (${phase.parallel ? 'parallel' : 'serial'})`,
              requestedAgent: 'phase-runner',
              orchestrationProfileName: getCollaborationProfileLabel(getProviderOptions('__global__').collaboration_strategy, ctx.orchestrationProfileId),
            }),
          });
        }

        const taskResults = phase.parallel
          ? await Promise.all(phase.tasks.map((task, taskIndex) => runManagedSubAgentTask(ctx, task, `${phaseIndex + 1}.${taskIndex + 1}`)))
          : await runSerialTasks(ctx, phase.tasks, phaseIndex + 1);

        phaseOutputs.push([
          phaseHeader,
          ...taskResults.map((result) => `## ${result.slot} ${result.requestedAgent} -> ${result.resolvedRole}\n${result.output || '(Sub-agent produced no text output)'}`),
        ].join('\n\n'));
      }

      return phaseOutputs.join('\n\n');
    },
  });
}

async function runSerialTasks(
  ctx: PhaseRunnerToolOptions,
  tasks: Array<{ agent: string; prompt: string }>,
  phaseNumber: number,
): Promise<Array<{ slot: string; requestedAgent: string; resolvedRole: string; output: string }>> {
  const results: Array<{ slot: string; requestedAgent: string; resolvedRole: string; output: string }> = [];
  for (const [taskIndex, task] of tasks.entries()) {
    results.push(await runManagedSubAgentTask(ctx, task, `${phaseNumber}.${taskIndex + 1}`));
  }
  return results;
}

async function runManagedSubAgentTask(
  ctx: PhaseRunnerToolOptions,
  task: { agent: string; prompt: string },
  slot: string,
): Promise<{ slot: string; requestedAgent: string; resolvedRole: string; output: string }> {
  const agentDef = getAgent(task.agent || 'general');
  if (!agentDef) {
    return {
      slot,
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
  const subTools = filterTools(allTools, agentDef.allowedTools, [...(agentDef.disallowedTools || []), 'Agent', 'ParallelAgents', 'PhaseRunner']);
  const systemPrompt = agentDef.prompt
    ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}`
    : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}`;

  if (ctx.emitSSE) {
    ctx.emitSSE({
      type: 'status',
      data: JSON.stringify({
        message: `Phase sub-agent ${slot} ${task.agent} -> ${role} is working...`,
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
    sessionId: `phase-sub-${Date.now()}-${slot.replace('.', '-')}`,
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
    slot,
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
