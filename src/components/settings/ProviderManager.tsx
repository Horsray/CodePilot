"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SpinnerGap, PencilSimple, Stethoscope, CheckCircle } from "@/components/ui/icon";
import { ProviderForm } from "./ProviderForm";
import { ProviderDoctorDialog } from "./ProviderDoctorDialog";
import type { ProviderFormData } from "./ProviderForm";
import { PresetConnectDialog } from "./PresetConnectDialog";
import {
  QUICK_PRESETS,
  GEMINI_IMAGE_MODELS,
  getGeminiImageModel,
  getProviderIcon,
  findMatchingPreset,
  type QuickPreset,
} from "./provider-presets";
import type {
  ApiProvider,
  ProviderModelGroup,
  CollaborationBinding,
  CollaborationProfile,
  CollaborationRole,
  CollaborationStrategy,
} from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import Anthropic from "@lobehub/icons/es/Anthropic";
import { isOfficialGeminiImageProvider } from "@/lib/image-provider-utils";
import { ProviderOptionsSection } from "./ProviderOptionsSection";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDefaultCollaborationProfiles,
  ensureCollaborationStrategyShape,
  getCollaborationRoles,
} from "@/lib/collaboration-strategy";

const ROLE_META: Array<{ key: CollaborationRole; label: string; alias: string; hint: string }> = [
  { key: 'team-leader', label: '总指挥', alias: 'opus', hint: '主任务理解、编排与汇总' },
  { key: 'worker-executor', label: '工作执行', alias: 'sonnet', hint: '实现、修改、落地' },
  { key: 'quality-inspector', label: '质量检验', alias: 'verifier', hint: '测试、验证、回归检查' },
  { key: 'expert-consultant', label: '专家顾问', alias: 'expert', hint: '复杂疑难、连续失败、争议判断升级' },
];

function createEmptyStrategy(): CollaborationStrategy {
  const profiles = createDefaultCollaborationProfiles();
  return { profiles, defaultProfileId: profiles[0]?.id };
}

function updateStrategyBinding(
  strategy: CollaborationStrategy,
  profileId: string,
  role: CollaborationRole,
  patch: Partial<CollaborationBinding>,
): CollaborationStrategy {
  const next = ensureCollaborationStrategyShape(strategy);
  return {
    ...next,
    profiles: next.profiles.map((profile) => (
      profile.id === profileId
        ? {
            ...profile,
            roles: {
              ...profile.roles,
              [role]: { ...(profile.roles?.[role] || {}), ...patch },
            },
          }
        : profile
    )),
  };
}

function renameStrategyProfile(
  strategy: CollaborationStrategy,
  profileId: string,
  name: string,
): CollaborationStrategy {
  const next = ensureCollaborationStrategyShape(strategy);
  return {
    ...next,
    profiles: next.profiles.map((profile) => (
      profile.id === profileId ? { ...profile, name } : profile
    )),
  };
}

function addStrategyProfile(strategy: CollaborationStrategy): CollaborationStrategy {
  const next = ensureCollaborationStrategyShape(strategy);
  const newIndex = next.profiles.length + 1;
  const profile: CollaborationProfile = {
    id: `custom-${Date.now()}`,
    name: `自定义配置${newIndex}`,
    roles: createDefaultCollaborationProfiles()[0].roles,
  };
  return { ...next, profiles: [...next.profiles, profile] };
}

type CollaborationCheckResult = {
  provider: { id: string; name: string; defaultModel: string };
  matrix: {
    single: Array<{ role: string; profileName: string; providerName: string; resolvedModel: string; apiModel: string }>;
    multi: Array<{ role: string; profileName: string; providerName: string; resolvedModel: string; apiModel: string }>;
  };
  warnings: string[];
};

