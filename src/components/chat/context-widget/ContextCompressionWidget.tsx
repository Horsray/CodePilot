"use client";

import { useMemo, useState } from "react";
import { Info, Book, CaretRight, CaretDown, Globe, FolderOpen, Copy, ArrowSquareOut } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { useContextUsage } from "@/hooks/useContextUsage";
import { usePanel } from "@/hooks/usePanel";
import { showToast } from "@/hooks/useToast";
import { copyTextToClipboard } from "@/lib/console-utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";

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

  // 中文注释：上下文统计详情默认展开，用户可手动收起
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [listExpanded, setListExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'web' | 'files' | 'others'>('rules');
  const { setPreviewFile, setPreviewOpen, openBrowserTab } = usePanel();

  const handleOpenItem = (item: string) => {
    if (item.startsWith('http://') || item.startsWith('https://')) {
      // 中文注释：功能名称「内置浏览器打开URL」，用法是左键点击联网搜索的URL时
      // 使用内置浏览器标签页打开，而非系统默认浏览器
      openBrowserTab(item, item);
      return;
    }

    // Pass the cleaned path for preview. The IDE's file resolution needs clean paths.
    // For rules, the backend will recognize the 'Rule: ' prefix and serve it from DB.
    let cleanPath = item;
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

  const handleCopyPath = async (path: string) => {
    const text = path.startsWith('Rule: ')
      ? path.substring(6).replace(/\s*\([^)]*\)$/, '').trim()
      : path.replace(/\s*\([^)]*\)$/, '').trim();
    const ok = await copyTextToClipboard(text);
    showToast({ message: ok ? "已复制文件路径" : "复制失败", type: ok ? "success" : "error" });
  };

  const { rules, files, web, othersCount, sessionTokens } = useMemo(() => {
    const rulesMap = new Map<string, { path: string, name: string }>();
    const filesMap = new Map<string, { path: string, name: string }>();
    const webSet = new Set<string>();
    let othersCount = 0;
    
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalCost = 0;

    messages.forEach((msg) => {
      // Aggregate token usage
      if (msg.token_usage) {
        try {
          const usage = JSON.parse(msg.token_usage);
          if (usage) {
            totalInput += (usage.input_tokens || 0);
            totalOutput += (usage.output_tokens || 0);
            totalCache += (usage.cache_read_input_tokens || 0);
            totalCost += (usage.cost_usd || 0);
          }
        } catch {}
      }

      // Collect referenced contexts
      if (msg.role === 'assistant' && msg.referenced_contexts) {
        try {
          const refs = JSON.parse(msg.referenced_contexts) as string[];
          refs.forEach((ref) => {
            if (ref.startsWith('http://') || ref.startsWith('https://')) {
              webSet.add(ref);
            } else {
              // 中文注释：功能名称「上下文文件分类」，用法是referenced_contexts中的文件
              // 都是系统提示词引用的文件，统一归入rules分类，而非files分类
              const name = ref.split('/').pop() || ref;
              const cleanName = name.replace(/\s*\([^)]*\)$/, '').trim();
              rulesMap.set(ref, { path: ref, name: cleanName });
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

      // 中文注释：功能名称「工具调用文件提取」，用法是从assistant消息的content中解析tool_use块，
      // 提取AI实际读取/写入的文件路径和访问的URL，使上下文统计能如实显示文件和网页信息
      if (msg.role === 'assistant' && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed)) {
            for (const block of parsed) {
              if (block.type === 'tool_use' && block.input) {
                const inp = block.input as Record<string, unknown>;
                const name = block.name as string;
                // Read tools
                if (/^Read$|^ReadFile$|^read_file$|^read$|^ReadMultipleFiles$|^read_text_file$|^str_replace_editor$|^View$|^Open$|^NotebookRead$/i.test(name)) {
                  if (inp.file_path && typeof inp.file_path === 'string') filesMap.set(inp.file_path, { path: inp.file_path, name: inp.file_path.split('/').pop() || inp.file_path });
                  if (inp.path && typeof inp.path === 'string') filesMap.set(inp.path, { path: inp.path, name: inp.path.split('/').pop() || inp.path });
                  if (inp.files && Array.isArray(inp.files)) {
                    (inp.files as string[]).forEach((f: string) => {
                      if (typeof f === 'string') filesMap.set(f, { path: f, name: f.split('/').pop() || f });
                    });
                  }
                }
                // Write/Edit tools
                else if (/^Write$|^WriteFile$|^write_file$|^create_file$|^Edit$|^Patch$|^replace_in_file$|^EditFile$|^WriteEdit$/i.test(name)) {
                  if (inp.file_path && typeof inp.file_path === 'string') filesMap.set(inp.file_path, { path: inp.file_path, name: inp.file_path.split('/').pop() || inp.file_path });
                  if (inp.path && typeof inp.path === 'string') filesMap.set(inp.path, { path: inp.path, name: inp.path.split('/').pop() || inp.path });
                }
                // Web tools
                else if (/^WebSearch$|^web_search$|^Browse$|^Fetch$|^WebFetch$|^getUrl$|^get_url$|^mcp__fetch__/i.test(name)) {
                  if (inp.url && typeof inp.url === 'string') webSet.add(inp.url);
                  if (inp.query && typeof inp.query === 'string') {
                    const urlPattern = /https?:\/\/[^\s"')>\]]+/g;
                    let match;
                    while ((match = urlPattern.exec(inp.query as string)) !== null) {
                      webSet.add(match[0]);
                    }
                  }
                }
              }
              // 中文注释：功能名称「Web工具结果URL提取」，用法是只在Web搜索/抓取工具的result中提取URL
              if (block.type === 'tool_result' && block.content && typeof block.content === 'string') {
                // Only extract URLs from web-related tool results to avoid false positives
                const toolUseId = block.tool_use_id as string | undefined;
                const isWebResult = parsed.some((b: any) =>
                  b.type === 'tool_use' && b.id === toolUseId &&
                  /^WebSearch$|^web_search$|^Browse$|^Fetch$|^WebFetch$|^getUrl$|^get_url$|^mcp__fetch__/i.test(b.name)
                );
                if (isWebResult) {
                  const urlPattern = /https?:\/\/[^\s"')>\]]+/g;
                  let match;
                  while ((match = urlPattern.exec(block.content as string)) !== null) {
                    webSet.add(match[0]);
                  }
                }
              }
            }
          }
        } catch {}
      }

      // Count messages as others
      if (msg.content) othersCount++;
    });

    // Add tool files from SSE events (AI actual file reads)
    toolFiles?.forEach(f => {
      // 中文注释：功能名称「工具文件分类」，用法是URL只归入web分类，本地路径只归入files分类
      if (f.startsWith('http://') || f.startsWith('https://')) {
        webSet.add(f);
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
            // 中文注释：功能名称「持久化文件分类」，用法是URL只归入web分类，本地路径只归入files分类
            if (f.startsWith('http://') || f.startsWith('https://')) {
              webSet.add(f);
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
      sessionTokens: {
        total: totalInput + totalOutput + totalCache,
        input: totalInput,
        output: totalOutput,
        cache: totalCache,
        cost: totalCost
      }
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
        <div className="flex items-center gap-3 mb-3" title={`规则: ${Math.round(rulesPct)}% | 联网: ${Math.round(webPct)}% | 文件: ${Math.round(filesPct)}% | 数据统计: ${Math.round(othersPct)}%`}>
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
            title={`统计数据`}
          >
            <div className="w-1.5 h-1.5 bg-muted-foreground/30 rounded-[1px]" />
            数据统计
          </button>
        </div>

        {/* List Content */}
        {detailsExpanded && (
          activeTab === 'others' ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <p className="text-[12px] font-medium text-foreground/80 mb-1">会话数据统计</p>
              <div className="text-[11px] text-muted-foreground/60 space-y-1 mt-2">
                <p>token消耗：<span className="font-mono text-foreground/80">{sessionTokens.total.toLocaleString()}</span></p>
                <p>输入：<span className="font-mono text-foreground/80">{sessionTokens.input.toLocaleString()}</span> &nbsp;&nbsp; 输出：<span className="font-mono text-foreground/80">{sessionTokens.output.toLocaleString()}</span> &nbsp;&nbsp; cache：<span className="font-mono text-foreground/80">{sessionTokens.cache.toLocaleString()}</span></p>
                {sessionTokens.cost > 0 && <p className="mt-1">预估成本：<span className="font-mono text-foreground/80">${sessionTokens.cost.toFixed(4)}</span></p>}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 mt-2">
              {(activeTab === 'rules' ? rules : activeTab === 'web' ? web : files).slice(0, listExpanded ? undefined : 6).map((item, i) => {
                const isDbRule = item.path.startsWith('Rule: ');
                const isSubdir = item.path.includes('Subdirectory Hints');
                const isWeb = activeTab === 'web';
                
                return (
                  <ContextMenu key={i}>
                    <ContextMenuTrigger asChild>
                      <div 
                        className="flex items-center gap-2 text-[12px] text-foreground/80 truncate cursor-pointer hover:text-foreground transition-colors group"
                        onClick={() => handleOpenItem(item.path)}
                      >
                        {isWeb ? (
                          <Globe size={14} className="text-foreground/80 shrink-0 group-hover:text-foreground" />
                        ) : activeTab === 'rules' ? (
                          <Book size={14} className={isDbRule ? "text-amber-500/70 shrink-0" : isSubdir ? "text-orange-500/70 shrink-0" : "text-violet-400 shrink-0"} />
                        ) : (
                          <Book size={14} className="text-[#00a8ff] shrink-0" />
                        )}
                        <span className="truncate">{item.name}</span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      {isWeb && (
                        <>
                          <ContextMenuItem onClick={() => window.open(item.path, '_blank')}>
                            <ArrowSquareOut className="mr-2 h-4 w-4" />
                            <span>使用系统浏览器打开</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { copyTextToClipboard(item.path).then(ok => showToast({ message: ok ? "已复制 URL" : "复制失败", type: ok ? "info" : "error" })); }}>
                            <Copy className="mr-2 h-4 w-4" />
                            <span>复制 URL</span>
                          </ContextMenuItem>
                        </>
                      )}
                      {!isDbRule && !isSubdir && !isWeb && (
                        <ContextMenuItem onClick={() => handleRevealInFinder(item.path)}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          <span>在 Finder 中打开</span>
                        </ContextMenuItem>
                      )}
                      {!isWeb && (
                        <ContextMenuItem onClick={() => handleCopyPath(item.path)}>
                          <Copy className="mr-2 h-4 w-4" />
                          <span>复制文件路径</span>
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              
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
