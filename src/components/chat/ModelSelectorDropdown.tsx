'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, Gear } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';
import {
  CommandList,
  CommandListSearch,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
  CommandListFooter,
  CommandListFooterAction,
} from '@/components/patterns';

interface ModelOption {
  value: string;
  label: string;
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
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-mono">{currentModelOption?.label}</span>
        {isCurrentDefault && (
          <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium ml-0.5">
            {isZh ? '默认' : 'Default'}
          </span>
        )}
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        <CommandList className="w-64 mb-1.5">
          <CommandListSearch
            placeholder={t('composer.searchModels' as TranslationKey)}
            value={modelSearch}
            onChange={setModelSearch}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setModelMenuOpen(false);
                setModelSearch('');
              }
            }}
          />
          <CommandListItems>
            {filteredGroups.map((group, groupIdx) => {
              const isExpanded = !!mq || expandedGroups.has(group.provider_id);
              return (
              <CommandListGroup
                key={group.provider_id}
                label={group.provider_name}
                separator={groupIdx > 0}
                expandable={true}
                expanded={isExpanded}
                onToggle={() => toggleGroup(group.provider_id)}
              >
                {isExpanded && (
                <div className="py-0.5">
                  {group.models.map((opt) => {
                    const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                    const isDefault = !!(
                      globalDefaultModel &&
                      globalDefaultProvider &&
                      opt.value === globalDefaultModel &&
                      group.provider_id === globalDefaultProvider
                    );
                    return (
                      <CommandListItem
                        key={`${group.provider_id}-${opt.value}`}
                        active={isActive}
                        onClick={() => handleModelSelect(group.provider_id, opt.value)}
                        className="justify-between"
                      >
                        <span className="font-mono text-xs flex items-center gap-1.5">
                          {opt.label}
                          {isDefault && (
                            <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium">
                              {isZh ? '默认' : 'Default'}
                            </span>
                          )}
                        </span>
                        {isActive && <span className="text-xs">&#10003;</span>}
                      </CommandListItem>
                    );
                  })}
                </div>
                )}
              </CommandListGroup>
            )})}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                No models found
              </div>
            )}
          </CommandListItems>
          <CommandListFooter>
            <CommandListFooterAction onClick={() => { setModelMenuOpen(false); setModelSearch(''); window.location.href = '/settings#providers'; }}>
              <Gear size={14} />
              {t('composer.manageProviders' as TranslationKey)}
            </CommandListFooterAction>
          </CommandListFooter>
        </CommandList>
      )}
    </div>
  );
}
