import type {
  CollaborationBinding,
  CollaborationProfile,
  CollaborationRole,
  CollaborationStrategy,
} from '@/types';

export type CollaborationTier = 'single' | 'multi';

const ROLE_ORDER: CollaborationRole[] = [
  'team-leader',
  'worker-executor',
  'quality-inspector',
  'expert-consultant',
];

function emptyRoles(): Record<CollaborationRole, CollaborationBinding> {
  return {
    'team-leader': {},
    'worker-executor': {},
    'quality-inspector': {},
    'expert-consultant': {},
  };
}

export function createDefaultCollaborationProfiles(): CollaborationProfile[] {
  return [
    {
      id: 'low-cost',
      name: '低成本',
      roles: emptyRoles(),
    },
    {
      id: 'high-performance',
      name: '高性能',
      roles: emptyRoles(),
    },
  ];
}

export function ensureCollaborationStrategyShape(strategy?: CollaborationStrategy | Record<string, unknown> | null): CollaborationStrategy {
  const defaults = createDefaultCollaborationProfiles();
  const profiles = Array.isArray((strategy as CollaborationStrategy | undefined)?.profiles)
    ? ((strategy as CollaborationStrategy).profiles || []).map((profile, index) => ({
        id: profile.id || `custom-${index + 1}`,
        name: profile.name || `自定义配置${index + 1}`,
        roles: { ...emptyRoles(), ...(profile.roles || {}) },
      }))
    : [];

  if (profiles.length > 0) {
    return {
      profiles,
      defaultProfileId:
        (strategy as CollaborationStrategy | undefined)?.defaultProfileId ||
        profiles[0]?.id ||
        defaults[0].id,
    };
  }

  // Legacy migration: dual/multi -> profiles
  const legacy = strategy as {
    dual?: { lead?: CollaborationBinding; verifier?: CollaborationBinding };
    multi?: {
      researcher?: CollaborationBinding;
      architect?: CollaborationBinding;
      executor?: CollaborationBinding;
      verifier?: CollaborationBinding;
      lead?: CollaborationBinding;
    };
  } | undefined;

  const migratedProfiles = defaults.map((profile, index) => ({
    ...profile,
    roles: {
      ...profile.roles,
      'worker-executor': legacy?.multi?.executor || legacy?.dual?.lead || {},
      'quality-inspector': legacy?.multi?.verifier || legacy?.dual?.verifier || {},
    },
    name: profile.name || `自定义配置${index + 1}`,
  }));

  return {
    profiles: migratedProfiles,
    defaultProfileId: migratedProfiles[0].id,
  };
}

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
  profileId?: string;
  fallbackProviderId?: string;
  fallbackModel?: string;
}): CollaborationBinding {
  const { strategy, tier, role, profileId, fallbackProviderId, fallbackModel } = params;
  if (tier === 'single') {
    return normalizeBinding(undefined, fallbackProviderId, fallbackModel);
  }

  const next = ensureCollaborationStrategyShape(strategy);
  const activeProfile =
    next.profiles.find((profile) => profile.id === profileId) ||
    next.profiles.find((profile) => profile.id === next.defaultProfileId) ||
    next.profiles[0];
  const binding = activeProfile?.roles?.[role];
  return normalizeBinding(binding, fallbackProviderId, fallbackModel);
}

export function getCollaborationProfileLabel(strategy: CollaborationStrategy | undefined, profileId?: string): string {
  const next = ensureCollaborationStrategyShape(strategy);
  const activeProfile =
    next.profiles.find((profile) => profile.id === profileId) ||
    next.profiles.find((profile) => profile.id === next.defaultProfileId) ||
    next.profiles[0];
  return activeProfile?.name || '低成本';
}

export function getCollaborationRoles(): CollaborationRole[] {
  return [...ROLE_ORDER];
}
