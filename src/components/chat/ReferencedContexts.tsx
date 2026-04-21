import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Code, Book, CaretRight, CaretDown } from '@/components/ui/icon';
import { usePanel } from '@/hooks/usePanel';

interface ReferencedContextsProps {
  files: string[];
  className?: string;
  isStreaming?: boolean;
}

export function ReferencedContexts({ files, className, isStreaming }: ReferencedContextsProps) {
  const { setPreviewFile, setPreviewOpen } = usePanel();
  const [expanded, setExpanded] = useState(true);

  // Automatically collapse when streaming finishes
  useEffect(() => {
    if (isStreaming === false) {
      setExpanded(false);
    }
  }, [isStreaming]);

  if (!files || files.length === 0) return null;

  const handleOpenFile = (path: string) => {
    setPreviewFile(path);
    setPreviewOpen(true);
  };

  const fname = (p: string) => p.split('/').pop() || p;

  return (
    <div className={cn("mb-3", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 text-[12px] text-muted-foreground transition-colors mb-2"
      >
        {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <span>参考了 {files.length} 个上下文</span>
      </button>

      {expanded && (
        <div className="flex items-start gap-2 pl-1">
          <Book size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, idx) => {
              const isAgents = file.includes('AGENTS.md');
              const isClaude = file.includes('CLAUDE.md');
              const isRules = file.includes('rules.md');
              
              return (
                <button 
                  key={idx}
                  onClick={() => handleOpenFile(file)}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/40 bg-muted/20 text-[11px] text-muted-foreground/90 font-medium hover:bg-muted/40 hover:border-border/60 transition-colors"
                >
                  <Code size={12} className={cn(
                    "text-indigo-500/70", // Default purple-ish color for markdown rules
                    isAgents && "text-blue-500/70",
                    isRules && "text-emerald-500/70"
                  )} />
                  <span>{fname(file)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
