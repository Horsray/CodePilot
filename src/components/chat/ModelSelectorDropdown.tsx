'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  CaretDown,
  CaretUp,
  Gear,
  MagnifyingGlass,
  Robot,
  PlugsConnected,
  Check,
} from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { ProviderModelGroup } from '@/types';

interface ModelOption {
  value: string;
  label: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

interface ModelSelectorDropdownProps {
  currentModelValue: string;
  currentProviderIdValue: string;
  providerGroups: ProviderModelGroup[];
  modelOptions: ModelOption[];
  onModelChange?: (model: string) => void;
  onProviderModelChange?: (providerId: string, model: string) => void;
  /** Global default model value */
  globalDefaultModel?: string;
  /** Global default model's provider ID */
  globalDefaultProvider?: string;
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  modelOptions,
  onModelChange,
  onProviderModelChange,
  globalDefaultModel,
  globalDefaultProvider,
}: ModelSelectorDropdownProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set([currentProviderIdValue]));

  const currentModelOption = modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0];

  // Is the currently displayed model the global default?
  const isCurrentDefault = !!(
    globalDefaultModel &&
    globalDefaultProvider &&
    currentModelValue === globalDefaultModel &&
    currentProviderIdValue === globalDefaultProvider
  );

  // Click outside to close model menu
  useEffect(() => {
    if (!modelMenuOpen) return;
    setExpandedGroups(new Set([currentProviderIdValue]));
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
        setModelSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen, currentProviderIdValue]);

  const handleModelSelect = useCallback((providerId: string, modelValue: string) => {
    onModelChange?.(modelValue);
    onProviderModelChange?.(providerId, modelValue);
    localStorage.setItem('codepilot:last-model', modelValue);
    localStorage.setItem('codepilot:last-provider-id', providerId);
    setModelMenuOpen(false);
    setModelSearch('');
  }, [onModelChange, onProviderModelChange]);

  const mq = modelSearch.toLowerCase();

  const sortedGroups = providerGroups.slice().sort((a, b) => {
    // Multi-head provider first
    const aIsMulti = a.protocol === 'multi_head';
    const bIsMulti = b.protocol === 'multi_head';
    if (aIsMulti && !bIsMulti) return -1;
    if (!aIsMulti && bIsMulti) return 1;

    // Claude Code provider last
    const aIsEnv = a.provider_id === 'env';
    const bIsEnv = b.provider_id === 'env';
    if (aIsEnv && !bIsEnv) return 1;
    if (!aIsEnv && bIsEnv) return -1;

    return 0;
  });

  const filteredGroups = sortedGroups.map(group => ({
    ...group,
    models: group.models.filter(opt =>
      !mq || opt.label.toLowerCase().includes(mq) || group.provider_name.toLowerCase().includes(mq)
    ),
  })).filter(group => group.models.length > 0);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <div className="relative" ref={modelMenuRef}>
      {/* 中文注释：对齐 cc-haha ModelSelector 触发器——透明文本按钮，模型名 + 下箭头，
          不做底色 hover，仅文字颜色随 hover 提亮。 */}
      <button
        type="button"
        onClick={() => setModelMenuOpen((prev) => !prev)}
        className="flex items-center gap-1 bg-transparent text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{currentModelOption?.label}</span>
        {isCurrentDefault && (
          <span className="rounded bg-[var(--color-brand)]/10 px-1 py-0 text-[9px] font-medium text-[var(--color-brand)]">
            {isZh ? '默认' : 'Default'}
          </span>
        )}
        <CaretDown size={14} className={cn("flex-shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </button>

      {modelMenuOpen && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[360px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          <div className="max-h-[420px] overflow-y-auto p-3">
            {/* 搜索框 */}
            <div className="relative mb-3">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                type="text"
                placeholder={t('composer.searchModels' as TranslationKey)}
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setModelMenuOpen(false);
                    setModelSearch('');
                  }
                }}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-8 pr-3 text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)]"
              />
            </div>

            {/* 分组 + 模型项（对齐 cc-haha：provider 名分组可折叠，模型项为图标 + 名称 + 描述 + 选中勾） */}
            <div className="space-y-3">
              {filteredGroups.map((group) => {
                const isExpanded = !!mq || expandedGroups.has(group.provider_id);
                const isOfficial = group.provider_id === 'env';
                return (
                  <div key={group.provider_id} className="space-y-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleGroup(group.provider_id);
                      }}
                      className="group flex w-full items-center justify-between rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="text-[12px] font-bold text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-text-secondary)]">
                        {group.provider_name}
                      </span>
                      {isExpanded ? (
                        <CaretUp size={14} className="text-[var(--color-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
                      ) : (
                        <CaretDown size={14} className="text-[var(--color-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="space-y-0.5">
                        {group.models.map((opt) => {
                          const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                          const isDefault = !!(
                            globalDefaultModel &&
                            globalDefaultProvider &&
                            opt.value === globalDefaultModel &&
                            group.provider_id === globalDefaultProvider
                          );
                          return (
                            <button
                              key={`${group.provider_id}-${opt.value}`}
                              type="button"
                              onClick={() => handleModelSelect(group.provider_id, opt.value)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors",
                                isActive
                                  ? 'bg-[var(--color-surface-container-high)]'
                                  : 'bg-transparent hover:bg-[var(--color-surface-hover)]'
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                {isOfficial ? (
                                  <Robot size={16} className={cn("flex-shrink-0", isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')} />
                                ) : (
                                  <PlugsConnected size={16} className={cn("flex-shrink-0", isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')} />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className={cn("truncate text-sm font-medium", isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}>
                                    {opt.label}
                                    {isDefault && (
                                      <span className="ml-1.5 rounded bg-[var(--color-brand)]/10 px-1 py-0 text-[9px] font-medium text-[var(--color-brand)]">
                                        {isZh ? '默认' : 'Default'}
                                      </span>
                                    )}
                                  </div>
                                  {opt.description && (
                                    <div className="mt-0.5 truncate pr-[6px] text-[10px] text-[var(--color-text-tertiary)]">
                                      {opt.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isActive && <Check size={16} className="flex-shrink-0 text-[var(--color-success)]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredGroups.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-[var(--color-text-tertiary)]">
                  {t('composer.noModelsFound' as TranslationKey)}
                </div>
              )}
            </div>
          </div>

          {/* 底部：管理服务商入口（CodePilot 特有，视觉对齐 cc-haha 的 footer 分隔区） */}
          <div className="border-t border-[var(--color-border)] p-1.5">
            <button
              type="button"
              onClick={() => { setModelMenuOpen(false); setModelSearch(''); window.location.href = '/settings#providers'; }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <Gear size={14} />
              {t('composer.manageProviders' as TranslationKey)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
