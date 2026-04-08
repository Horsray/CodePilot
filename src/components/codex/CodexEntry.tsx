'use client';

import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useCodex } from '@/lib/codex/context';
import { cn } from '@/lib/utils';

export function CodexEntry() {
  const { enabled, isPanelOpen, openCodexPanel, closeCodexPanel } = useCodex();
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (isPanelOpen) {
      closeCodexPanel();
    } else {
      openCodexPanel();
    }
  };

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClick}
            className={cn(
              'flex items-center gap-2 px-3 h-8 transition-all duration-200',
              isPanelOpen && 'bg-accent text-accent-foreground',
              !enabled && 'opacity-50'
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="shrink-0"
            >
              <path
                d="M12 2L2 7L12 12L22 7L12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 17L12 22L22 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {hovered && (
              <span className="text-xs font-medium animate-in fade-in-50 duration-150">
                Codex
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>Codex Extensions</p>
          <p className="text-muted-foreground">{enabled ? 'Click to open' : 'Disabled'}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
