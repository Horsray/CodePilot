import { resolveProvider } from './provider-resolver';
import type { AgentDefinition } from './agent-registry';

/**
 * AgentRoutingResult - 路由结果类型
 * 用于存储解析后的 providerId 和 model
 */
export interface AgentRoutingResult {
  providerId?: string;
  model?: string;
}

/**
 * resolveAgentModel - 智能体模型路由解析器
 * 功能：根据子智能体的角色和配置，结合父级的模型设定，自动路由到最合适的模型（如 opus, sonnet, haiku）
 * 用法：在唤醒子智能体前调用此函数，获取实际应使用的 providerId 和 model
 */
export function resolveAgentModel(
  agentDef: AgentDefinition,
  parentProviderId?: string,
  parentModel?: string
): AgentRoutingResult {
  let finalProviderId = parentProviderId;
  let finalModel = agentDef.model || parentModel;

  const resolvedParent = resolveProvider({ providerId: parentProviderId, model: parentModel });
  if (resolvedParent._isMultiHead) {
    let useCase: 'default' | 'reasoning' | 'small' | 'sonnet' | 'opus' | 'haiku' = 'default';
    if (['architect', 'planner', 'critic', 'analyst', 'code-reviewer'].includes(agentDef.id)) {
      useCase = 'opus';
    } else if (['explore', 'search', 'writer', 'document-specialist'].includes(agentDef.id)) {
      useCase = 'haiku';
    } else {
      useCase = 'sonnet';
    }

    const mappedTarget = resolvedParent.roleModels[useCase] || resolvedParent.roleModels.default;
    if (mappedTarget && mappedTarget.includes(':')) {
      const [targetProviderId, ...targetModelParts] = mappedTarget.split(':');
      finalProviderId = targetProviderId;
      finalModel = targetModelParts.join(':');
      console.log(`[agent-routing] multi_head routed agent="${agentDef.id}" useCase=${useCase} → provider=${targetProviderId} model=${finalModel}`);
    } else if (mappedTarget) {
      // roleModel value doesn't have provider:model format — use as model name with parent provider
      finalModel = mappedTarget;
      console.log(`[agent-routing] multi_head routed agent="${agentDef.id}" useCase=${useCase} → model=${mappedTarget} (parent provider)`);
    } else {
      console.warn(`[agent-routing] multi_head no mapping for useCase=${useCase}, falling back to parentModel=${parentModel}`);
    }
  }

  return { providerId: finalProviderId, model: finalModel };
}