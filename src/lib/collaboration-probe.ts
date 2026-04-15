import { findPresetForLegacy } from './provider-catalog';
import { getProvider, getProviderOptions } from './db';
import { ensureCollaborationStrategyShape, getCollaborationProfileLabel } from './collaboration-strategy';
import { resolveProvider } from './provider-resolver';
import type { CollaborationRole } from '@/types';

const ROLE_META: Array<{ role: CollaborationRole; label: string }> = [
  { role: 'team-leader', label: '总指挥' },
  { role: 'worker-executor', label: '工作执行' },
  { role: 'quality-inspector', label: '质量检验' },
  { role: 'expert-consultant', label: '专家顾问' },
];

export type CollaborationProbePlanRow = {
  roleKey: CollaborationRole;
  role: string;
  providerName: string;
  resolvedModel: string;
  apiModel: string;
  status: 'ready' | 'unconfigured';
  note?: string;
  providerId?: string;
  providerBaseUrl?: string;
  providerApiKey?: string;
  protocol?: string;
  authStyle?: string;
  envOverrides?: Record<string, string>;
  presetKey?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
};

export function resolveCollaborationProbePlan(params: {
  profileId: string;
  fallbackProviderId: string;
}): {
  profileId: string;
  profileName: string;
  rows: CollaborationProbePlanRow[];
} {
  const { profileId, fallbackProviderId } = params;
  const strategy = ensureCollaborationStrategyShape(getProviderOptions('__global__').collaboration_strategy);
  const profileName = getCollaborationProfileLabel(strategy, profileId);
  const activeProfile =
    strategy.profiles.find((profile) => profile.id === profileId) ||
    strategy.profiles.find((profile) => profile.id === strategy.defaultProfileId) ||
    strategy.profiles[0];

  const rows: CollaborationProbePlanRow[] = ROLE_META.map((item) => {
    const binding = activeProfile?.roles?.[item.role];

    if (!binding.providerId || !binding.model) {
      return {
        roleKey: item.role,
        role: item.label,
        providerName: binding?.providerId ? (getProvider(binding.providerId)?.name || binding.providerId) : '未配置',
        resolvedModel: binding?.model || '(empty)',
        apiModel: binding?.model || '(empty)',
        status: 'unconfigured',
        note: '该角色尚未显式配置 Provider 与模型，当前不会用回退链路冒充可用。',
      };
    }

    const provider = getProvider(binding.providerId);
    const resolved = resolveProvider({ providerId: binding.providerId, model: binding.model });
    const preset = provider ? findPresetForLegacy(provider.base_url, provider.provider_type, resolved.protocol as never) : undefined;

    return {
      roleKey: item.role,
      role: item.label,
      providerName: provider?.name || binding.providerId,
      resolvedModel: resolved.model || binding.model,
      apiModel: resolved.upstreamModel || resolved.model || binding.model,
      status: 'ready',
      providerId: binding.providerId,
      providerBaseUrl: provider?.base_url || '',
      providerApiKey: provider?.api_key || '',
      protocol: resolved.protocol,
      authStyle: resolved.authStyle,
      envOverrides: resolved.envOverrides,
      presetKey: preset?.key,
      providerMeta: preset?.meta ? {
        apiKeyUrl: preset.meta.apiKeyUrl,
        docsUrl: preset.meta.docsUrl,
        pricingUrl: preset.meta.pricingUrl,
      } : undefined,
    };
  });

  return { profileId, profileName, rows };
}
