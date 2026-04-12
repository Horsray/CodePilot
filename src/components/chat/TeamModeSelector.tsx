'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, ChatsCircle } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
} from '@/components/patterns';

export type TeamMode = 'off' | 'on' | 'auto';

interface TeamModeSelectorProps {
  value: TeamMode;
  onChange: (mode: TeamMode) => void;
}

export function TeamModeSelector({ value, onChange }: TeamModeSelectorProps) {
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

  const handleSelect = useCallback((mode: TeamMode) => {
    onChange(mode);
    setOpen(false);
  }, [onChange]);

  const options: Array<{ value: TeamMode; label: string; description: string }> = [
    { 
      value: 'off', 
      label: '关闭 (Off)', 
      description: '单智能体模式，响应最快' 
    },
    { 
      value: 'on', 
      label: '开启 (On)', 
      description: '协同编排模式，多角色参与，适合复杂任务' 
    },
    { 
      value: 'auto', 
      label: '自动 (Auto)', 
      description: '根据任务复杂度自动决定是否启用协同' 
    },
  ];

  const currentOption = options.find(o => o.value === value) || options[0];

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        onClick={() => setOpen((prev) => !prev)}
        className={cn(value !== 'off' && "text-primary bg-primary/5 border-primary/20")}
      >
        <ChatsCircle size={14} className={cn(value !== 'off' && "text-primary")} />
        <span className="text-xs font-medium ml-1">Team: {currentOption.label.split(' ')[0]}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200 ml-0.5", open && "rotate-180")} />
      </PromptInputButton>

      {open && (
        <CommandList className="w-56 mb-1.5">
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

// 中文注释：Team 模式选择器组件。允许用户在聊天界面切换协同编排模式（关闭/开启/自动）。
// 开启后，Agent 将采用多角色（Architect/Executor/Verifier）协同策略。
