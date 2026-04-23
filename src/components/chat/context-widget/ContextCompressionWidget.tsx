"use client";

import { useMemo, useState } from "react";
import { Info, Book, CaretRight, CaretDown, Globe } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { useContextUsage } from "@/hooks/useContextUsage";
import { usePanel } from "@/hooks/usePanel";

interface ContextCompressionWidgetProps {
  messages: Message[];
  modelName: string;
  context1m?: boolean;
  hasSummary?: boolean;
  contextWindow?: number;
  upstreamModelId?: string;
  toolFiles?: string[];
  onCompress?: () => void;
}

export function ContextCompressionWidget({
  messages,
  modelName,
  context1m,
  hasSummary,
  contextWindow,
  upstreamModelId,
  toolFiles,
  onCompress,
}: ContextCompressionWidgetProps) {
  const usage = useContextUsage(messages, modelName, {
    context1m,
    hasSummary,
    contextWindow,
    upstreamModelId,
  });

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'web' | 'files' | 'others'>('rules');
  const { setPreviewFile, setPreviewOpen } = usePanel();

  const handleOpenItem = (item: string) => {
    if (item.startsWith('http://') || item.startsWith('https://')) {
      window.open(item, '_blank');
    } else {
      // Pass the cleaned path for preview. The IDE's file resolution needs clean paths,
      // especially for rules where the UI injects custom names like "Rule: xxx (Global)".
      let cleanPath = item;
      
      if (cleanPath.startsWith('Rule: ')) {
        cleanPath = cleanPath.substring(6).trim();
      }
      
      cleanPath = cleanPath.replace(/\s*\([^)]*\)$/, '').trim();
      
      setPreviewFile(cleanPath);
      setPreviewOpen(true);
    }
  };

  const { rules, files, web, othersCount } = useMemo(() => {
    const rulesMap = new Map<string, { path: string, name: string }>();
    const filesMap = new Map<string, { path: string, name: string }>();
    const webSet = new Set<string>();
    let othersCount = 0;

    messages.forEach((msg) => {
      // Collect referenced contexts
      if (msg.role === 'assistant' && msg.referenced_contexts) {
        try {
          const refs = JSON.parse(msg.referenced_contexts) as string[];
          refs.forEach((ref) => {
            if (ref.startsWith('http://') || ref.startsWith('https://')) {
              webSet.add(ref);
            } else {
              // We want to pass the EXACT string ref down to handleOpenItem
              // because it might need custom parsing or resolution from the backend, 
              // but we still clean it up for the visual display name.
              const name = ref.split('/').pop() || ref;
              // Remove suffixes like (Global) or (user) for cleaner display name, but don't strip "Rule: " here
              const cleanName = name.replace(/\s*\([^)]*\)$/, '').trim();
              const nameLower = cleanName.toLowerCase();
              
              if (nameLower.includes('rule') || nameLower.includes('agents.md') || nameLower.includes('claude.md')) {
                rulesMap.set(ref, { path: ref, name: cleanName });
              } else {
                filesMap.set(ref, { path: ref, name: cleanName });
              }
            }
          });
        } catch {}
      }
      
      // Collect attachments from content
      if (msg.role === 'user' && msg.content) {
        const match = msg.content.match(/<!--files:(.*?)-->/);
        if (match && match[1]) {
          try {
            const attached = JSON.parse(match[1]) as { name: string }[];
            attached.forEach((f) => {
               const name = f.name.split('/').pop() || f.name;
               filesMap.set(f.name, { path: f.name, name });
            });
          } catch {}
        }
      }

      // Count messages as others
      if (msg.content) othersCount++;
    });

    // Add tool files from SSE events (AI actual file reads)
    toolFiles?.forEach(f => {
      if (f.startsWith('http://') || f.startsWith('https://')) {
        if (!webSet.has(f)) {
          webSet.add(f);
        }
        if (!filesMap.has(f)) {
          filesMap.set(f, { path: f, name: f });
        }
      } else if (!filesMap.has(f)) {
        const name = f.split('/').pop() || f;
        filesMap.set(f, { path: f, name });
      }
    });

    // 中文注释：功能名称「持久化工具文件读取」，用法是从消息的tool_files字段中读取
    // AI实际访问的文件和网页数据，解决会话切换后上下文统计丢失文件/网页信息的问题
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.tool_files) {
        try {
          const persistedFiles = JSON.parse(msg.tool_files) as string[];
          persistedFiles.forEach(f => {
            if (f.startsWith('http://') || f.startsWith('https://')) {
              if (!webSet.has(f)) {
                webSet.add(f);
              }
              if (!filesMap.has(f)) {
                filesMap.set(f, { path: f, name: f });
              }
            } else if (!filesMap.has(f)) {
              const name = f.split('/').pop() || f;
              filesMap.set(f, { path: f, name });
            }
          });
        } catch {}
      }
    });

    return {
      rules: Array.from(rulesMap.values()),
      files: Array.from(filesMap.values()),
      web: Array.from(webSet).map(url => ({ path: url, name: url })),
      othersCount,
    };
  }, [messages, toolFiles]);

  const totalPercentage = Math.min(100, Math.round(usage.ratio * 100));
  
  // Approximate the token usage split based on the actual total percentage from the backend.
  // We use 5 for rules/files, 10 for web, and 2 for other messages as rough token weight multipliers
  const rulesWeight = rules.length * 5;
  const filesWeight = files.length * 5;
  const webWeight = web.length * 10;
  const othersWeight = othersCount * 2;
  const totalWeight = Math.max(1, rulesWeight + filesWeight + webWeight + othersWeight);
  
  const rulesPct = (rulesWeight / totalWeight) * totalPercentage;
  const filesPct = (filesWeight / totalWeight) * totalPercentage;
  const webPct = (webWeight / totalWeight) * totalPercentage;
  const othersPct = totalPercentage - rulesPct - webPct - filesPct;

  const allContextItems = [...rules, ...files];
  if (othersCount > 0) {
    allContextItems.push({
      path: `对话历史及其他上下文 (${othersCount} 条消息)`,
      name: `对话历史及其他上下文 (${othersCount} 条消息)`,
    });
  }

  if (messages.length === 0 || !usage.hasData || totalPercentage === 0) {
    return (
      <div className="py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div 
            className="flex items-center gap-1 text-[13px] font-medium text-foreground/80 cursor-pointer select-none"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
          >
            {detailsExpanded ? <CaretDown size={14} className="text-muted-foreground/80" /> : <CaretRight size={14} className="text-muted-foreground/80" />}
            上下文
            <Info size={12} className="text-muted-foreground/60 ml-0.5" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2.5 text-[11px] bg-muted/60 hover:bg-muted text-foreground/70 rounded-[4px]"
            onClick={onCompress}
            disabled
          >
            压缩
          </Button>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-1.5 flex rounded-full overflow-hidden bg-muted/40" />
          <span className="text-[12px] font-medium font-mono text-foreground/80 shrink-0 w-8">
            0%
          </span>
        </div>
        <div className="text-[12px] text-muted-foreground/60">暂无上下文内容</div>
      </div>
    );
  }

  return (
    <div className={cn("shrink-0 py-4")}>
      {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div 
            className="flex items-center gap-1 text-[13px] font-medium text-foreground/80 cursor-pointer select-none"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
          >
            {detailsExpanded ? <CaretDown size={14} className="text-muted-foreground/80" /> : <CaretRight size={14} className="text-muted-foreground/80" />}
            上下文
            <Info size={12} className="text-muted-foreground/60 ml-0.5" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2.5 text-[11px] bg-muted/60 hover:bg-muted text-foreground/70 rounded-[4px]"
            onClick={onCompress}
          >
            压缩
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3 mb-3" title={`规则: ${Math.round(rulesPct)}% | 联网: ${Math.round(webPct)}% | 文件: ${Math.round(filesPct)}% | 其他: ${Math.round(othersPct)}%`}>
          <div className="flex-1 h-1.5 flex rounded-full overflow-hidden bg-muted/40">
            <div className="bg-violet-500 transition-all duration-300" style={{ width: `${rulesPct}%` }} />
            <div className="bg-[#00a8ff] transition-all duration-300" style={{ width: `${webPct}%` }} />
            <div className="bg-cyan-300 transition-all duration-300" style={{ width: `${filesPct}%` }} />
            <div className="bg-muted-foreground/30 transition-all duration-300" style={{ width: `${othersPct}%` }} />
          </div>
          <span className="text-[12px] font-medium font-mono text-foreground/80 shrink-0 w-8">
            {totalPercentage}%
          </span>
        </div>

        {/* Legend Tabs */}
        <div className={cn(
          "flex items-center gap-3 text-[11px] text-muted-foreground/80 overflow-x-auto no-scrollbar",
          detailsExpanded ? "mb-2" : "mb-0"
        )}>
          <button
            onClick={() => setActiveTab('rules')}
            className={cn(
              "flex items-center gap-1 border-b pb-0.5 transition-colors whitespace-nowrap",
              activeTab === 'rules' ? "border-foreground/80 text-foreground/90 font-medium" : "border-transparent hover:text-foreground/70"
            )}
            title={`规则: ${Math.round(rulesPct)}%`}
          >
            <div className="w-1.5 h-1.5 bg-violet-500 rounded-[1px]" />
            规则
          </button>
          {web.length > 0 && (
            <button
              onClick={() => setActiveTab('web')}
              className={cn(
                "flex items-center gap-1 border-b pb-0.5 transition-colors whitespace-nowrap",
                activeTab === 'web' ? "border-foreground/80 text-foreground/90 font-medium" : "border-transparent hover:text-foreground/70"
              )}
              title={`联网: ${Math.round(webPct)}%`}
            >
              <div className="w-1.5 h-1.5 bg-[#00a8ff] rounded-[1px]" />
              联网搜索
            </button>
          )}
          <button
            onClick={() => setActiveTab('files')}
            className={cn(
              "flex items-center gap-1 border-b pb-0.5 transition-colors whitespace-nowrap",
              activeTab === 'files' ? "border-foreground/80 text-foreground/90 font-medium" : "border-transparent hover:text-foreground/70"
            )}
            title={`文件: ${Math.round(filesPct)}%`}
          >
            <div className="w-1.5 h-1.5 bg-cyan-300 rounded-[1px]" />
            文件
          </button>
          <button
            onClick={() => setActiveTab('others')}
            className={cn(
              "flex items-center gap-1 border-b pb-0.5 transition-colors whitespace-nowrap",
              activeTab === 'others' ? "border-foreground/80 text-foreground/90 font-medium" : "border-transparent hover:text-foreground/70"
            )}
            title={`其他: ${Math.round(othersPct)}%`}
          >
            <div className="w-1.5 h-1.5 bg-muted-foreground/30 rounded-[1px]" />
            其他
          </button>
        </div>

        {/* List Content */}
        {detailsExpanded && (
          activeTab === 'others' ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <p className="text-[12px] font-medium text-foreground/80 mb-1">其他上下文</p>
              <p className="text-[11px] text-muted-foreground/60">用于系统级指令和后台处理的上下文</p>
            </div>
          ) : (
            <div className="space-y-2.5 mt-2">
              {(activeTab === 'rules' ? rules : activeTab === 'web' ? web : files).slice(0, listExpanded ? undefined : 6).map((item, i) => (
                <div 
                  key={i} 
                  className="flex items-center gap-2 text-[12px] text-foreground/80 truncate cursor-pointer hover:text-foreground transition-colors group"
                  onClick={() => handleOpenItem(item.path)}
                >
                  {activeTab === 'web' ? (
                    <Globe size={14} className="text-foreground/80 shrink-0 group-hover:text-foreground" />
                  ) : activeTab === 'rules' ? (
                    <Book size={14} className="text-violet-400 shrink-0" />
                  ) : (
                    <Book size={14} className="text-[#00a8ff] shrink-0" />
                  )}
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
              
              {/* Show more/less toggle */}
              {(activeTab === 'rules' ? rules : activeTab === 'web' ? web : files).length > 6 && (
                <button
                  onClick={() => setListExpanded(!listExpanded)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/80 transition-colors pt-1"
                >
                  {listExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
                  {listExpanded ? "收起" : `展开全部 ${(activeTab === 'rules' ? rules : activeTab === 'web' ? web : files).length} 项...`}
                </button>
              )}
              
              {(activeTab === 'rules' ? rules : activeTab === 'web' ? web : files).length === 0 && (
                <div className="text-[11px] text-muted-foreground/50 py-2">暂无该类内容</div>
              )}
            </div>
          )
        )}
    </div>
  );
}
