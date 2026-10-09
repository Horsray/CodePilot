"use client";

import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { useTranslation } from "@/hooks/useTranslation";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";
import { AppearanceSection } from "./AppearanceSection";

/**
 * `UpdateCard`（含「检查更新」按钮 / 新版本横幅）已彻底移除：
 * 本 fork 不发版、不与上游整合，不再向用户展示任何更新提示。
 * `currentVersion` 仍保留供版本号只读展示。
 */
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

export function GeneralSection() {
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [generativeUI, setGenerativeUI] = useState(true);
  const [generativeUISaving, setGenerativeUISaving] = useState(false);
  const [defaultPanel, setDefaultPanel] = useState('file_tree');
  const [includeAgentsMd, setIncludeAgentsMd] = useState(true);
  const [includeClaudeMd, setIncludeClaudeMd] = useState(true);
  const [enableAgentsSkills, setEnableAgentsSkills] = useState(true);
  const [assistantSaving, setAssistantSaving] = useState(false);
  const { accountInfo } = useAccountInfo();
  const { t, locale, setLocale } = useTranslation();

  const fetchAppSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const appSettings = data.settings || {};
        setSkipPermissions(appSettings.dangerously_skip_permissions === "true");
        // generative_ui_enabled defaults to true when not set
        setGenerativeUI(appSettings.generative_ui_enabled !== "false");
        // default_panel defaults to 'file_tree' when not set
        setDefaultPanel(appSettings.default_panel || 'file_tree');
        
        setIncludeAgentsMd(appSettings.include_agents_md !== "false");
        setIncludeClaudeMd(appSettings.include_claude_md !== "false");
        setEnableAgentsSkills(appSettings.enable_agents_skills !== "false");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAppSettings();
  }, [fetchAppSettings]);

  const handleSkipPermToggle = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
    } else {
      saveSkipPermissions(false);
    }
  };

  const saveSkipPermissions = async (enabled: boolean) => {
    setSkipPermSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { dangerously_skip_permissions: enabled ? "true" : "" },
        }),
      });
      if (res.ok) {
        setSkipPermissions(enabled);
      }
    } catch {
      // ignore
    } finally {
      setSkipPermSaving(false);
      setShowSkipPermWarning(false);
    }
  };

  const handleDefaultPanelChange = async (value: string) => {
    setDefaultPanel(value);
    try {
      await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { default_panel: value } }),
      });
    } catch {
      // ignore
    }
  };

  const handleGenerativeUIToggle = async (checked: boolean) => {
    setGenerativeUISaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { generative_ui_enabled: checked ? "" : "false" },
        }),
      });
      if (res.ok) {
        setGenerativeUI(checked);
      }
    } catch {
      // ignore
    } finally {
      setGenerativeUISaving(false);
    }
  };

  const handleAssistantSettingToggle = async (key: string, value: boolean) => {
    setAssistantSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { [key]: value ? "" : "false" },
        }),
      });
      if (res.ok) {
        if (key === 'include_agents_md') setIncludeAgentsMd(value);
        if (key === 'include_claude_md') setIncludeClaudeMd(value);
        if (key === 'enable_agents_skills') setEnableAgentsSkills(value);
      }
    } catch {
      // ignore
    } finally {
      setAssistantSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* 只读版本号卡片：保留可见性，但不再提供任何「检查更新」入口或提示。 */}
      <SettingsCard>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t('settings.codepilot' as TranslationKey)}</h2>
            <p className="text-xs text-muted-foreground">
              {t('settings.version' as TranslationKey, { version: CURRENT_VERSION })}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('settings.updateCheckDisabled' as TranslationKey)}
          </span>
        </div>
      </SettingsCard>

      {/* General settings card */}
      <SettingsCard className={skipPermissions ? "border-status-warning-border bg-status-warning-muted" : undefined}>
        {/* Auto-approve toggle */}
        <FieldRow
          label={t('settings.autoApproveTitle')}
          description={t('settings.autoApproveDesc')}
        >
          <Switch
            checked={skipPermissions}
            onCheckedChange={handleSkipPermToggle}
            disabled={skipPermSaving}
          />
        </FieldRow>
        {skipPermissions && (
          <StatusBanner variant="warning">
            <span className="h-2 w-2 shrink-0 rounded-full bg-status-warning inline-block mr-1" />
            {t('settings.autoApproveWarning')}
          </StatusBanner>
        )}

        {/* Generative UI toggle */}
        <FieldRow
          label={t('settings.generativeUITitle')}
          description={t('settings.generativeUIDesc')}
          separator
        >
          <Switch
            checked={generativeUI}
            onCheckedChange={handleGenerativeUIToggle}
            disabled={generativeUISaving}
          />
        </FieldRow>

        {/* Default panel */}
        <FieldRow
          label={t('settings.defaultPanelTitle')}
          description={t('settings.defaultPanelDesc')}
          separator
        >
          <Select value={defaultPanel} onValueChange={handleDefaultPanelChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('settings.defaultPanelNone')}</SelectItem>
              <SelectItem value="file_tree">{t('settings.defaultPanelFileTree')}</SelectItem>
              <SelectItem value="dashboard">{t('settings.defaultPanelDashboard')}</SelectItem>
              <SelectItem value="git">{t('settings.defaultPanelGit')}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>

        {/* Language picker */}
        <FieldRow
          label={t('settings.language')}
          description={t('settings.languageDesc')}
          separator
        >
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        {/* Setup Center */}
        <FieldRow
          label={t('setup.openSetupCenter')}
          description={t('setup.openSetupCenterDesc')}
          separator
        >
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('open-setup-center'))}
          >
            {t('setup.open')}
          </Button>
        </FieldRow>

        {/* Error Reporting — right after Setup Center */}
        <SentryToggle locale={locale} t={t} />

      </SettingsCard>

      {/* Appearance */}
      <AppearanceSection />

      {/* Account info */}
      {accountInfo && (
        <SettingsCard title={t('settings.accountInfo' as TranslationKey)}>
          <div className="space-y-1">
            {accountInfo.email && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t('settings.email' as TranslationKey)}:</span> {accountInfo.email}
              </p>
            )}
            {accountInfo.organization && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t('settings.organization' as TranslationKey)}:</span> {accountInfo.organization}
              </p>
            )}
            {accountInfo.subscriptionType && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t('settings.subscription' as TranslationKey)}:</span> {accountInfo.subscriptionType}
              </p>
            )}
          </div>
        </SettingsCard>
      )}

      {/* Skip-permissions warning dialog */}
      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.autoApproveDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t('settings.autoApproveDialogDesc')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('settings.autoApproveShellCommands')}</li>
                  <li>{t('settings.autoApproveFileOps')}</li>
                  <li>{t('settings.autoApproveNetwork')}</li>
                </ul>
                <p className="font-medium text-status-warning-foreground">
                  {t('settings.autoApproveTrustWarning')}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => saveSkipPermissions(true)}
              className="bg-status-warning hover:bg-status-warning/80 text-white"
            >
              {t('settings.enableAutoApprove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

/* ── Sentry opt-out toggle (isolated state) ──────────────────── */

const sentrySubscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
const getSentryEnabled = () => {
  try { return localStorage.getItem('codepilot:sentry-disabled') !== 'true'; } catch { return true; }
};
const getSentryEnabledServer = () => true; // SSR default

function SentryToggle({ locale, t }: { locale: string; t: (key: TranslationKey) => string }) {
  const enabled = useSyncExternalStore(sentrySubscribe, getSentryEnabled, getSentryEnabledServer);

  return (
    <FieldRow
      label={t('settings.errorReporting' as TranslationKey)}
      description={t('settings.errorReportingDesc' as TranslationKey)}
      separator
    >
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => {
          const disabled = !checked;
          try {
            localStorage.setItem('codepilot:sentry-disabled', disabled ? 'true' : 'false');
            window.dispatchEvent(new StorageEvent('storage'));
          } catch { /* ignore */ }
          fetch('/api/settings/sentry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disabled }),
          }).catch(() => { /* ignore */ });
        }}
      />
    </FieldRow>
  );
}
