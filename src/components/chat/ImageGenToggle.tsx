'use client';

import { cn } from '@/lib/utils';
import { useImageGen } from '@/hooks/useImageGen';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Image } from '@/components/ui/icon';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ImageGenToggle() {
  const { state, setEnabled } = useImageGen();
  const { t } = useTranslation();

  const handleToggle = () => {
    setEnabled(!state.enabled);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          onClick={handleToggle}
          className={cn(
            state.enabled ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          <Image size={16} />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>
        {t('composer.designAgentTooltip' as TranslationKey)}
      </TooltipContent>
    </Tooltip>
  );
}
