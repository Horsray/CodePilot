"use client";

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { ProviderOptions } from "@/types";

interface ProviderOptionsSectionProps {
  providerId: string;
  /** Show thinking mode + 1M context options (only for Anthropic-compatible providers) */
  showThinkingOptions?: boolean;
  /** When true, shows a simplified on/off toggle instead of adaptive/enabled/disabled select */
  isDeepseek?: boolean;
}

/**
 * Per-provider options: thinking mode + 1M context toggle.
 * For Anthropic: adaptive/enabled/disabled select + 1M context toggle.
 * For Deepseek: enabled/disabled switch (default: enabled per Deepseek API docs).
 */
export function ProviderOptionsSection({ providerId, showThinkingOptions = false, isDeepseek = false }: ProviderOptionsSectionProps) {
  const { t } = useTranslation();
  // Deepseek defaults to enabled (per API docs: "默认思考开关为 enabled")
  const [options, setOptions] = useState<ProviderOptions>({
    thinking_mode: isDeepseek ? 'enabled' : 'adaptive',
    context_1m: false,
    reasoning_effort: isDeepseek ? 'max' : undefined,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/providers/options?providerId=${encodeURIComponent(providerId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) {
          const opts = data.options || {};
          // Deepseek: default to enabled + max effort if no saved value
          if (isDeepseek) {
            if (!opts.thinking_mode) opts.thinking_mode = 'enabled';
            if (!opts.reasoning_effort) opts.reasoning_effort = 'max';
          }
          setOptions(opts);
        }
        if (!cancelled) setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [providerId, isDeepseek]);

  const saveOption = async (key: keyof ProviderOptions, value: string | boolean) => {
    const updated = { ...options, [key]: value };
    setOptions(updated);
    try {
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, options: { [key]: value } }),
      });
    } catch { /* ignore */ }
  };

  if (!loaded || !showThinkingOptions) return null;

  return (
    <div className="ml-[34px] mt-2 space-y-2.5">
      {/* Thinking mode */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground/80">
            {isDeepseek ? t('settings.thinkingModeDeepseek' as TranslationKey) : t('settings.thinkingMode' as TranslationKey)}
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {isDeepseek ? t('settings.thinkingModeDeepseekDesc' as TranslationKey) : t('settings.thinkingModeDesc' as TranslationKey)}
          </p>
        </div>
        {isDeepseek ? (
          // Deepseek: simple on/off switch — no adaptive mode
          <Switch
            checked={options.thinking_mode === 'enabled'}
            onCheckedChange={(checked) => saveOption('thinking_mode', checked ? 'enabled' : 'disabled')}
            className="scale-[0.85]"
          />
        ) : (
          // Anthropic: adaptive/enabled/disabled select
          <Select
            value={options.thinking_mode || 'adaptive'}
            onValueChange={(v) => saveOption('thinking_mode', v)}
          >
            <SelectTrigger className="w-[110px] h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adaptive">{t('settings.thinkingAdaptive' as TranslationKey)}</SelectItem>
              <SelectItem value="enabled">{t('settings.thinkingEnabled' as TranslationKey)}</SelectItem>
              <SelectItem value="disabled">{t('settings.thinkingDisabled' as TranslationKey)}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 1M context toggle — Anthropic-only, hidden for Deepseek */}
      {!isDeepseek && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-foreground/80">
              {t('provider.context1m' as TranslationKey)}
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('provider.context1mDesc' as TranslationKey)}
            </p>
          </div>
          <Switch
            checked={options.context_1m || false}
            onCheckedChange={(checked) => saveOption('context_1m', checked)}
            className="scale-[0.85]"
          />
        </div>
      )}
    </div>
  );
}
