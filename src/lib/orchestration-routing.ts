/**
 * orchestration-routing.ts
 *
 * Shared routing helpers for Team Mode orchestration.
 */

export type OrchestrationTier = 'single' | 'multi';

/**
 * 中文注释：功能名称「按协作层级解析角色模型」。
 * 用法：single 返回当前会话模型，多模型返回用于角色映射的语义别名槽位。
 */
export function resolveAgentModelForTier(
  agentId: string,
  tier: OrchestrationTier,
  parentModel?: string,
): { model?: string } {
  if (tier === 'single') return { model: parentModel };

  if (tier === 'multi') {
    switch (agentId) {
      case 'team-leader':
        return { model: 'opus' };
      case 'knowledge-searcher':
      case 'search':
      case 'explore':
        return { model: 'haiku' };
      case 'vision-understanding':
      case 'vision':
        return { model: 'vision' };
      case 'expert-consultant':
      case 'expert':
        return { model: 'opus' };
      case 'quality-inspector':
        return { model: 'Qwen3.5-35B-A3B-8bit' };
      case 'worker-executor':
      case 'general':
      default:
        return { model: 'sonnet' };
    }
  }

  return { model: parentModel };
}
