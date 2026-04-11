import React from 'react';
import { cn } from '@/lib/utils';
import { Code, Book } from '@/components/ui/icon';
import { usePanel } from '@/hooks/usePanel';

interface ReferencedContextsProps {
  files: string[];
  className?: string;
}

export function ReferencedContexts({ files, className }: ReferencedContextsProps) {
  const { setPreviewFile, setPreviewOpen } = usePanel();

  if (!files || files.length === 0) return null;

  const handleOpenFile = (path: string) => {
    setPreviewFile(path);
    setPreviewOpen(true);
  };

  const fname = (p: string) => p.split('/').pop() || p;

  return (
    <div className={cn("flex flex-wrap gap-1.5 mb-3", className)}>
      {files.map((file, idx) => {
        const isAgents = file.includes('AGENTS.md');
        const isClaude = file.includes('CLAUDE.md');
        const isRules = file.includes('rules.md');
        
        return (
          <button 
            key={idx}
            onClick={() => handleOpenFile(file)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/40 bg-muted/20 text-[10px] text-muted-foreground/80 font-medium hover:bg-muted/40 hover:border-border/60 transition-colors"
          >
            <Code size={11} className={cn(
              isAgents && "text-blue-500/70",
              isClaude && "text-indigo-500/70",
              isRules && "text-emerald-500/70"
            )} />
            <span>{fname(file)}</span>
          </button>
        );
      })}
    </div>
  );
}
