'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplyMode } from '@/types';
import { CaretDown } from '@/components/ui/icon';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { CommandList, CommandListGroup, CommandListItem } from '@/components/patterns';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';

interface ReplyModeSelectorDropdownProps {
  replyMode: ReplyMode;
  onReplyModeChange: (mode: ReplyMode) => void;
}

const REPLY_MODES: ReplyMode[] = ['fast', 'smart', 'deep'];

export function ReplyModeSelectorDropdown({
  replyMode,
  onReplyModeChange,
}: ReplyModeSelectorDropdownProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton onClick={() => setOpen((prev) => !prev)}>
        <span className="text-xs">{t(`messageInput.replyMode.${replyMode}` as TranslationKey)}</span>
        <CaretDown size={10} className={cn('transition-transform duration-200', open && 'rotate-180')} />
      </PromptInputButton>

      {open && (
        <CommandList className="w-44 mb-1.5 rounded-lg">
          <CommandListGroup label={t('messageInput.replyMode.label' as TranslationKey)}>
            <div className="py-0.5">
              {REPLY_MODES.map((mode) => (
                <CommandListItem
                  key={mode}
                  active={replyMode === mode}
                  onClick={() => {
                    onReplyModeChange(mode);
                    setOpen(false);
                  }}
                  className="justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-xs">{t(`messageInput.replyMode.${mode}` as TranslationKey)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {t(`messageInput.replyMode.${mode}Desc` as TranslationKey)}
                    </div>
                  </div>
                  {replyMode === mode && <span className="text-xs">&#10003;</span>}
                </CommandListItem>
              ))}
            </div>
          </CommandListGroup>
        </CommandList>
      )}
    </div>
  );
}
