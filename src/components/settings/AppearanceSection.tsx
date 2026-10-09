"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { codeToHtml, type BundledTheme } from "shiki";
import { SHIKI_DEFAULT_LIGHT, SHIKI_DEFAULT_DARK } from "@/lib/theme/code-themes";
import { useTranslation } from "@/hooks/useTranslation";
import { Sun, Moon, Desktop, Play } from "@/components/ui/icon";
import {
  NOTIFICATION_SOUNDS,
  getSelectedNotificationSound,
  setSelectedNotificationSound,
  playNotificationSound,
  type NotificationSoundId,
} from "@/lib/notificationSound";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import {
  useProcessCollapseEnabled,
  setCollapseProcessOnDeliver,
} from "@/hooks/useProcessCollapse";

// ── Theme Mode Pill Selector ────────────────────────────────────────

const MODE_OPTIONS = [
  { value: "light", icon: Sun, labelKey: "settings.modeLight" as const },
  { value: "dark", icon: Moon, labelKey: "settings.modeDark" as const },
  { value: "system", icon: Desktop, labelKey: "settings.modeSystem" as const },
] as const;

function ThemeModePills({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center rounded-lg border border-border/50 p-1 gap-1" role="radiogroup">
      {MODE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Button
            key={opt.value}
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all h-auto",
              selected
                ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <opt.icon size={14} />
            {t(opt.labelKey)}
          </Button>
        );
      })}
    </div>
  );
}

// ── Shiki Code Preview ──────────────────────────────────────────────

const PREVIEW_CODE = `function greet(name: string) {
  const time = new Date().getHours();
  if (time < 12) return \`Good morning, \${name}\`;
  return \`Hello, \${name}\`;
}`;

function ShikiCodePreview({ isDark }: { isDark: boolean }) {
  // 中文注释：多主题家族已移除，代码预览固定使用默认 Shiki 亮/暗主题。
  const theme: BundledTheme = isDark ? SHIKI_DEFAULT_DARK : SHIKI_DEFAULT_LIGHT;
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(PREVIEW_CODE, {
      lang: "typescript",
      theme,
    }).then((result) => {
      if (!cancelled) setHtml(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [theme]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-muted text-muted-foreground">
        <span className="font-medium">preview.ts</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">TypeScript</span>
      </div>
      {html ? (
        <div
          className="shiki-preview [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!text-xs [&_pre]:!leading-relaxed [&_pre]:!p-2 [&_code]:!text-xs"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      )}
    </div>
  );
}

// ── Notification Sound Selector (移植自 cc-haha) ────────────────────

function NotificationSoundSelector() {
  const [selected, setSelected] = useState<NotificationSoundId>(getSelectedNotificationSound());

  // 中文注释：点击即选中并试听（cc-haha 同款交互），偏好存 localStorage。
  const handleSelect = useCallback((id: NotificationSoundId) => {
    setSelected(id);
    setSelectedNotificationSound(id);
    playNotificationSound(id);
  }, []);

  return (
    <div className="flex flex-wrap gap-2">
      {NOTIFICATION_SOUNDS.map((sound) => (
        <button
          key={sound.id}
          type="button"
          onClick={() => handleSelect(sound.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
            selected === sound.id
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          )}
        >
          <Play size={13} />
          {sound.label}
        </button>
      ))}
    </div>
  );
}

// ── UI Token Preview ────────────────────────────────────────────────

function UIPreview() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" className="text-xs h-auto py-1">Primary</Button>
      <Button size="sm" variant="secondary" className="text-xs h-auto py-1">Secondary</Button>
      <Button size="sm" variant="destructive" className="text-xs h-auto py-1">Destructive</Button>
      <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-medium text-accent-foreground">
        Badge
      </span>
      <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] text-card-foreground">
        Card
      </span>
      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] text-muted-foreground">
        Muted
      </span>
    </div>
  );
}

// ── Main Appearance Section ─────────────────────────────────────────

/** Persist theme setting to DB so it survives across sessions */
function persistThemeSetting(key: string, value: string) {
  fetch('/api/settings/app', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { [key]: value } }),
  }).catch(() => { /* best-effort */ });
}

export function AppearanceSection() {
  const { theme, setTheme: setThemeRaw, resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = resolvedTheme === "dark";
  // 中文注释：交付折叠开关 —— 偏好在 useProcessCollapse 里自管（localStorage + 订阅），
  // 所以这里直接读写即可，切换后对话流会立刻跟着变，不需要刷新。
  const collapseProcess = useProcessCollapseEnabled();

  const setTheme = useCallback((mode: string) => {
    setThemeRaw(mode);
    persistThemeSetting('theme_mode', mode);
  }, [setThemeRaw]);

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) return null;

  return (
    <div className="space-y-4">
      {/* Section header — outside card */}
      <div>
        <h2 className="text-sm font-medium">{t("settings.appearance")}</h2>
        <p className="text-xs text-muted-foreground">{t("settings.appearanceDesc")}</p>
      </div>

      <SettingsCard>
      {/* Mode */}
      <FieldRow
        label={t("settings.themeMode")}
        description={t("settings.themeModeDesc")}
      >
        <ThemeModePills value={theme || "system"} onChange={setTheme} />
      </FieldRow>

      {theme === "system" && resolvedTheme && (
        <p className="text-[11px] text-muted-foreground pl-1">
          {resolvedTheme === "dark" ? t("settings.modeDark") : t("settings.modeLight")}
        </p>
      )}

      {/* 任务完成提示音（对齐 cc-haha：三档合成音，点击试听） */}
      <FieldRow
        label="提示音"
        description="任务完成时的提示音效，点击即可试听并选择"
        separator
      >
        <NotificationSoundSelector />
      </FieldRow>

      {/* 交付折叠：助手开始输出结论时收起思考与工具调用过程（默认开启） */}
      <FieldRow
        label="交付时收起过程"
        description="助手开始输出最终结论时，把前面的思考与工具调用收起成一条汇总，只留下结论；点击汇总可随时展开回看"
        separator
      >
        <Switch
          checked={collapseProcess}
          onCheckedChange={setCollapseProcessOnDeliver}
          aria-label="交付时收起过程"
        />
      </FieldRow>

      {/* Preview */}
      <div className="border-t border-border/30 pt-4 space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">Preview</h3>
        <UIPreview />
        <ShikiCodePreview isDark={isDark} />
      </div>
      </SettingsCard>
    </div>
  );
}
