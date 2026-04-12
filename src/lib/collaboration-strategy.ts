import type { CollaborationBinding, CollaborationStrategy } from '@/types';

export type CollaborationTier = 'single' | 'dual' | 'multi';
export type CollaborationRole = 'lead' | 'verifier' | 'researcher' | 'architect' | 'executor';

function normalizeBinding(binding?: CollaborationBinding, fallbackProviderId?: string, fallbackModel?: string): CollaborationBinding {
  return {
    providerId: binding?.providerId || fallbackProviderId,
    model: binding?.model || fallbackModel,
  };
}

/**
 * 中文注释：功能名称「按层级和角色解析协作绑定」。
 * 用法：让主模型与子 Agent 使用同一份全局协作策略来选择服务商与模型。
 */
export function resolveCollaborationBinding(params: {
  strategy?: CollaborationStrategy;
  tier: CollaborationTier;
  role: CollaborationRole;
  fallbackProviderId?: string;
  fallbackModel?: string;
}): CollaborationBinding {
  const { strategy, tier, role, fallbackProviderId, fallbackModel } = params;
  if (tier === 'single') {
    return normalizeBinding(undefined, fallbackProviderId, fallbackModel);
  }

  if (tier === 'dual') {
    const binding = role === 'verifier'
      ? strategy?.dual?.verifier
      : strategy?.dual?.lead;
    return normalizeBinding(binding, fallbackProviderId, fallbackModel);
  }

  const binding = role === 'researcher'
    ? strategy?.multi?.researcher
    : role === 'architect'
      ? strategy?.multi?.architect
      : role === 'verifier'
        ? strategy?.multi?.verifier
        : strategy?.multi?.executor;
  return normalizeBinding(binding, fallbackProviderId, fallbackModel);
}

