"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

import { Switch } from "@/components/ui/switch";

export function LangOptSettingsSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [nightlyProviderId, setNightlyProviderId] = useState("");
  const [nightlyModel, setNightlyModel] = useState("");
  const [nightlyEnabled, setNightlyEnabled] = useState(true);
  const [providerGroups, setProviderGroups] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/app").then((res) => res.json()),
      fetch("/api/providers/models").then((res) => res.json())
    ])
      .then(([settingsData, modelsData]) => {
        const settings = settingsData.settings || {};
        setProviderId(settings.lang_opt_provider_id || "");
        setModel(settings.lang_opt_model || "");
        setNightlyProviderId(settings.nightly_compaction_provider_id || "");
        setNightlyModel(settings.nightly_compaction_model || "");
        setNightlyEnabled(settings.nightly_compaction_enabled !== "false");
        
        if (modelsData.groups) {
          setProviderGroups(modelsData.groups);
        }
        
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            lang_opt_provider_id: providerId,
            lang_opt_model: model,
            nightly_compaction_enabled: nightlyEnabled ? "true" : "false",
            nightly_compaction_provider_id: nightlyProviderId,
            nightly_compaction_model: nightlyModel,
          }
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast({ type: "success", message: isZh ? "保存成功" : "Saved successfully" });
    } catch (err) {
      showToast({ type: "error", message: isZh ? "保存失败" : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!providerId || !model) {
      showToast({ type: "error", message: isZh ? "请先选择服务商和模型" : "Provider and Model are required" });
      return;
    }

    setTesting(true);
    try {
      const res = await fetch("/api/settings/app/test-lang-opt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      showToast({ type: "success", message: isZh ? "测试成功！模型连接正常。" : "Test successful! Model connected." });
    } catch (err: any) {
      showToast({ type: "error", message: err.message || (isZh ? "测试失败" : "Test failed") });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  const selectedGroup = providerGroups.find((g) => g.provider_id === providerId);
  const providerModels = selectedGroup ? selectedGroup.models : [];

  const selectedNightlyGroup = providerGroups.find((g) => g.provider_id === nightlyProviderId);
  const nightlyModels = selectedNightlyGroup ? selectedNightlyGroup.models : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left Column: Lang Opt */}
      <div className="rounded-lg border border-border/50 p-4">
        <h3 className="text-sm font-medium mb-1">
          {isZh ? "语言优化模型配置" : "Language Optimization Model"}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {isZh
            ? "配置一个专门用于提示词优化和更新日志撰写的模型。"
            : "Configure a dedicated model for prompt optimization and changelog generation."}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {isZh ? "服务商 (Provider)" : "Provider"}
            </label>
            <Select value={providerId || ""} onValueChange={(val) => { setProviderId(val); setModel(""); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isZh ? "选择服务商..." : "Select a provider..."} />
              </SelectTrigger>
              <SelectContent>
                {providerGroups.map((g) => (
                  <SelectItem key={g.provider_id} value={g.provider_id}>
                    {g.provider_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {isZh ? "模型 (Model)" : "Model"}
            </label>
            <Select value={model || ""} onValueChange={setModel} disabled={!providerId || !providerModels || providerModels.length === 0}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isZh ? "选择模型..." : "Select a model..."} />
              </SelectTrigger>
              <SelectContent>
                {providerModels && providerModels.length > 0 ? providerModels.map((m: any) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label || m.value}
                  </SelectItem>
                )) : (
                  <SelectItem value="none" disabled>
                    {isZh ? "该服务商没有可用模型" : "No models available"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Right Column: Nightly Compaction */}
      <div className="rounded-lg border border-border/50 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">
            {isZh ? "夜间更新记忆模型配置" : "Nightly Compaction Model"}
          </h3>
          <Switch 
            checked={nightlyEnabled} 
            onCheckedChange={setNightlyEnabled} 
            className="scale-75"
          />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {isZh
            ? "凌晨 3:00 自动清理当日流水账，将核心经验与架构决策提炼至 MCP Memory。"
            : "Automatically extract core insights to MCP Memory at 3:00 AM."}
        </p>

        <div className={`space-y-3 transition-opacity ${!nightlyEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {isZh ? "服务商 (Provider)" : "Provider"}
            </label>
            <Select value={nightlyProviderId || ""} onValueChange={(val) => { setNightlyProviderId(val); setNightlyModel(""); }} disabled={!nightlyEnabled}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isZh ? "选择服务商..." : "Select a provider..."} />
              </SelectTrigger>
              <SelectContent>
                {providerGroups.map((g) => (
                  <SelectItem key={g.provider_id} value={g.provider_id}>
                    {g.provider_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {isZh ? "模型 (Model)" : "Model"}
            </label>
            <Select value={nightlyModel || ""} onValueChange={setNightlyModel} disabled={!nightlyEnabled || !nightlyProviderId || !nightlyModels || nightlyModels.length === 0}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isZh ? "选择模型..." : "Select a model..."} />
              </SelectTrigger>
              <SelectContent>
                {nightlyModels && nightlyModels.length > 0 ? nightlyModels.map((m: any) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label || m.value}
                  </SelectItem>
                )) : (
                  <SelectItem value="none" disabled>
                    {isZh ? "该服务商没有可用模型" : "No models available"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1" />
        
        <div className="flex justify-end gap-2 pt-4 mt-auto">
          <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing || saving || !providerId || !model} className="h-8 text-xs">
            {testing ? (isZh ? "测试中..." : "Testing...") : (isZh ? "测试连通性" : "Test Connection")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || testing} className="h-8 text-xs">
            {saving ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存配置" : "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
