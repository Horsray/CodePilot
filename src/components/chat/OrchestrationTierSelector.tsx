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

export type OrchestrationTier = 'single' | 'dual' | 'multi';

interface OrchestrationTierSelectorProps {
  value: OrchestrationTier;
  onChange: (tier: OrchestrationTier) => void;
}

export function OrchestrationTierSelector({ value, onChange }: OrchestrationTierSelectorProps) {
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
      value: 'dual', 
      label: '双模型 (Dual)', 
      description: '主模型用 MiniMax，验证者用本地 Qwen' 
    },
    { 
      value: 'multi', 
      label: '多模型 (Multi)', 
      description: '架构师 Opus，执行者 MiniMax，验证者 Qwen' 
    },
  ];

  const currentOption = options.find(o => o.value === value) || options[0];

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        onClick={() => setOpen((prev) => !prev)}
        className={cn(value !== 'single' && "text-primary bg-primary/5 border-primary/20")}
      >
        <Layout size={14} className={cn(value !== 'single' && "text-primary")} />
        <span className="text-xs font-medium ml-1">Tier: {currentOption.label.split(' ')[0]}</span>
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
            </div>
          </CommandListItems>
        </CommandList>
      )}
    </div>
  );
}

// 中文注释：模型协同等级选择器。允许用户切换单模型、双模型或多模型协同策略。
// 单模型：全部使用主模型。
// 双模型：MiniMax + 本地 Qwen。
// 多模型：Opus + MiniMax + Qwen。
