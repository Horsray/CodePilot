import { NextRequest, NextResponse } from 'next/server';
import { findProviderIdByModel, getProvider, getProviderOptions } from '@/lib/db';
import { getCollaborationProfileLabel, resolveCollaborationBinding } from '@/lib/collaboration-strategy';
import { resolveProvider, toAiSdkConfig } from '@/lib/provider-resolver';
import { resolveAgentModelForTier, type OrchestrationTier } from '@/lib/orchestration-routing';

type RoleCheck = {
  role: string;
  agent: string;
  profileName: string;
  requestedModel: string;
  providerId: string;
  providerName: string;
  resolvedModel: string;
  apiModel: string;
};

function buildRoleCheck(
  providerId: string,
  agent: string,
  role: string,
  tier: OrchestrationTier,
  profileId: string | undefined,
  parentModel?: string,
): RoleCheck {
  const strategy = getProviderOptions('__global__').collaboration_strategy;
  const fallbackModel = resolveAgentModelForTier(agent, tier, parentModel).model || parentModel || '';
  const binding = resolveCollaborationBinding({
    strategy,
    tier,
    role: agent as import('@/types').CollaborationRole,
    profileId,
    fallbackProviderId: providerId,
    fallbackModel,
  });
  const requestedModel = binding.model || fallbackModel || '';
  const routedProviderId = binding.providerId || (requestedModel ? (findProviderIdByModel(requestedModel) || providerId) : providerId);
  const resolved = resolveProvider({ providerId: routedProviderId, model: requestedModel || undefined });
  const aiConfig = toAiSdkConfig(resolved, requestedModel || undefined);
  const profileName = getCollaborationProfileLabel(strategy, profileId);

  return {
    role,
    agent,
    profileName,
    requestedModel: requestedModel || '(empty)',
    providerId: routedProviderId || '',
    providerName: resolved.provider?.name || routedProviderId || 'env',
    resolvedModel: resolved.model || '(empty)',
    apiModel: aiConfig.modelId || '(empty)',
  };
}

/**
 * GET /api/providers/collaboration-check?providerId=xxx
 * Returns the final routing matrix for single/multi orchestration.
 */
export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId') || '';
  const profileId = request.nextUrl.searchParams.get('profileId') || undefined;
  if (!providerId) {
    return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  const baseResolved = resolveProvider({ providerId });
  const parentModel = baseResolved.roleModels.default || baseResolved.model || '';

  const single = [
    buildRoleCheck(providerId, 'team-leader', '单模型', 'single', profileId, parentModel),
  ];
  const multi = [
    buildRoleCheck(providerId, 'team-leader', '总指挥', 'multi', profileId, parentModel),
    buildRoleCheck(providerId, 'knowledge-searcher', '知识检索', 'multi', profileId, parentModel),
    buildRoleCheck(providerId, 'vision-understanding', '视觉理解', 'multi', profileId, parentModel),
    buildRoleCheck(providerId, 'worker-executor', '工作执行', 'multi', profileId, parentModel),
    buildRoleCheck(providerId, 'quality-inspector', '质量检验', 'multi', profileId, parentModel),
    buildRoleCheck(providerId, 'expert-consultant', '专家顾问', 'multi', profileId, parentModel),
  ];

  const warnings: string[] = [];
  const multiApiModels = new Set(multi.map((item) => item.apiModel));
  if (multiApiModels.size <= 2) {
    warnings.push('多模型模式实际命中的 API 模型较少，可能仍存在映射重叠。');
  }
  if (multi.filter((item) => item.providerId === providerId).length === multi.length) {
    warnings.push('多模型模式全部落在同一个 Provider，请确认该 Provider 内部 role mapping 是否已区分知识检索 / 视觉理解 / 工作执行 / 质量检验 / 专家顾问。');
  }

  // 中文注释：功能名称「返回协作自检矩阵」，用法是在设置页一键查看 single/multi 最终命中的 provider 与 model。
  return NextResponse.json({
    provider: {
      id: provider.id,
      name: provider.name,
      defaultModel: parentModel || '(empty)',
    },
    matrix: { single, multi },
    warnings,
  });
}
