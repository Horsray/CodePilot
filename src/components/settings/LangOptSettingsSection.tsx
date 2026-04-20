"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

export function LangOptSettingsSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
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

  return (
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

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing || saving || !providerId || !model} className="h-8 text-xs">
            {testing ? (isZh ? "测试中..." : "Testing...") : (isZh ? "测试连通性" : "Test Connection")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || testing || !providerId || !model} className="h-8 text-xs">
            {saving ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存配置" : "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
