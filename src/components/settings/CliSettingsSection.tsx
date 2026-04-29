"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  FloppyDisk,
  ArrowClockwise,
  Code,
  SlidersHorizontal,
  SpinnerGap,
  FileArrowDown,
  ArrowsClockwise,
  CheckCircle,
  Warning,
  XCircle,
} from "@/components/ui/icon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { ImportSessionDialog } from "@/components/layout/ImportSessionDialog";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { ProviderOptions } from "@/types";

interface SettingsData {
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  { key: "permissions", label: "Permissions", type: "object" as const },
  { key: "env", label: "Environment Variables", type: "object" as const },
] as const;

export function CliSettingsSection() {
  // ── CLI settings (settings.json) ──
  const [settings, setSettings] = useState<SettingsData>({});
  const [originalSettings, setOriginalSettings] = useState<SettingsData>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<"form" | "json" | null>(null);

  // ── CLI status ──
  const { status: claudeStatus, refresh: refreshStatus, invalidateAndRefresh } = useClaudeStatus();
  const [upgrading, setUpgrading] = useState(false);

  // ── Model options (env provider) ──
  const [thinkingMode, setThinkingMode] = useState("adaptive");
  const [context1m, setContext1m] = useState(false);

  // ── Dialogs ──
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [installWizardOpen, setInstallWizardOpen] = useState(false);

  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  const knownFieldKeys: Record<string, { label: TranslationKey; description: TranslationKey }> = {
    permissions: { label: 'cli.permissions', description: 'cli.permissionsDesc' },
    env: { label: 'cli.envVars', description: 'cli.envVarsDesc' },
  };

  const dynamicFieldLabels: Record<string, TranslationKey> = {
    skipDangerousModePermissionPrompt: 'cli.field.skipDangerousModePermissionPrompt',
    verbose: 'cli.field.verbose',
    theme: 'cli.field.theme',
  };

  // ── Fetch all data ──
  const fetchSettings = useCallback(async () => {
    try {
      const [cliRes, optRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/providers/options?providerId=env"),
      ]);

      if (cliRes.ok) {
        const data = await cliRes.json();
        const s = data.settings || {};
        setSettings(s);
        setOriginalSettings(s);
        setJsonText(JSON.stringify(s, null, 2));
      }

      if (optRes.ok) {
        const optData = await optRes.json();
        const opts: ProviderOptions = optData.options || {};
        setThinkingMode(opts.thinking_mode || "adaptive");
        setContext1m(opts.context_1m || false);
      }

    } catch {
      setSettings({});
      setOriginalSettings({});
      setJsonText("{}");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleUpgrade = async () => {
    if (!claudeStatus?.installType) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/claude-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installType: claudeStatus.installType }),
      });
      const data = await res.json();
      if (data.success) await invalidateAndRefresh();
    } finally {
      setUpgrading(false);
    }
  };

  const saveModelOption = async (key: string, value: string | boolean) => {
    if (key === "thinking_mode") setThinkingMode(value as string);
    if (key === "context_1m") setContext1m(value as boolean);
    try {
      await fetch("/api/providers/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "env", options: { [key]: value } }),
      });
    } catch { /* ignore */ }
  };

  // ── Settings.json handlers ──

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  const handleSave = async (source: "form" | "json") => {
    let dataToSave: SettingsData;
    if (source === "json") {
      try {
        dataToSave = JSON.parse(jsonText);
        setJsonError("");
      } catch {
        setJsonError("Invalid JSON format");
        return;
      }
    } else {
      dataToSave = settings;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dataToSave }),
      });
      if (res.ok) {
        setSettings(dataToSave);
        setOriginalSettings(dataToSave);
        setJsonText(JSON.stringify(dataToSave, null, 2));
        setSaveSuccess(true);
        // 中文注释：功能名称「保存后广播 provider 变更事件」，用法是让已连接的 CC Switch 服务商在切换配置后自动刷新。
        window.dispatchEvent(new Event('provider-changed'));
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPendingSaveAction(null);
    }
  };

  const handleReset = () => {
    setSettings(originalSettings);
    setJsonText(JSON.stringify(originalSettings, null, 2));
    setJsonError("");
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError("");
    } catch {
      setJsonError(t('cli.formatError'));
    }
  };

  const confirmSave = (source: "form" | "json") => {
    setPendingSaveAction(source);
    setShowConfirmDialog(true);
  };

  const updateField = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t('cli.loadingSettings')}</span>
      </div>
    );
  }

  const connected = claudeStatus?.connected ?? false;
  const updateAvailable = claudeStatus?.updateAvailable ?? false;

  return (
    <div className="max-w-3xl space-y-6">

      {/* ════════ Card 1: Agent 内核 选择 ════════ */}
      <SettingsCard
        title={isZh ? 'Agent 内核' : 'Agent Engine'}
        description={isZh ? '当前产品路径固定为 Claude Code CLI' : 'The product path is fixed to Claude Code CLI'}
      >
        <FieldRow
          label={isZh ? '执行引擎' : 'Engine'}
          description={isZh
            ? '已移除 AI SDK / Native 回退分支，聊天与工具执行统一走 Claude Code CLI。'
            : 'AI SDK / Native fallback is removed. Chat and tool execution now always run through Claude Code CLI.'}
        >
          <div className="inline-flex h-8 items-center rounded-md border border-border bg-muted/30 px-3 text-xs font-medium">
            {isZh ? 'Claude Code CLI（唯一主路径）' : 'Claude Code CLI (Only Path)'}
          </div>
        </FieldRow>

        <FieldRow label={isZh ? 'Claude Code 状态' : 'Claude Code Status'} separator>
          <div className="flex items-center gap-2">
            {connected ? (
              <>
                <CheckCircle size={14} className="text-status-success-foreground" />
                <span className="text-xs text-muted-foreground">
                  v{claudeStatus?.version}
                  {claudeStatus?.installType ? ` (${claudeStatus.installType})` : ''}
                </span>
                {updateAvailable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={handleUpgrade}
                    disabled={upgrading}
                  >
                    {upgrading ? <SpinnerGap size={12} className="animate-spin" /> : <ArrowsClockwise size={12} />}
                    {t('cli.update')}
                  </Button>
                )}
              </>
            ) : (
              <>
                <XCircle size={14} className="text-status-error-foreground" />
                <span className="text-xs text-muted-foreground">{isZh ? '未安装' : 'Not installed'}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => setInstallWizardOpen(true)}
                >
                  {t('cli.install')}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refreshStatus}>
              <ArrowClockwise size={12} />
            </Button>
          </div>
        </FieldRow>

        <FieldRow
          label={isZh ? '能力模式' : 'Capability Mode'}
          description={isZh
            ? '固定启用完整能力：始终加载 user/project/local settings，保持 rules、skills、hooks、OMC 与 MCP 发现链路一致。'
            : 'Full capabilities are always enabled: user/project/local settings are always loaded to preserve rules, skills, hooks, OMC, and MCP discovery.'}
          separator
        >
          <div className="inline-flex h-8 items-center rounded-md border border-border bg-muted/30 px-3 text-xs font-medium">
            {isZh ? '完整能力（固定开启）' : 'Full Capabilities (Always On)'}
          </div>
        </FieldRow>

        {claudeStatus?.warnings && claudeStatus.warnings.length > 0 && (
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2">
            <div className="flex items-start gap-2">
              <Warning size={14} className="text-status-warning-foreground mt-0.5 flex-shrink-0" />
              <div className="text-xs text-status-warning-foreground">
                {claudeStatus.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* ════════ Card 2: 模型选项（Claude Code 模式时显示）════════ */}
      {connected && (
        <SettingsCard title={t('cli.modelOptions')} description={t('cli.modelOptionsDesc')}>
          <FieldRow label={t('cli.thinkingMode')} description={t('cli.thinkingModeDesc')}>
            <Select value={thinkingMode} onValueChange={(v) => saveModelOption('thinking_mode', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adaptive">{t('settings.thinkingAdaptive' as TranslationKey)}</SelectItem>
                <SelectItem value="enabled">{t('settings.thinkingEnabled' as TranslationKey)}</SelectItem>
                <SelectItem value="disabled">{t('settings.thinkingDisabled' as TranslationKey)}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label={t('cli.context1m')} description={t('cli.context1mDesc')} separator>
            <Switch
              checked={context1m}
              onCheckedChange={(checked) => saveModelOption('context_1m', checked)}
            />
          </FieldRow>
        </SettingsCard>
      )}

      {/* ════════ Card 3: 导入聊天记录 ════════ */}
      <SettingsCard title={t('cli.importTitle')} description={t('cli.importDesc')}>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setImportDialogOpen(true)}
        >
          <FileArrowDown size={14} />
          {t('cli.importButton')}
        </Button>
        <ImportSessionDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
        />
      </SettingsCard>

      {/* ════════ Card 4: CLI 配置 ════════ */}
      <SettingsCard title={t('cli.cliConfig')} description={t('cli.cliConfigDesc')}>
        <Tabs defaultValue="form">
          <TabsList className="mb-4">
            <TabsTrigger value="form" className="gap-2">
              <SlidersHorizontal size={16} />
              {t('cli.form')}
            </TabsTrigger>
            <TabsTrigger value="json" className="gap-2">
              <Code size={16} />
              {t('cli.json')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="form">
            <div className="space-y-4">
              {KNOWN_FIELDS.map((field) => (
                <div key={field.key}>
                  <Label className="text-sm font-medium">
                    {t(knownFieldKeys[field.key]?.label ?? field.label as TranslationKey)}
                  </Label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t(knownFieldKeys[field.key]?.description ?? '' as TranslationKey)}
                  </p>
                  <Textarea
                    value={
                      typeof settings[field.key] === "object"
                        ? JSON.stringify(settings[field.key], null, 2)
                        : String(settings[field.key] ?? "")
                    }
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        updateField(field.key, parsed);
                      } catch {
                        updateField(field.key, e.target.value);
                      }
                    }}
                    className="font-mono text-sm"
                    rows={4}
                  />
                </div>
              ))}

              {Object.entries(settings)
                .filter(([key]) => !KNOWN_FIELDS.some((f) => f.key === key))
                .map(([key, value]) => (
                  <div key={key}>
                    <Label className="text-sm font-medium">
                      {dynamicFieldLabels[key] ? t(dynamicFieldLabels[key]) : key}
                    </Label>
                    {typeof value === "boolean" ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Switch
                          checked={value}
                          onCheckedChange={(checked) => updateField(key, checked)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {value ? t('common.enabled') : t('common.disabled')}
                        </span>
                      </div>
                    ) : typeof value === "string" ? (
                      <Input
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                        className="mt-2"
                      />
                    ) : (
                      <Textarea
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => {
                          try {
                            updateField(key, JSON.parse(e.target.value));
                          } catch {
                            updateField(key, e.target.value);
                          }
                        }}
                        className="mt-2 font-mono text-sm"
                        rows={4}
                      />
                    )}
                  </div>
                ))}

              <div className="flex items-center gap-3">
                <Button onClick={() => confirmSave("form")} disabled={!hasChanges || saving} className="gap-2">
                  {saving ? <SpinnerGap size={16} className="animate-spin" /> : <FloppyDisk size={16} />}
                  {saving ? t('provider.saving') : t('cli.save')}
                </Button>
                <Button variant="outline" onClick={handleReset} disabled={!hasChanges} className="gap-2">
                  <ArrowClockwise size={16} />
                  {t('cli.reset')}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-status-success-foreground">{t('cli.settingsSaved')}</span>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="json">
            <div className="space-y-4">
              <Textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError("");
                }}
                className="min-h-[400px] font-mono text-sm"
                placeholder='{"key": "value"}'
              />
              {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}

              <div className="flex items-center gap-3">
                <Button onClick={() => confirmSave("json")} disabled={saving} className="gap-2">
                  {saving ? <SpinnerGap size={16} className="animate-spin" /> : <FloppyDisk size={16} />}
                  {saving ? t('provider.saving') : t('cli.save')}
                </Button>
                <Button variant="outline" onClick={handleFormatJson} className="gap-2">
                  <Code size={16} />
                  {t('cli.format')}
                </Button>
                <Button variant="outline" onClick={handleReset} className="gap-2">
                  <ArrowClockwise size={16} />
                  {t('cli.reset')}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-status-success-foreground">{t('cli.settingsSaved')}</span>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SettingsCard>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cli.confirmSaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cli.confirmSaveDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingSaveAction && handleSave(pendingSaveAction)}>
              {t('common.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Install wizard */}
      {installWizardOpen && (
        <InstallWizardDialog
          open={installWizardOpen}
          onOpenChange={(open) => {
            setInstallWizardOpen(open);
            if (!open) invalidateAndRefresh();
          }}
          onInstallComplete={async () => {
            await invalidateAndRefresh();
            setInstallWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InstallWizardDialog({ open, onOpenChange, onInstallComplete }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete: () => void;
}) {
  const { t } = useTranslation();
  const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.userAgent);
  const installCommand = isWindows
    ? 'irm https://claude.ai/install.ps1 | iex'
    : 'curl -fsSL https://claude.ai/install.sh | bash';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('cli.installTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('cli.installDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-3 rounded-md bg-muted p-3">
          <code className="text-xs font-mono select-all">{installCommand}</code>
        </div>
        <p className="text-xs text-muted-foreground">{t('cli.installAfter')}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onInstallComplete}>{t('cli.installDone')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
