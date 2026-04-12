/**
 * orchestration-routing.ts
 *
 * Shared routing helpers for Team Mode orchestration.
 */

export type OrchestrationTier = 'single' | 'dual' | 'multi';

/**
 * 中文注释：功能名称「按协作层级解析角色模型」。
 * 用法：single 返回当前会话模型，dual/multi 返回用于 role mapping 的语义别名（opus/sonnet/haiku）或本地验证模型。
 */
export function resolveAgentModelForTier(
  agentId: string,
  tier: OrchestrationTier,
  parentModel?: string,
): { model?: string } {
  if (tier === 'single') return { model: parentModel };

  if (tier === 'dual') {
    if (agentId === 'verifier') return { model: 'Qwen3.5-35B-A3B-8bit' };
    return { model: 'opus' };
  }

  if (tier === 'multi') {
    switch (agentId) {
      case 'architect':
        return { model: 'opus' };
      case 'researcher':
        return { model: 'haiku' };
      case 'verifier':
        return { model: 'Qwen3.5-35B-A3B-8bit' };
      case 'executor':
      case 'general':
      default:
        return { model: 'sonnet' };
    }
  }

  return { model: parentModel };
}

