import { NextRequest, NextResponse } from 'next/server';
import { testProviderConnection } from '@/lib/claude-client';
import { getProvider } from '@/lib/db';
import { resolveCollaborationProbePlan } from '@/lib/collaboration-probe';
import type { ErrorResponse } from '@/types';

type ProbeRow = {
  role: string;
  providerName: string;
  resolvedModel: string;
  apiModel: string;
  status: 'success' | 'failed' | 'unconfigured';
  success: boolean;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    recoveryActions?: Array<{ label: string; url?: string; action?: string }>;
  };
  note?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    const fallbackProviderId = typeof body.providerId === 'string' ? body.providerId : '';
    if (!profileId) {
      return NextResponse.json({ error: 'profileId is required' } as ErrorResponse, { status: 400 });
    }
    if (!fallbackProviderId) {
      return NextResponse.json({ error: 'providerId is required' } as ErrorResponse, { status: 400 });
    }

    const fallbackProvider = getProvider(fallbackProviderId);
    if (!fallbackProvider) {
      return NextResponse.json({ error: 'Fallback provider not found' } as ErrorResponse, { status: 404 });
    }

    const plan = resolveCollaborationProbePlan({ profileId, fallbackProviderId });

    const results: ProbeRow[] = [];
    for (const row of plan.rows) {
      if (row.status === 'unconfigured') {
        results.push({
          role: row.role,
          providerName: row.providerName,
          resolvedModel: row.resolvedModel,
          apiModel: row.apiModel,
          status: 'unconfigured',
          success: false,
          error: {
            code: 'CONFIG_MISSING',
            message: '该角色尚未完整配置 Provider 与模型',
            suggestion: '请先为该角色选择 Provider 和模型，再重新执行探测。',
          },
          note: row.note,
        });
        continue;
      }

      const probe = await testProviderConnection({
        apiKey: row.providerApiKey || '',
        baseUrl: row.providerBaseUrl || '',
        protocol: row.protocol || 'anthropic',
        authStyle: row.authStyle || 'api_key',
        envOverrides: row.envOverrides || {},
        modelName: row.apiModel,
        presetKey: row.presetKey,
        providerName: row.providerName,
        providerMeta: row.providerMeta,
      });

      results.push({
        role: row.role,
        providerName: row.providerName,
        resolvedModel: row.resolvedModel,
        apiModel: row.apiModel,
        status: probe.success ? 'success' : 'failed',
        success: probe.success,
        error: probe.success ? undefined : probe.error,
        note: row.note,
      });
    }

    const successCount = results.filter((row) => row.status === 'success').length;
    const failedCount = results.filter((row) => row.status === 'failed').length;
    const unconfiguredCount = results.filter((row) => row.status === 'unconfigured').length;
    const health =
      failedCount > 0 ? 'failing'
      : unconfiguredCount > 0 ? 'degraded'
      : 'healthy';

    return NextResponse.json({
      profileId: plan.profileId,
      profileName: plan.profileName,
      total: results.length,
      successCount,
      failedCount,
      unconfiguredCount,
      health,
      summary:
        health === 'healthy'
          ? '所有角色模型均已连通，可用于团队协作。'
          : health === 'degraded'
            ? '部分角色尚未完整配置，请先补齐再用于完整团队协作。'
            : '存在连通性失败的角色，建议先修复后再启用该配置。',
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to probe collaboration models', details: String(err) } as ErrorResponse,
      { status: 500 },
    );
  }
}
