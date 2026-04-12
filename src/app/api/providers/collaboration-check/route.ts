import { NextRequest, NextResponse } from 'next/server';
import { findProviderIdByModel, getProvider } from '@/lib/db';
import { resolveProvider, toAiSdkConfig } from '@/lib/provider-resolver';
import { resolveAgentModelForTier, type OrchestrationTier } from '@/lib/orchestration-routing';

type RoleCheck = {
  role: string;
  agent: string;
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
  parentModel?: string,
): RoleCheck {
  const requestedModel = resolveAgentModelForTier(agent, tier, parentModel).model || parentModel || '';
  const routedProviderId = requestedModel ? (findProviderIdByModel(requestedModel) || providerId) : providerId;
  const resolved = resolveProvider({ providerId: routedProviderId, model: requestedModel || undefined });
  const aiConfig = toAiSdkConfig(resolved, requestedModel || undefined);

  return {
    role,
    agent,
    requestedModel: requestedModel || '(empty)',
    providerId: routedProviderId || '',
    providerName: resolved.provider?.name || routedProviderId || 'env',
    resolvedModel: resolved.model || '(empty)',
    apiModel: aiConfig.modelId || '(empty)',
  };
}

/**
 * GET /api/providers/collaboration-check?providerId=xxx
 * Returns the final routing matrix for single/dual/multi orchestration.
 */
export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId') || '';
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
    buildRoleCheck(providerId, 'lead', 'Single', 'single', parentModel),
  ];
  const dual = [
    buildRoleCheck(providerId, 'lead', 'Lead', 'dual', parentModel),
    buildRoleCheck(providerId, 'verifier', 'Verifier', 'dual', parentModel),
  ];
  const multi = [
    buildRoleCheck(providerId, 'researcher', 'Researcher', 'multi', parentModel),
    buildRoleCheck(providerId, 'architect', 'Architect', 'multi', parentModel),
    buildRoleCheck(providerId, 'executor', 'Executor', 'multi', parentModel),
    buildRoleCheck(providerId, 'verifier', 'Verifier', 'multi', parentModel),
  ];

  const warnings: string[] = [];
  const multiApiModels = new Set(multi.map((item) => item.apiModel));
  if (multiApiModels.size <= 2) {
    warnings.push('多模型模式实际命中的 API 模型较少，可能仍存在映射重叠。');
  }
  if (multi.filter((item) => item.providerId === providerId).length === multi.length) {
    warnings.push('多模型模式全部落在同一个 Provider，请确认该 Provider 内部 role mapping 是否已区分 Researcher / Architect / Executor。');
  }

  // 中文注释：功能名称「返回协作自检矩阵」，用法是在设置页一键查看 single/dual/multi 最终命中的 provider 与 model。
  return NextResponse.json({
    provider: {
      id: provider.id,
      name: provider.name,
      defaultModel: parentModel || '(empty)',
    },
    matrix: { single, dual, multi },
    warnings,
  });
}

