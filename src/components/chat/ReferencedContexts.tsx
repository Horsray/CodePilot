import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Code, Book, CaretRight, CaretDown, FolderOpen, Copy } from '@/components/ui/icon';
import { usePanel } from '@/hooks/usePanel';
import { showToast } from '@/hooks/useToast';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';

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
    // If the path contains (Global) or (user) suffix, clean it up before opening
    let cleanPath = path;
    // DO NOT strip 'Rule: ' prefix here, pass it to the backend so it knows it's a virtual rule
    cleanPath = cleanPath.replace(/\s*\([^)]*\)$/, '').trim();

    setPreviewFile(cleanPath);
    setPreviewOpen(true);
  };

  const handleRevealInFinder = async (path: string) => {
    if (path.startsWith('Rule: ') || path.includes('Subdirectory Hints') || path.startsWith('http://') || path.startsWith('https://')) {
      showToast({ message: "虚拟文件或网页无法在文件管理器中打开", type: "info" });
      return;
    }
    try {
      const res = await fetch('/api/utils/open-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, reveal: true }),
      });
      if (!res.ok) throw new Error('Failed to reveal');
    } catch (err) {
      showToast({ message: "打开文件所在目录失败", type: "error" });
    }
  };

  const handleCopyPath = (path: string) => {
    if (path.startsWith('Rule: ')) {
      navigator.clipboard.writeText(path.substring(6).replace(/\s*\([^)]*\)$/, '').trim());
    } else {
      navigator.clipboard.writeText(path.replace(/\s*\([^)]*\)$/, '').trim());
    }
    showToast({ message: "已复制文件路径", type: "success" });
  };

  const fname = (p: string) => {
    const name = p.split('/').pop() || p;
    // Strip 'Rule: ' and trailing metadata for cleaner display
    let cleanName = name;
    if (cleanName.startsWith('Rule: ')) {
      cleanName = cleanName.substring(6).trim();
    }
    return cleanName.replace(/\s*\([^)]*\)$/, '').trim();
  };

  return (
    <div className={cn("mb-3", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-muted/30 hover:bg-muted/50 text-[11px] text-muted-foreground transition-colors mb-2"
      >
        {expanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
        <span>参考了 {files.length} 个上下文</span>
      </button>

      {expanded && (
        <div className="flex items-start gap-1.5 pl-0.5">
          <Book size={12} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, idx) => {
              const isAgents = file.includes('AGENTS.md');
              const isClaude = file.includes('CLAUDE.md');
              const isRules = file.includes('rules.md');
              const isDbRule = file.startsWith('Rule: ');
              const isSubdir = file.includes('Subdirectory Hints');

              return (
                <ContextMenu key={idx}>
                  <ContextMenuTrigger asChild>
                    <button 
                      onClick={() => handleOpenFile(file)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-[10px] text-muted-foreground/80 hover:text-foreground hover:bg-muted/40 hover:border-border/60 transition-colors"
                    >
                      <Code size={10} className={cn(
                        "text-indigo-500/70", // Default purple-ish color for markdown rules
                        isAgents && "text-blue-500/70",
                        isRules && "text-emerald-500/70",
                        isDbRule && "text-amber-500/70",
                        isSubdir && "text-orange-500/70"
                      )} />
                      <span>{fname(file)}</span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    {!isDbRule && !isSubdir && !file.startsWith('http://') && !file.startsWith('https://') && (
                      <ContextMenuItem onClick={() => handleRevealInFinder(file)}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        <span>在 Finder 中打开</span>
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem onClick={() => handleCopyPath(file)}>
                      <Copy className="mr-2 h-4 w-4" />
                      <span>复制文件路径</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
