/**
 * tools/agent.ts — AgentTool: spawn a sub-agent with isolated context.
 *
 * The sub-agent runs an independent agent-loop with restricted tools
 * and a separate message history. Results are returned as text to the parent.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getAgent, getSubAgents } from '../agent-registry';
import { runAgentLoop } from '../agent-loop';
import { assembleTools } from '../agent-tools';
import { findProviderIdByModel, getProviderOptions } from '../db';
import type { SSEEvent } from '@/types';
import { resolveAgentModelForTier } from '../orchestration-routing';
import { resolveCollaborationBinding } from '../collaboration-strategy';

export interface AgentToolOptions {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  /** Parent session model ID */
  parentModel?: string;
  /** Parent permission mode (plan/code) */
  permissionMode?: string;
  /** Parent session ID — sub-agent inherits permission context */
  parentSessionId?: string;
  /** Orchestration tier (single/dual/multi) */
  orchestrationTier?: 'single' | 'dual' | 'multi';
  /** Callback to forward SSE events to the parent stream */
  emitSSE?: (event: SSEEvent) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
}

/**
 * Create the Agent tool for spawning sub-agents.
 */
export function createAgentTool(ctx: AgentToolOptions) {
  const subAgentIds = getSubAgents().map(a => a.id);

  return tool({
    description:
      'Launch a sub-agent to handle a complex, multi-step task autonomously. ' +
      'The sub-agent has its own context and tool access. ' +
      `Available agents: ${subAgentIds.join(', ')}. ` +
      'Use "explore" for quick codebase searches, "general" for multi-step tasks.',
    inputSchema: z.object({
      prompt: z.string().describe('The task for the sub-agent to perform'),
      agent: z.string().optional().describe(`Agent type: ${subAgentIds.join(' | ')} (default: general)`),
    }),
    execute: async ({ prompt, agent: agentId }) => {
      const agentDef = getAgent(agentId || 'general');
      if (!agentDef) {
        return `Error: Unknown agent "${agentId}". Available: ${subAgentIds.join(', ')}`;
      }

      // Use agent's model or resolve based on tier
      const fallback = resolveAgentModelForTier(agentId || 'general', ctx.orchestrationTier || 'single', ctx.parentModel);
      const strategy = getProviderOptions('__global__').collaboration_strategy;
      const role = (ctx.orchestrationTier || 'single') === 'dual'
        ? ((agentId || 'general') === 'verifier' ? 'verifier' : 'lead')
        : ((agentId || 'general') === 'researcher'
          ? 'researcher'
          : (agentId || 'general') === 'architect'
            ? 'architect'
            : (agentId || 'general') === 'verifier'
              ? 'verifier'
              : 'executor');
      const binding = resolveCollaborationBinding({
        strategy,
        tier: ctx.orchestrationTier || 'single',
        role,
        fallbackProviderId: ctx.providerId || ctx.sessionProviderId,
        fallbackModel: fallback.model || agentDef.model || ctx.parentModel,
      });
      const model = binding.model || fallback.model || agentDef.model || ctx.parentModel;
      let providerId = binding.providerId || ctx.providerId || ctx.sessionProviderId;

      if (model && !binding.providerId) {
        const specializedProviderId = findProviderIdByModel(model);
        if (specializedProviderId) providerId = specializedProviderId;
      }

      // Build restricted tool set — inherit permission context from parent
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
        providerId: providerId,
        sessionProviderId: providerId,
        model: model,
        orchestrationTier: ctx.orchestrationTier,
        permissionContext,
      });
      const subTools = filterTools(allTools, agentDef.allowedTools, agentDef.disallowedTools);

      // Build system prompt
      const systemPrompt = agentDef.prompt
        ? `${agentDef.prompt}\n\nWorking directory: ${ctx.workingDirectory}`
        : `You are a helpful sub-agent. Working directory: ${ctx.workingDirectory}`;

      // Run sub-agent loop and collect the full response
      if (ctx.emitSSE) {
        // 中文注释：功能名称「上报子 Agent 命中信息」，用法是在子智能体启动前把 agent/provider/model 三元组实时推到时间线。
        ctx.emitSSE({
          type: 'status',
          data: JSON.stringify({
            message: `Sub-agent ${agentId || 'general'} is working...`,
            agent: agentId || 'general',
            model,
            providerId,
          }),
        });
      }
      const stream = runAgentLoop({
        prompt,
        sessionId: `sub-${Date.now()}`, // ephemeral session
        providerId: providerId,
        sessionProviderId: providerId,
        model,
        agentName: agentId || 'general',
        systemPrompt,
        workingDirectory: ctx.workingDirectory,
        tools: subTools,
        maxSteps: agentDef.maxSteps || 30,
        permissionMode: ctx.permissionMode, // inherit from parent
      });

      // Collect text from the stream
      const reader = stream.getReader();
      const textParts: string[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse SSE events, extract text content and forward relevant events
          if (value) {
            const lines = value.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event: SSEEvent = JSON.parse(line.slice(6));
                
                // Forward events to parent stream so the UI can update the Timeline
                // and show the sub-agent's process/model badges.
                if (ctx.emitSSE) {
                  // Forward everything except 'done' and 'result' (handled locally)
                  if (!['done', 'result'].includes(event.type)) {
                    ctx.emitSSE(event);
                  }
                }

                if (event.type === 'text') {
                  textParts.push(event.data);
                }
              } catch { /* skip non-JSON lines */ }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return textParts.join('') || '(Sub-agent produced no text output)';
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    // Whitelist mode: only include specified tools
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }

  if (disallowedTools && disallowedTools.length > 0) {
    // Blacklist mode: include all except specified
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, tool] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = tool;
    }
    return filtered;
  }

  return allTools;
}
