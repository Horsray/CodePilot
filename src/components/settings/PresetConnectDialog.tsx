"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SpinnerGap, CaretDown, CaretUp, ArrowSquareOut, CheckCircle, XCircle, Warning, Lightning } from "@/components/ui/icon";
import type { ProviderFormData } from "./ProviderForm";
import type { QuickPreset } from "./provider-presets";
import { QUICK_PRESETS } from "./provider-presets";
import type { ApiProvider } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import {
  DEFAULT_MEDIA_RELAY_PROTOCOL,
  getConfiguredImageModelNames,
  getMediaRelayEndpoint,
  getMediaRelayProtocol,
  parseModelNames,
  type MediaRelayProtocol,
} from "@/lib/image-provider-utils";

/** Infer auth style from base URL by fuzzy-matching preset hostnames */
function inferAuthStyleFromUrl(url: string): "api_key" | "auth_token" | null {
  if (!url) return null;
  const urlLower = url.toLowerCase();
  for (const p of QUICK_PRESETS) {
    if (!p.base_url) continue;
    try {
      const presetHost = new URL(p.base_url).hostname;
      if (urlLower.includes(presetHost)) {
        return p.authStyle as "api_key" | "auth_token";
      }
    } catch { /* skip invalid URLs */ }
  }
  return null;
}

interface PresetConnectDialogProps {
  preset: QuickPreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: ProviderFormData) => Promise<void>;
  /** When set, dialog operates in edit mode (pre-fills from existing provider) */
  editProvider?: ApiProvider | null;
}

