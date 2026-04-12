'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, Layout } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
} from '@/components/patterns';

export type OrchestrationTier = 'single' | 'multi';

interface OrchestrationTierSelectorProps {
  value: OrchestrationTier;
  onChange: (tier: OrchestrationTier) => void;
  profiles?: Array<{ id: string; name: string }>;
  profileId?: string;
  onProfileChange?: (profileId: string) => void;
}

export function OrchestrationTierSelector({
  value,
  onChange,
  profiles = [],
  profileId,
  onProfileChange,
}: OrchestrationTierSelectorProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Click outside to close menu
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback((tier: OrchestrationTier) => {
    onChange(tier);
    setOpen(false);
  }, [onChange]);

  const options: Array<{ value: OrchestrationTier; label: string; description: string }> = [
    { 
      value: 'single', 
      label: '单模型 (Single)', 
      description: '所有角色共用当前选择的主模型' 
    },
    { 
      value: 'multi', 
      label: '多模型 (Multi)', 
      description: '总指挥按任务类型调度知识检索、视觉理解、执行和质检角色' 
    },
  ];

  const currentOption = options.find(o => o.value === value) || options[0];
  const activeProfile = profiles.find((profile) => profile.id === profileId) || profiles[0];
  const buttonLabel = value === 'multi' && activeProfile
    ? `Tier: 多模型-${activeProfile.name}`
    : `Tier: ${currentOption.label.split(' ')[0]}`;

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        onClick={() => setOpen((prev) => !prev)}
        className={cn(value !== 'single' && "text-primary bg-primary/5 border-primary/20")}
      >
        <Layout size={14} className={cn(value !== 'single' && "text-primary")} />
        <span className="text-xs font-medium ml-1">{buttonLabel}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200 ml-0.5", open && "rotate-180")} />
      </PromptInputButton>

      {open && (
        <CommandList className="w-64 mb-1.5">
          <CommandListItems>
            <div className="py-1 px-1">
              {options.map((opt) => (
                <CommandListItem
                  key={opt.value}
                  active={opt.value === value}
                  onClick={() => handleSelect(opt.value)}
                  className="flex-col items-start gap-0.5 py-2"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold">{opt.label}</span>
                    {opt.value === value && <span className="text-xs text-primary">&#10003;</span>}
                  </div>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {opt.description}
                  </span>
                </CommandListItem>
              ))}

              {value === 'multi' && profiles.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    多模型配置
                  </div>
                  {profiles.map((profile) => (
                    <CommandListItem
                      key={profile.id}
                      active={profile.id === activeProfile?.id}
                      onClick={() => {
                        onProfileChange?.(profile.id);
                        setOpen(false);
                      }}
                      className="py-2"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold">{`多模型-${profile.name}`}</span>
                        {profile.id === activeProfile?.id && <span className="text-xs text-primary">&#10003;</span>}
                      </div>
                    </CommandListItem>
                  ))}
                </>
              )}
            </div>
          </CommandListItems>
        </CommandList>
      )}
    </div>
  );
}

// 中文注释：模型协同等级选择器。允许用户切换单模型或多模型协同策略。
// 单模型：全部使用主模型。
// 多模型：由总指挥编排多个专门角色。