type CollaborationProbeResult = {
  profileId: string;
  profileName: string;
  total: number;
  successCount: number;
  failedCount: number;
  unconfiguredCount: number;
  health: 'healthy' | 'degraded' | 'failing';
  summary: string;
  results: Array<{
    role: string;
    providerName: string;
    resolvedModel: string;
    apiModel: string;
    success: boolean;
    status: 'success' | 'failed' | 'unconfigured';
    note?: string;
    error?: {
      code: string;
      message: string;
      suggestion?: string;
      recoveryActions?: Array<{ label: string; url?: string; action?: string }>;
    };
  }>;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProviderManager() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [envDetected, setEnvDetected] = useState<Record<string, string>>({});
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  // Edit dialog state — fallback ProviderForm for providers that don't match any preset
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);

  // Preset connect/edit dialog state
  const [connectPreset, setConnectPreset] = useState<QuickPreset | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [presetEditProvider, setPresetEditProvider] = useState<ApiProvider | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);
  const [deleting, setDeleting] = useState(false);

  // OpenAI OAuth state
  const [openaiAuth, setOpenaiAuth] = useState<{ authenticated: boolean; email?: string; plan?: string } | null>(null);
  const [openaiLoggingIn, setOpenaiLoggingIn] = useState(false);
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  // Doctor dialog state
  const [doctorOpen, setDoctorOpen] = useState(false);

  // Global default model state
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [globalDefaultProvider, setGlobalDefaultProvider] = useState('');
  const [collaborationStrategy, setCollaborationStrategy] = useState<CollaborationStrategy>(createEmptyStrategy());
  const [collaborationChecks, setCollaborationChecks] = useState<Record<string, { loading: boolean; result?: CollaborationCheckResult; error?: string }>>({});
  const [collaborationProbes, setCollaborationProbes] = useState<Record<string, { loading: boolean; result?: CollaborationProbeResult; error?: string }>>({});

  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();
      setProviders(data.providers || []);
      setEnvDetected(data.env_detected || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  // Fetch OpenAI OAuth status
  useEffect(() => {
    fetch('/api/openai-oauth/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setOpenaiAuth(data); })
      .catch(() => {});
  }, []);

  // Fetch all provider models for the global default model selector
  const fetchModels = useCallback(() => {
    fetch('/api/providers/models')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.groups) setProviderGroups(data.groups);
      })
      .catch(() => {});
    // Load current global default model
    fetch('/api/providers/options?providerId=__global__')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.options?.default_model) {
          setGlobalDefaultModel(data.options.default_model);
          setGlobalDefaultProvider(data.options.default_model_provider || '');
        }
        setCollaborationStrategy(ensureCollaborationStrategyShape(data?.options?.collaboration_strategy));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchModels();
    const handler = () => fetchModels();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchModels]);

  const handleEdit = (provider: ApiProvider) => {
    // Try to match provider to a quick preset for a cleaner edit experience
    const matchedPreset = findMatchingPreset(provider);
    if (matchedPreset) {
      // Clear stale generic-form state to prevent handleEditSave picking the wrong target
      setEditingProvider(null);
      setConnectPreset(matchedPreset);
      setPresetEditProvider(provider);
      setConnectDialogOpen(true);
    } else {
      // Clear stale preset-edit state
      setPresetEditProvider(null);
      setEditingProvider(provider);
      setFormOpen(true);
    }
  };

  const handleEditSave = async (data: ProviderFormData) => {
    const target = presetEditProvider || editingProvider;
    if (!target) return;
    const res = await fetch(`/api/providers/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to update provider");
    }
    const result = await res.json();
    setProviders((prev) => prev.map((p) => (p.id === target.id ? result.provider : p)));
    window.dispatchEvent(new Event("provider-changed"));
  };

  const handlePresetAdd = async (data: ProviderFormData) => {
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to create provider");
    }
    const result = await res.json();
    const newProvider: ApiProvider = result.provider;
    setProviders((prev) => [...prev, newProvider]);

    window.dispatchEvent(new Event("provider-changed"));
  };

  const handleOpenPresetDialog = (preset: QuickPreset) => {
    setConnectPreset(preset);
    setPresetEditProvider(null); // ensure create mode
    setConnectDialogOpen(true);
  };

  const handleDisconnect = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setProviders((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        window.dispatchEvent(new Event("provider-changed"));
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleImageModelChange = useCallback(async (provider: ApiProvider, model: string) => {
    try {
      const env = JSON.parse(provider.extra_env || '{}');
      env.GEMINI_IMAGE_MODEL = model;
      const newExtraEnv = JSON.stringify(env);
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          extra_env: newExtraEnv,
          notes: provider.notes,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setProviders(prev => prev.map(p => p.id === provider.id ? result.provider : p));
        window.dispatchEvent(new Event('provider-changed'));
      }
    } catch { /* ignore */ }
  }, []);

  const handleOpenAILogin = async () => {
    setOpenaiLoggingIn(true);
    setOpenaiError(null);
    try {
      const res = await fetch("/api/openai-oauth/start");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start OAuth');
      }
      const { authUrl } = await res.json();
      window.open(authUrl, '_blank');

      // Poll for completion with timeout
      let pollCount = 0;
      const maxPolls = 150; // 5 minutes at 2s intervals
      const poll = setInterval(async () => {
        pollCount++;
        if (pollCount >= maxPolls) {
          clearInterval(poll);
          setOpenaiLoggingIn(false);
          setOpenaiError(isZh ? '登录超时，请重试' : 'Login timed out, please try again');
          return;
        }
        try {
          const statusRes = await fetch("/api/openai-oauth/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.authenticated) {
              clearInterval(poll);
              setOpenaiAuth(status);
              setOpenaiLoggingIn(false);
              fetchModels(); // refresh model list to include OpenAI models
            }
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (err) {
      setOpenaiLoggingIn(false);
      setOpenaiError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleOpenAILogout = async () => {
    try {
      await fetch("/api/openai-oauth/status", { method: "DELETE" });
      setOpenaiAuth({ authenticated: false });
      fetchModels(); // refresh model list
    } catch { /* ignore */ }
  };

  const sorted = [...providers].sort((a, b) => a.sort_order - b.sort_order);
  const collaborationGroups = useMemo(
    () => providerGroups.filter((group) =>
      group.provider_id !== 'env'
      && group.provider_type !== 'gemini-image'
      && group.provider_type !== 'generic-image'
      && group.models.length > 0
    ),
    [providerGroups],
  );

  // Save global default model — also syncs default_provider_id for backend consumers
  const handleGlobalDefaultModelChange = useCallback(async (compositeValue: string) => {
    if (compositeValue === '__auto__') {
      setGlobalDefaultModel('');
      setGlobalDefaultProvider('');
      // Clear both global default model AND legacy default_provider_id in one call
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: '__global__',
          options: { default_model: '', default_model_provider: '', legacy_default_provider_id: '' },
        }),
      }).catch(() => {});
    } else {
      // compositeValue format: "providerId::modelValue"
      const sepIdx = compositeValue.indexOf('::');
      const pid = compositeValue.slice(0, sepIdx);
      const model = compositeValue.slice(sepIdx + 2);
      setGlobalDefaultModel(model);
      setGlobalDefaultProvider(pid);
      // Write global default model + sync legacy default_provider_id in one call
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: '__global__',
          options: { default_model: model, default_model_provider: pid, legacy_default_provider_id: pid },
        }),
      }).catch(() => {});
    }
    window.dispatchEvent(new Event('provider-changed'));
  }, []);

  const saveCollaborationStrategy = useCallback(async (next: CollaborationStrategy) => {
    setCollaborationStrategy(next);
    await fetch('/api/providers/options', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: '__global__',
        options: { collaboration_strategy: next },
      }),
    }).catch(() => {});
    window.dispatchEvent(new Event('provider-changed'));
  }, []);

  const updateBinding = useCallback(async (
    profileId: string,
    role: CollaborationRole,
    patch: Partial<CollaborationBinding>,
  ) => {
    const next = updateStrategyBinding(collaborationStrategy, profileId, role, patch);
    await saveCollaborationStrategy(next);
  }, [collaborationStrategy, saveCollaborationStrategy]);

  const verifyCollaborationProfile = useCallback(async (profileId: string) => {
    const baseProviderId = globalDefaultProvider || collaborationGroups[0]?.provider_id || '';
    if (!baseProviderId) {
      setCollaborationChecks((prev) => ({
        ...prev,
        [profileId]: { loading: false, error: '请先至少配置一个可用 Provider，并设置默认模型或默认 Provider。' },
      }));
      return;
    }

    setCollaborationChecks((prev) => ({ ...prev, [profileId]: { loading: true } }));
    try {
      const res = await fetch(`/api/providers/collaboration-check?providerId=${encodeURIComponent(baseProviderId)}&profileId=${encodeURIComponent(profileId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '验证失败');
      setCollaborationChecks((prev) => ({ ...prev, [profileId]: { loading: false, result: data } }));
    } catch (err) {
      setCollaborationChecks((prev) => ({
        ...prev,
        [profileId]: { loading: false, error: err instanceof Error ? err.message : '验证失败' },
      }));
    }
  }, [collaborationGroups, globalDefaultProvider]);

  const probeCollaborationProfile = useCallback(async (profileId: string) => {
    const baseProviderId = globalDefaultProvider || collaborationGroups[0]?.provider_id || '';
    if (!baseProviderId) {
      setCollaborationProbes((prev) => ({
        ...prev,
        [profileId]: { loading: false, error: '请先至少配置一个可用 Provider，并设置默认模型或默认 Provider。' },
      }));
      return;
    }

    setCollaborationProbes((prev) => ({ ...prev, [profileId]: { loading: true } }));
    try {
      const res = await fetch('/api/providers/collaboration-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, providerId: baseProviderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '探测失败');
      setCollaborationProbes((prev) => ({ ...prev, [profileId]: { loading: false, result: data } }));
    } catch (err) {
      setCollaborationProbes((prev) => ({
        ...prev,
        [profileId]: { loading: false, error: err instanceof Error ? err.message : '探测失败' },
      }));
    }
  }, [collaborationGroups, globalDefaultProvider]);

  const getGroupByProviderId = useCallback((providerId?: string) => {
    return collaborationGroups.find((group) => group.provider_id === providerId);
  }, [collaborationGroups]);

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* ─── Section 0: Troubleshooting + Default Model ─── */}
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{isZh ? '连接诊断' : 'Connection Diagnostics'}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isZh
                ? '检查 CLI、认证、模型兼容性和网络连接是否正常'
                : 'Check CLI, auth, model compatibility, and network connectivity'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setDoctorOpen(true)}
          >
            <Stethoscope size={14} />
            {isZh ? '运行诊断' : 'Run Diagnostics'}
          </Button>
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 my-3" />

        {/* Global default model */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{t('settings.defaultModel' as TranslationKey)}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settings.defaultModelDesc' as TranslationKey)}
            </p>
          </div>
          {providerGroups.length > 0 && (
            <Select
              value={globalDefaultModel ? `${globalDefaultProvider}::${globalDefaultModel}` : '__auto__'}
              onValueChange={handleGlobalDefaultModelChange}
            >
              <SelectTrigger className="w-[160px] h-7 text-[11px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">
                  {t('settings.defaultModelAuto' as TranslationKey)}
                </SelectItem>
                {providerGroups.map(group => (
                  <SelectGroup key={group.provider_id}>
                    <SelectLabel className="text-[10px] text-muted-foreground">
                      {group.provider_name}
                    </SelectLabel>
                    {group.models.map(m => (
                      <SelectItem
                        key={`${group.provider_id}::${m.value}`}
                        value={`${group.provider_id}::${m.value}`}
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* 中文注释：功能名称「全局协作策略配置面板」，用法是在一个面板里配置多模型配置集及五角色路由。 */}
      {!loading && (
        <div className="rounded-lg border border-border/50 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium">协作策略配置</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              单模型不需要配置；多模型模式在这里直接配置多套方案。每套方案都可以重命名，并为五个角色分别指定服务商与模型。
            </p>
          </div>

          {collaborationGroups.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  默认预置两套方案：多模型-低成本、多模型-高性能。你也可以继续新增自定义配置。
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void saveCollaborationStrategy(addStrategyProfile(collaborationStrategy))}
                >
                  新增自定义配置
                </Button>
              </div>

              {ensureCollaborationStrategyShape(collaborationStrategy).profiles.map((profile) => (
                <div key={profile.id} className="rounded-md border border-border/30 bg-muted/10 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">多模型-{profile.name}</div>
                      <div className="text-[10px] text-muted-foreground">会话选择框里会显示为“多模型-{profile.name}”</div>
                    </div>
                    <Input
                      value={profile.name}
                      onChange={(e) => {
                        void saveCollaborationStrategy(renameStrategyProfile(collaborationStrategy, profile.id, e.target.value));
                      }}
                      className="h-8 w-[180px] text-xs"
                      placeholder="配置名称"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/20 bg-background/40 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">
                      验证这套配置会告诉你六个角色最终命中的 Provider、解析模型和 API 模型；测试模型连通性会真实探测这些角色模型是否可用。
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => void verifyCollaborationProfile(profile.id)}
                      >
                        {collaborationChecks[profile.id]?.loading ? '验证中...' : '验证此配置'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => void probeCollaborationProfile(profile.id)}
                      >
                        {collaborationProbes[profile.id]?.loading ? '探测中...' : '测试模型连通性'}
                      </Button>
                    </div>
                  </div>

                  {ROLE_META.map((item) => {
                    const binding = profile.roles?.[item.key] || {};
                    const group = getGroupByProviderId(binding.providerId);
                    return (
                      <div key={`${profile.id}-${item.key}`} className="grid gap-2 md:grid-cols-[180px_1fr_1fr] items-center">
                        <div>
                          <div className="text-xs font-medium">{item.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            别名：{item.alias}，{item.hint}
                          </div>
                        </div>
                        <Select
                          value={binding.providerId || '__none__'}
                          onValueChange={(value) => {
                            const selected = collaborationGroups.find((g) => g.provider_id === value);
                            void updateBinding(profile.id, item.key, {
                              providerId: value === '__none__' ? '' : value,
                              model: selected?.models[0]?.value || '',
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="选择服务商" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">未配置</SelectItem>
                            {collaborationGroups.map((group) => (
                              <SelectItem key={`${profile.id}-${item.key}-${group.provider_id}`} value={group.provider_id}>
                                {group.provider_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={binding.model || '__none__'}
                          onValueChange={(value) => void updateBinding(profile.id, item.key, { model: value === '__none__' ? '' : value })}
                          disabled={!group}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">未配置</SelectItem>
                            {(group?.models || []).map((model) => (
                              <SelectItem key={`${profile.id}-${item.key}-${model.value}`} value={model.value}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}

                  {collaborationChecks[profile.id]?.error && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {collaborationChecks[profile.id]?.error}
                    </div>
                  )}

                  {collaborationProbes[profile.id]?.error && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {collaborationProbes[profile.id]?.error}
                    </div>
                  )}

                  {collaborationChecks[profile.id]?.result && (
                    <div className="rounded-md border border-border/20 bg-background/40 overflow-hidden">
                      <div className="border-b border-border/10 px-3 py-2 text-xs font-medium">
                        {`验证结果：多模型-${profile.name}`}
                      </div>
                      <div className="divide-y divide-border/10">
                        {collaborationChecks[profile.id]!.result!.matrix.multi.map((row) => (
                          <div key={`${profile.id}-${row.role}`} className="grid grid-cols-[100px_1fr_1fr_1fr] gap-3 px-3 py-2 text-xs">
                            <div className="font-medium">{row.role}</div>
                            <div className="text-muted-foreground">
                              <span className="mr-1">Provider:</span>
                              <span className="font-mono text-foreground/80">{row.providerName}</span>
                            </div>
                            <div className="text-muted-foreground">
                              <span className="mr-1">Model:</span>
                              <span className="font-mono text-foreground/80">{row.resolvedModel}</span>
                            </div>
                            <div className="text-muted-foreground">
                              <span className="mr-1">API:</span>
                              <span className="font-mono text-foreground/80">{row.apiModel}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {collaborationChecks[profile.id]!.result!.warnings.length > 0 && (
                        <div className="border-t border-border/10 px-3 py-2 text-[11px] text-amber-600 space-y-1">
                          {collaborationChecks[profile.id]!.result!.warnings.map((warning, idx) => (
                            <div key={`${profile.id}-warning-${idx}`}>{warning}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {collaborationProbes[profile.id]?.result && (
                    <div className="rounded-md border border-border/20 bg-background/40 overflow-hidden">
                      <div className="border-b border-border/10 px-3 py-2 text-xs font-medium flex items-center justify-between">
                        <span>{`连通性探测：多模型-${profile.name}`}</span>
                        <Badge
                          variant={
                            collaborationProbes[profile.id]!.result!.health === 'healthy'
                              ? 'default'
                              : collaborationProbes[profile.id]!.result!.health === 'degraded'
                                ? 'secondary'
                                : 'destructive'
                          }
                          className="text-[10px]"
                        >
                          {collaborationProbes[profile.id]!.result!.health === 'healthy'
                            ? '生产可用'
                            : collaborationProbes[profile.id]!.result!.health === 'degraded'
                              ? '需补配置'
                              : '需修复'}
                        </Badge>
                      </div>
                      <div className="border-b border-border/10 px-3 py-2 text-[11px] text-muted-foreground flex flex-wrap gap-3">
                        <span>{`成功 ${collaborationProbes[profile.id]!.result!.successCount}`}</span>
                        <span>{`失败 ${collaborationProbes[profile.id]!.result!.failedCount}`}</span>
                        <span>{`未配置 ${collaborationProbes[profile.id]!.result!.unconfiguredCount}`}</span>
                        <span>{collaborationProbes[profile.id]!.result!.summary}</span>
                      </div>
                      <div className="divide-y divide-border/10">
                        {collaborationProbes[profile.id]!.result!.results.map((row) => (
                          <div key={`${profile.id}-probe-${row.role}`} className="px-3 py-2 text-xs space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{row.role}</div>
                              <Badge
                                variant={row.status === 'success' ? 'default' : row.status === 'unconfigured' ? 'secondary' : 'destructive'}
                                className="text-[10px]"
                              >
                                {row.status === 'success' ? '已连通' : row.status === 'unconfigured' ? '未配置' : '失败'}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 text-muted-foreground">
                              <div><span className="mr-1">Provider:</span><span className="font-mono text-foreground/80">{row.providerName}</span></div>
                              <div><span className="mr-1">Model:</span><span className="font-mono text-foreground/80">{row.resolvedModel}</span></div>
                              <div><span className="mr-1">API:</span><span className="font-mono text-foreground/80">{row.apiModel}</span></div>
                            </div>
                            {row.note && (
                              <div className="text-[11px] text-amber-600">{row.note}</div>
                            )}
                            {!row.success && row.error && (
                              <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 space-y-1">
                                <div className="text-destructive font-medium">{row.error.message}</div>
                                {row.error.suggestion && (
                                  <div className="text-muted-foreground">{`建议：${row.error.suggestion}`}</div>
                                )}
                                {row.error.recoveryActions && row.error.recoveryActions.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {row.error.recoveryActions.map((action, idx) => (
                                      <span key={`${profile.id}-probe-action-${row.role}-${idx}`} className="rounded border border-border/20 px-2 py-0.5 text-[11px] text-muted-foreground">
                                        {action.label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border/50 p-4 text-xs text-muted-foreground">
              还没有可用于协作策略的聊天服务商。请先在下方连接聊天服务商并配置模型。
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {/* ─── Section 1: Connected Providers ─── */}
      {!loading && (
        <div className="rounded-lg border border-border/50 p-4 space-y-2">
          <h3 className="text-sm font-medium mb-1">{t('provider.connectedProviders')}</h3>

          {/* Claude Code — settings link */}
          <div className="border-b border-border/30 pb-2">
            <div className="flex items-center gap-3 py-2.5 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <Anthropic size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude Code</span>
                  {Object.keys(envDetected).length > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-success-foreground border-status-success-border">
                      ENV
                    </Badge>
                  )}
                </div>
              </div>
              <a
                href="/settings#cli"
                className="text-xs text-primary hover:underline flex-shrink-0"
              >
                {t('provider.goToClaudeCodeSettings')}
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground ml-[34px] leading-relaxed">
              {t('provider.ccSwitchHint')}
            </p>
          </div>

          {/* OpenAI OAuth login */}
          <div className="border-b border-border/30 pb-2">
            <div className="flex items-center gap-3 py-2.5 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <span className="text-sm font-bold">AI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">OpenAI</span>
                  {openaiAuth?.authenticated && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-success-foreground border-status-success-border">
                      {openaiAuth.plan || 'OAuth'}
                    </Badge>
                  )}
                </div>
                {openaiAuth?.authenticated && openaiAuth.email && (
                  <p className="text-[10px] text-muted-foreground">{openaiAuth.email}</p>
                )}
              </div>
              {openaiAuth?.authenticated ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={handleOpenAILogout}>
                  {t('cli.openaiLogout')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleOpenAILogin}
                  disabled={openaiLoggingIn}
                >
                  {openaiLoggingIn && <SpinnerGap size={12} className="animate-spin" />}
                  {t('cli.openaiLogin')}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground ml-[34px] leading-relaxed">
              {t('provider.openaiOAuthHint')}
            </p>
            {openaiError && (
              <p className="text-[11px] text-destructive ml-[34px] mt-1">
                {openaiError}
              </p>
            )}
          </div>

          {/* Connected provider list */}
          {sorted.length > 0 ? (
            sorted.map((provider) => (
              <div
                key={provider.id}
                className="py-2.5 px-1 border-b border-border/30 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-[22px] flex justify-center">
                    {getProviderIcon(provider.name, provider.base_url)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{provider.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {provider.api_key
                          ? (findMatchingPreset(provider)?.authStyle === 'auth_token' ? "Auth Token" : "API Key")
                          : t('provider.configured')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Edit"
                      onClick={() => handleEdit(provider)}
                    >
                      <PencilSimple size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(provider)}
                    >
                      {t('provider.disconnect')}
                    </Button>
                  </div>
                </div>
                {/* Provider options — thinking/1M for Anthropic-official only */}
                {provider.provider_type !== 'gemini-image' && provider.base_url === 'https://api.anthropic.com' && (
                  <ProviderOptionsSection
                    providerId={provider.id}
                    showThinkingOptions
                  />
                )}
                {/* Gemini Image model selector — capsule buttons */}
                {provider.provider_type === 'gemini-image' && isOfficialGeminiImageProvider(provider) && (
                  <div className="ml-[34px] mt-2 flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground mr-1">{isZh ? '模型' : 'Model'}:</span>
                    {GEMINI_IMAGE_MODELS.map((m) => {
                      const isActive = getGeminiImageModel(provider) === m.value;
                      return (
                        <Button
                          key={m.value}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleImageModelChange(provider, m.value)}
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border h-auto ${
                            isActive
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50'
                          }`}
                        >
                          {m.label}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          ) : (
            Object.keys(envDetected).length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {t('provider.noConnected')}
              </p>
            )
          )}
        </div>
      )}

      {/* ─── Section 2: Add Provider (Quick Presets) ─── */}
      {!loading && (
        <div className="rounded-lg border border-border/50 p-4">
          <h3 className="text-sm font-medium mb-1">{t('provider.addProviderSection')}</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {t('provider.addProviderDesc')}
          </p>

          {/* Chat Providers */}
          <div className="mb-1">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('provider.chatProviders')}
            </h4>
            {QUICK_PRESETS.filter((p) => p.category !== "media").map((preset) => (
              <div
                key={preset.key}
                className="flex items-center gap-3 py-2.5 px-1 border-b border-border/30 last:border-b-0"
              >
                <div className="shrink-0 w-[22px] flex justify-center">{preset.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {isZh ? preset.descriptionZh : preset.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0 gap-1"
                  onClick={() => handleOpenPresetDialog(preset)}
                >
                  + {t('provider.connect')}
                </Button>
              </div>
            ))}
          </div>

          {/* Media Providers */}
          <div className="mt-4 pt-3 border-t border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('provider.mediaProviders')}
            </h4>
            {QUICK_PRESETS.filter((p) => p.category === "media").map((preset) => (
              <div
                key={preset.key}
                className="flex items-center gap-3 py-2.5 px-1 border-b border-border/30 last:border-b-0"
              >
                <div className="shrink-0 w-[22px] flex justify-center">{preset.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {isZh ? preset.descriptionZh : preset.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0 gap-1"
                  onClick={() => handleOpenPresetDialog(preset)}
                >
                  + {t('provider.connect')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit dialog (full form for editing existing providers) */}
      <ProviderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="edit"
        provider={editingProvider}
        onSave={handleEditSave}
        initialPreset={null}
      />

      {/* Preset connect/edit dialog */}
      <PresetConnectDialog
        preset={connectPreset}
        open={connectDialogOpen}
        onOpenChange={(open) => {
          setConnectDialogOpen(open);
          if (!open) setPresetEditProvider(null);
        }}
        onSave={presetEditProvider ? handleEditSave : handlePresetAdd}
        editProvider={presetEditProvider}
      />

      {/* Provider Doctor dialog */}
      <ProviderDoctorDialog open={doctorOpen} onOpenChange={setDoctorOpen} />

      {/* Disconnect confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('provider.disconnectProvider')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('provider.disconnectConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? t('provider.disconnecting') : t('provider.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