export function PresetConnectDialog({
  preset,
  open,
  onOpenChange,
  onSave,
  editProvider,
}: PresetConnectDialogProps) {
  const isEdit = !!editProvider;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [extraEnv, setExtraEnv] = useState("{}");
  const [modelName, setModelName] = useState("");
  const [modelNamesText, setModelNamesText] = useState("");
  const [mediaProtocol, setMediaProtocol] = useState<MediaRelayProtocol>(DEFAULT_MEDIA_RELAY_PROTOCOL);
  const [mediaEndpoint, setMediaEndpoint] = useState("");
  // Auth style for anthropic-thirdparty: 'api_key' or 'auth_token'
  const [authStyle, setAuthStyle] = useState<"api_key" | "auth_token">("api_key");
  // Track the initial auth style to detect changes
  const [initialAuthStyle, setInitialAuthStyle] = useState<"api_key" | "auth_token">("api_key");
  // Edit-mode advanced fields
  const [headersJson, setHeadersJson] = useState("{}");
  const [envOverridesJson, setEnvOverridesJson] = useState("");
  const [notes, setNotes] = useState("");
  // Model mapping fields (sonnet/opus/haiku → actual API model IDs)
  const [mapSonnet, setMapSonnet] = useState("");
  const [mapOpus, setMapOpus] = useState("");
  const [mapHaiku, setMapHaiku] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: { code: string; message: string; suggestion: string; recoveryActions?: Array<{ label: string; url?: string; action?: string }> } } | null>(null);
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const effectiveModelName = preset?.key === 'custom-media'
        ? parseModelNames(modelNamesText || modelName)[0]
        : modelName.trim();
      const envOverrides: Record<string, string> = {};
      try {
        const parsed = JSON.parse(extraEnv || '{}');
        Object.assign(envOverrides, parsed);
      } catch { /* ignore */ }
      
      // Check if we should use cc-switch config (when apiKey is empty and preset is custom)
      const useCCSwitch = !apiKey && (preset?.key === 'custom-anthropic' || preset?.key === 'custom-openai');
      
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetKey: preset?.key,
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || preset?.base_url || '',
          protocol: preset?.protocol || 'anthropic',
          authStyle: preset?.key === 'anthropic-thirdparty' ? authStyle : (preset?.authStyle || authStyle),
          envOverrides,
          modelName: effectiveModelName || undefined,
          providerName: name || preset?.name,
          useCCSwitch,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: { code: 'NETWORK_ERROR', message: 'Failed to reach test endpoint', suggestion: 'Check if the app is running' } });
    } finally {
      setTesting(false);
    }
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (!open || !preset) return;
    setError(null);
    setSaving(false);
    setTesting(false);
    setTestResult(null);

    if (isEdit && editProvider) {
      // Edit mode — pre-fill from existing provider
      setName(editProvider.name);
      setBaseUrl(editProvider.base_url);
      setExtraEnv(editProvider.extra_env || preset.extra_env);
      // Use preset authStyle as source of truth; fall back to extra_env inference for legacy records
      let detected: 'auth_token' | 'api_key' = preset.authStyle === 'auth_token' ? 'auth_token' : 'api_key';
      if (preset.key === 'anthropic-thirdparty') {
        // Thirdparty presets: infer from stored extra_env since user chose the style
        try {
          const env = JSON.parse(editProvider.extra_env || "{}");
          detected = "ANTHROPIC_AUTH_TOKEN" in env ? "auth_token" : "api_key";
        } catch { /* keep preset default */ }
      }
      setAuthStyle(detected);
      setInitialAuthStyle(detected);
      // If api_key field isn't shown and stored key is empty, use preset default
      // (e.g. Ollama needs ANTHROPIC_AUTH_TOKEN='ollama' without user input)
      if (!preset.fields.includes("api_key") && !editProvider.api_key) {
        const presetEnv = (() => { try { return JSON.parse(preset.extra_env || '{}'); } catch { return {}; } })();
        const defaultToken = detected === 'auth_token'
          ? (presetEnv['ANTHROPIC_AUTH_TOKEN'] || '')
          : (presetEnv['ANTHROPIC_API_KEY'] || '');
        setApiKey(defaultToken);
      } else {
        setApiKey(editProvider.api_key || "");
      }
      // Pre-fill advanced fields
      setHeadersJson(editProvider.headers_json || "{}");
      setEnvOverridesJson(editProvider.env_overrides_json || "");
      setNotes(editProvider.notes || "");
      setMediaProtocol(
        preset.key === "custom-media"
          ? getMediaRelayProtocol(editProvider)
          : DEFAULT_MEDIA_RELAY_PROTOCOL
      );
      setMediaEndpoint(
        preset.key === "custom-media"
          ? getMediaRelayEndpoint(editProvider)
          : ""
      );
      // Pre-fill model name from role_models_json
      try {
        const rm = JSON.parse(editProvider.role_models_json || "{}");
        const configuredModelNames = getConfiguredImageModelNames(editProvider);
        setModelName(configuredModelNames[0] || rm.default || "");
        setModelNamesText(configuredModelNames.join("\n"));
        setMapSonnet(rm.sonnet || "");
        setMapOpus(rm.opus || "");
        setMapHaiku(rm.haiku || "");
      } catch {
        setModelName("");
        setModelNamesText("");
        setMapSonnet("");
        setMapOpus("");
        setMapHaiku("");
      }
      // Auto-expand advanced if there's meaningful data beyond preset defaults
      const hasModelMapping = (() => {
        try {
          const rm = JSON.parse(editProvider.role_models_json || "{}");
          return !!(rm.sonnet || rm.opus || rm.haiku);
        } catch { return false; }
      })();
      const hasExtraEnvBeyondAuth = (() => {
        try {
          const env = JSON.parse(editProvider.extra_env || "{}");
          const meaningful = Object.keys(env).filter(k =>
            k !== "ANTHROPIC_API_KEY" && k !== "ANTHROPIC_AUTH_TOKEN"
          );
          return meaningful.length > 0;
        } catch { return false; }
      })();
      const hasHeaders = editProvider.headers_json && editProvider.headers_json !== "{}";
      const hasEnvOverrides = !!editProvider.env_overrides_json;
      const hasNotes = !!editProvider.notes;
      setShowAdvanced(hasModelMapping || hasExtraEnvBeyondAuth || !!hasHeaders || hasEnvOverrides || hasNotes);
    } else {
      // Create mode — reset to preset defaults
      setBaseUrl(preset.base_url);
      setName(preset.name);
      setExtraEnv(preset.extra_env);
      setModelName("");
      setModelNamesText("");
      // Use authStyle directly from preset (single source of truth)
      const detectedStyle = (preset.authStyle === 'auth_token' ? 'auth_token' : 'api_key') as 'api_key' | 'auth_token';
      // If preset doesn't expose api_key field, pre-fill from extra_env default
      // (e.g. Ollama needs ANTHROPIC_AUTH_TOKEN='ollama' without user input)
      if (!preset.fields.includes("api_key")) {
        const presetEnv = (() => { try { return JSON.parse(preset.extra_env || '{}'); } catch { return {}; } })();
        const defaultToken = detectedStyle === 'auth_token'
          ? (presetEnv['ANTHROPIC_AUTH_TOKEN'] || '')
          : (presetEnv['ANTHROPIC_API_KEY'] || '');
        setApiKey(defaultToken);
      } else {
        setApiKey("");
      }
      setAuthStyle(detectedStyle);
      setInitialAuthStyle(detectedStyle);
      setMapSonnet("");
      setMapOpus("");
      setMapHaiku("");
      setHeadersJson("{}");
      setEnvOverridesJson("");
      setNotes("");
      setMediaProtocol(preset.key === "custom-media" ? "openai-images" : DEFAULT_MEDIA_RELAY_PROTOCOL);
      setMediaEndpoint(preset.key === "custom-media" ? "/v1/images/generations" : "");
      setShowAdvanced(false);
    }
  }, [open, preset, isEdit, editProvider]);

  if (!preset) return null;
  const isMaskedApiKey = isEdit && apiKey.startsWith("***");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // If auth style changed in edit mode, require a new key
    if (isEdit && authStyle !== initialAuthStyle && (!apiKey || apiKey.startsWith("***"))) {
      setError(isZh
        ? '切换认证方式后需要重新输入密钥'
        : 'Please re-enter the key after changing auth style');
      return;
    }

    // For anthropic-thirdparty, inject the correct auth key into extra_env
    // while preserving any other user-specified env vars (e.g. API_TIMEOUT_MS)
    let finalExtraEnv = extraEnv;
    if (preset.key === "anthropic-thirdparty") {
      try {
        const parsed = JSON.parse(extraEnv || "{}");
        // Remove both auth keys, then set the correct one
        delete parsed["ANTHROPIC_API_KEY"];
        delete parsed["ANTHROPIC_AUTH_TOKEN"];
        if (authStyle === "auth_token") {
          parsed["ANTHROPIC_AUTH_TOKEN"] = "";
        } else {
          parsed["ANTHROPIC_API_KEY"] = "";
        }
        finalExtraEnv = JSON.stringify(parsed);
      } catch {
        // If parse fails, fall back to simple replacement
        finalExtraEnv = authStyle === "auth_token"
          ? '{"ANTHROPIC_AUTH_TOKEN":""}'
          : '{"ANTHROPIC_API_KEY":""}';
      }
    }
    // In edit mode, preserve existing role_models_json unless the user modifies mapping fields
    let roleModelsJson = (isEdit && editProvider?.role_models_json) ? editProvider.role_models_json : "{}";

    // Model mapping (sonnet/opus/haiku → actual API model IDs)
    // Merge into existing roleModels to preserve roles not shown in this preset.
    // If the preset exposes these fields and user cleared them all, remove those keys.
    if (preset.fields.includes("model_mapping")) {
      const hasAny = mapSonnet.trim() || mapOpus.trim() || mapHaiku.trim();
      if (hasAny) {
        // If user fills any, all 3 are required
        if (!mapSonnet.trim() || !mapOpus.trim() || !mapHaiku.trim()) {
          setError(isZh
            ? '模型映射需要同时填写 Sonnet、Opus、Haiku 三个模型名称'
            : 'Model mapping requires all 3 model names (Sonnet, Opus, Haiku)');
          return;
        }
        const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
        roleModelsJson = JSON.stringify({
          ...existing,
          sonnet: mapSonnet.trim(),
          opus: mapOpus.trim(),
          haiku: mapHaiku.trim(),
        });
      } else {
        // All cleared — remove these keys from existing
        const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
        delete existing.sonnet;
        delete existing.opus;
        delete existing.haiku;
        roleModelsJson = JSON.stringify(existing);
      }
    }

    // Inject model name into role_models_json — merge, don't replace.
    // If the preset exposes model_names and user cleared it, remove the default key.
    if (preset.fields.includes("model_names")) {
      const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
      const configuredModelNames = preset.key === "custom-media"
        ? parseModelNames(modelNamesText || modelName)
        : parseModelNames(modelName);

      if (preset.key === "custom-media" && configuredModelNames.length === 0) {
        setError(isZh
          ? '通用中转平台至少需要填写一个模型名称'
          : 'Relay image provider requires at least one model name');
        return;
      }

      if (configuredModelNames.length > 0) {
        roleModelsJson = JSON.stringify({ ...existing, default: configuredModelNames[0] });
      } else {
        delete existing.default;
        roleModelsJson = JSON.stringify(existing);
      }
    }

    if (envOverridesJson.trim()) {
      try {
        JSON.parse(envOverridesJson);
      } catch {
        setError('Env overrides must be valid JSON');
        return;
      }
    }

    const finalEnvOverridesJson = (() => {
      const base = (() => { try { return JSON.parse(envOverridesJson || "{}"); } catch { return {}; } })();
      if (preset.key === "custom-media" && preset.fields.includes("model_names")) {
        const configuredModelNames = parseModelNames(modelNamesText || modelName);
        if (configuredModelNames.length > 0) {
          base.model_names = configuredModelNames.join(",");
        } else {
          delete base.model_names;
        }
      }
      return Object.keys(base).length > 0 ? JSON.stringify(base) : "";
    })();

    const finalOptionsJson = (() => {
      if (preset.key !== "custom-media") {
        return isEdit ? editProvider?.options_json || "{}" : "{}";
      }
      const existing = (() => {
        try {
          return JSON.parse(editProvider?.options_json || "{}");
        } catch {
          return {};
        }
      })();
      const nextOptions = {
        ...existing,
        media_protocol: mediaProtocol,
      } as Record<string, unknown>;
      if (mediaEndpoint.trim()) {
        nextOptions.media_endpoint = mediaEndpoint.trim();
      } else {
        delete nextOptions.media_endpoint;
      }
      return JSON.stringify(nextOptions);
    })();

    // Validate JSON fields
    for (const [label, val] of [
      ["Extra environment variables", finalExtraEnv],
      ["Env overrides", finalEnvOverridesJson],
      ["Options", finalOptionsJson],
      ...(isEdit ? [["Headers", headersJson]] : []),
    ] as const) {
      if (val && val.trim()) {
        try { JSON.parse(val); } catch {
          setError(`${label} must be valid JSON`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim() || preset.name,
        provider_type: preset.provider_type,
        protocol: preset.protocol,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        extra_env: finalExtraEnv,
        role_models_json: roleModelsJson,
        headers_json: isEdit ? headersJson.trim() || "{}" : undefined,
        env_overrides_json: finalEnvOverridesJson,
        options_json: finalOptionsJson,
        notes: isEdit ? notes.trim() : "",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit ? "Failed to update provider" : "Failed to add provider"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[28rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {preset.icon}
            {isEdit ? t('provider.editProvider') : t('provider.connect')} {preset.name}
          </DialogTitle>
          <DialogDescription>
            {isZh ? preset.descriptionZh : preset.description}
          </DialogDescription>
        </DialogHeader>

        {/* Meta info panel — API key link, billing badge, notes */}
        {preset.meta && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {preset.meta.billingModel && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                  {preset.meta.billingModel === 'pay_as_you_go' ? (isZh ? '按量付费' : 'Pay-as-you-go')
                    : preset.meta.billingModel === 'coding_plan' ? 'Coding Plan'
                    : preset.meta.billingModel === 'token_plan' ? 'Token Plan'
                    : preset.meta.billingModel === 'free' ? (isZh ? '免费' : 'Free')
                    : preset.meta.billingModel === 'self_hosted' ? (isZh ? '自托管' : 'Self-hosted')
                    : preset.meta.billingModel}
                </span>
              )}
              {preset.meta.apiKeyUrl && (
                <a href={preset.meta.apiKeyUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <ArrowSquareOut size={12} />
                  {isZh ? '获取 API Key' : 'Get API Key'}
                </a>
              )}
              <a href={isZh ? 'https://www.codepilot.sh/zh/docs/providers' : 'https://www.codepilot.sh/docs/providers'} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                <ArrowSquareOut size={12} />
                {isZh ? '配置指南' : 'Setup Guide'}
              </a>
            </div>
            {preset.meta.notes && preset.meta.notes.length > 0 && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-1">
                {preset.meta.notes.map((note, i) => (
                  <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <Warning size={12} className="shrink-0 mt-0.5" />
                    {note}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
          {/* Name field — custom/thirdparty */}
          {preset.fields.includes("name") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={preset.name}
                className="text-sm"
              />
            </div>
          )}

          {/* Base URL */}
          {preset.fields.includes("base_url") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.baseUrl')}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="text-sm font-mono"
              />
            </div>
          )}

          {preset.key === "custom-media" && (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  {isZh ? "接口协议" : "Protocol"}
                </Label>
                <Select
                  value={mediaProtocol}
                  onValueChange={(value) => setMediaProtocol(value as MediaRelayProtocol)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-images">
                      {isZh ? "OpenAI 图片接口" : "OpenAI Images API"}
                    </SelectItem>
                    <SelectItem value="custom-image">
                      {isZh ? "自定义图片接口" : "Custom Image API"}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {mediaProtocol === "openai-images"
                    ? (isZh
                      ? "适用于 /v1/images/generations 这类 OpenAI-compatible 生图接口。"
                      : "Use this for OpenAI-compatible image endpoints such as /v1/images/generations.")
                    : (isZh
                      ? "适用于返回 { images: [...] } 的自定义中转接口。"
                      : "Use this for custom relay APIs that return { images: [...] }.")}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  {isZh ? "接口地址" : "Endpoint"}
                </Label>
                <Input
                  value={mediaEndpoint}
                  onChange={(e) => setMediaEndpoint(e.target.value)}
                  placeholder={mediaProtocol === "openai-images" ? "/v1/images/generations" : "https://api.example.com/image/generate"}
                  className="text-sm font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isZh
                    ? "可填写相对路径或完整 URL。留空时，自定义接口直接请求 Base URL，OpenAI 图片接口默认补成 /v1/images/generations。"
                    : "Use a relative path or full URL. Leave empty to call Base URL directly for custom relays, or default to /v1/images/generations for OpenAI Images."}
                </p>
              </div>
            </>
          )}

          {/* API Key with optional auth style select */}
          {preset.fields.includes("api_key") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {preset.key === "anthropic-thirdparty"
                  ? (authStyle === "auth_token" ? "Auth Token" : "API Key")
                  : "API Key"}
              </Label>
              <div className="flex gap-2">
                {preset.key === "anthropic-thirdparty" && (
                  <Select
                    value={authStyle}
                    onValueChange={(v) => {
                      const newStyle = v as "api_key" | "auth_token";
                      setAuthStyle(newStyle);
                      if (isEdit && editProvider?.api_key) {
                        if (newStyle !== initialAuthStyle) {
                          setApiKey("");
                        } else {
                          setApiKey(editProvider.api_key);
                        }
                      }
                    }}
                  >
                    <SelectTrigger className="w-[130px] shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="auth_token">Auth Token</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={authStyle === "auth_token" ? "token-..." : "sk-..."}
                  className="text-sm font-mono flex-1"
                  autoFocus
                />
              </div>
              {isMaskedApiKey && (
                <p className="text-[11px] text-muted-foreground">
                  {isZh
                    ? '当前显示的是掩码。直接保存会保留原 API Key，只有重新输入才会替换。'
                    : 'This field is masked. Saving without changes keeps the current API key; re-enter it only if you want to replace it.'}
                </p>
              )}
              {/* Show auth style badge for non-thirdparty presets (auto-determined) */}
              {preset.key !== "anthropic-thirdparty" && (
                <p className="text-[11px] text-muted-foreground">
                  Auth: <span className="font-mono">{authStyle === "auth_token" ? "Authorization: Bearer ..." : "X-Api-Key: ..."}</span>
                </p>
              )}
              {/* Smart recommend for thirdparty based on URL */}
              {preset.key === "anthropic-thirdparty" && baseUrl && (() => {
                const inferred = inferAuthStyleFromUrl(baseUrl);
                return inferred && inferred !== authStyle ? (
                  <p className="text-[11px] text-amber-500">
                    {isZh
                      ? `检测到此 URL 通常使用 ${inferred === 'auth_token' ? 'Auth Token' : 'API Key'} 认证方式`
                      : `This URL typically uses ${inferred === 'auth_token' ? 'Auth Token' : 'API Key'} authentication`}
                    {' '}
                    <Button
                      variant="link"
                      className="h-auto p-0 text-[11px] text-amber-500 underline hover:no-underline"
                      onClick={() => setAuthStyle(inferred)}
                    >
                      {isZh ? '切换' : 'Switch'}
                    </Button>
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {/* Model name — for providers that need user-specified model */}
          {preset.fields.includes("model_names") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.modelName' as TranslationKey)}</Label>
              {preset.key === "custom-media" ? (
                <Textarea
                  value={modelNamesText}
                  onChange={(e) => {
                    setModelNamesText(e.target.value);
                    const names = parseModelNames(e.target.value);
                    setModelName(names[0] || "");
                  }}
                  placeholder={"gemini-2.5-flash-image\nimagen-4.0-generate-preview"}
                  className="text-sm font-mono min-h-[88px]"
                  rows={4}
                />
              ) : (
                <Input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="ark-code-latest"
                  className="text-sm font-mono"
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                {preset.key === "custom-media"
                  ? (isZh
                    ? '每行一个或用逗号分隔。首个模型会作为默认值，生成时可在图片卡片里切换。'
                    : 'One model per line or comma-separated. The first model becomes the default, and users can switch models in the image card.')
                  : (isZh
                    ? '在服务商控制台配置的模型名称，如 ark-code-latest、doubao-seed-2.0-code'
                    : 'Model name configured in provider console, e.g. ark-code-latest')}
              </p>
            </div>
          )}

          {/* Extra env — bedrock/vertex/custom always shown */}
          {preset.fields.includes("extra_env") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.extraEnvVars')} (JSON)</Label>
              <Textarea
                value={extraEnv}
                onChange={(e) => setExtraEnv(e.target.value)}
                className="text-sm font-mono min-h-[80px]"
                rows={3}
              />
            </div>
          )}

          {/* Advanced options — for presets that don't normally show extra_env */}
          {!preset.fields.includes("extra_env") && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground h-auto px-0 py-0"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? <CaretUp size={12} /> : <CaretDown size={12} />}
                {t('provider.advancedOptions')}
              </Button>
              {showAdvanced && (
                <div className="space-y-4 border-t border-border/50 pt-3">
                  {/* Model mapping (sonnet/opus/haiku → API model IDs) */}
                  {preset.fields.includes("model_mapping") && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {isZh ? '模型名称映射' : 'Model Name Mapping'}
                      </Label>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {isZh
                          ? '如果服务商使用不同的模型名称（如 claude-sonnet-4-6），在此映射。留空则使用默认名称（sonnet / opus / haiku）。'
                          : 'Map model names if the provider uses different IDs (e.g. claude-sonnet-4-6). Leave empty to use defaults (sonnet / opus / haiku).'}
                      </p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                        <span className="text-xs text-muted-foreground text-right">Sonnet</span>
                        <Input
                          value={mapSonnet}
                          onChange={(e) => setMapSonnet(e.target.value)}
                          placeholder="claude-sonnet-4-6"
                          className="text-sm font-mono h-8"
                        />
                        <span className="text-xs text-muted-foreground text-right">Opus</span>
                        <Input
                          value={mapOpus}
                          onChange={(e) => setMapOpus(e.target.value)}
                          placeholder="claude-opus-4-6"
                          className="text-sm font-mono h-8"
                        />
                        <span className="text-xs text-muted-foreground text-right">Haiku</span>
                        <Input
                          value={mapHaiku}
                          onChange={(e) => setMapHaiku(e.target.value)}
                          placeholder="claude-haiku-4-5-20251001"
                          className="text-sm font-mono h-8"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t('provider.extraEnvVars')} (JSON)</Label>
                    <Textarea
                      value={extraEnv}
                      onChange={(e) => setExtraEnv(e.target.value)}
                      className="text-sm font-mono min-h-[60px]"
                      rows={3}
                    />
                  </div>

                  {/* Edit-mode only: headers, env overrides, notes */}
                  {isEdit && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Headers (JSON)</Label>
                        <Textarea
                          value={headersJson}
                          onChange={(e) => setHeadersJson(e.target.value)}
                          placeholder='{"X-Custom-Header": "value"}'
                          className="text-sm font-mono min-h-[60px]"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Env Overrides (JSON)</Label>
                        <Textarea
                          value={envOverridesJson}
                          onChange={(e) => setEnvOverridesJson(e.target.value)}
                          placeholder='{"CLAUDE_CODE_USE_BEDROCK": "1"}'
                          className="text-sm font-mono min-h-[60px]"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{t('provider.notes')}</Label>
                        <Textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={t('provider.notesPlaceholder')}
                          className="text-sm"
                          rows={2}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Connection test result */}
          {testResult && (() => {
            const isSkipped = testResult.error?.code === 'SKIPPED';
            const bgClass = testResult.success
              ? 'bg-emerald-500/10 border border-emerald-500/20' // lint-allow-raw-color
              : isSkipped
                ? 'bg-muted border border-border'
                : 'bg-destructive/10 border border-destructive/20';
            return (
              <div className={`rounded-md px-3 py-2 text-sm ${bgClass}`}>
                <div className="flex items-center gap-2">
                  {testResult.success
                    ? <><CheckCircle size={16} className="text-emerald-500 shrink-0" />{/* lint-allow-raw-color */}<span className="text-emerald-600 dark:text-emerald-400">{/* lint-allow-raw-color */}{isZh ? '连接成功' : 'Connection successful'}</span></>
                    : isSkipped
                      ? <><Warning size={16} className="text-muted-foreground shrink-0" /><span className="text-muted-foreground">{isZh ? '此服务商类型无法进行连接测试，请保存配置后发送消息验证' : 'Connection test not available for this provider type'}</span></>
                      : <><XCircle size={16} className="text-destructive shrink-0" /><span className="text-destructive">{testResult.error?.message || 'Connection failed'}</span></>
                  }
                </div>
                {!testResult.success && !isSkipped && testResult.error?.suggestion && (
                  <p className="text-xs text-muted-foreground mt-1">{testResult.error.suggestion}</p>
                )}
                {!testResult.success && !isSkipped && testResult.error?.recoveryActions && testResult.error.recoveryActions.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {testResult.error.recoveryActions.filter(a => a.url).map((action, i) => (
                      <a key={i} href={action.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <ArrowSquareOut size={10} />
                        {action.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || testing}
            >
              {t('common.cancel')}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={saving || testing || (!apiKey && preset.fields.includes("api_key") && preset.key !== 'custom-anthropic' && preset.key !== 'custom-openai')}
                className="gap-1.5"
              >
                {testing ? <SpinnerGap size={14} className="animate-spin" /> : <Lightning size={14} />}
                {testing ? (isZh ? '测试中...' : 'Testing...') : (isZh ? '测试连接' : 'Test')}
              </Button>
              <Button type="submit" disabled={saving || testing} className="gap-2">
                {saving && <SpinnerGap size={16} className="animate-spin" />}
                {saving ? t('provider.saving') : isEdit ? t('provider.update') : t('provider.connect')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
