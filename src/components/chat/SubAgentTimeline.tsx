'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SpinnerGap, CheckCircle, XCircle, Clock, Robot, CaretDown, CaretRight, Lightning, Bug, MagnifyingGlass, Gear, TerminalWindow, Brain } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AGENT_META } from '../ai-elements/tool-actions-group';

import { SubAgentInfo } from '@/types';

/**
 * 从进度文本中提取最近的工具调用信息
 * 功能：解析 progress 文本，找到最近的 "执行工具:" 或 "> " 开头的行
 * 用法：在 SubAgentCard 中实时显示当前正在执行的工具
 */
function extractCurrentTool(progress: string): { name: string; detail: string } | null {
  if (!progress) return null;
  const lines = progress.split('\n').filter(l => l.trim());
  // 从后往前找最近的有意义的状态行
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes('分析工具结果') || line.includes('等待模型响应') || line.includes('等待权限确认')) {
      // 提取核心状态文本，去掉 ... 和 (已等待 xxs)
      const cleanName = line.replace(/^\.*|（已等待.*?）|\(已等待.*?\)/g, '').trim();
      return { name: cleanName, detail: '' };
    }
    if (line.startsWith('> ') || line.includes('执行工具:') || line.includes('准备执行工具:')) {
      return { name: line.replace(/^[>🛠️\s]+/, '').trim(), detail: '' };
    }
  }
  return null;
}

/**
 * 从进度文本中提取最近的日志行
 * 功能：解析 progress 文本，返回最近 N 行精简日志
 * 用法：在 SubAgentCard 中显示最近的操作日志，便于排查卡住问题
 */
function extractRecentLogs(progress: string, maxLines = 5): string[] {
  if (!progress) return [];
  const lines = progress.split('\n').filter(l => l.trim());
  // 过滤掉空行和纯分隔符
  const meaningful = lines.filter(l => l.trim() && !l.match(/^[─━\-]{3,}$/));
  return meaningful.slice(-maxLines);
}

/**
 * SubAgentProgress - 子Agent进度显示组件
 * 功能：显示子Agent的实时进度文本，支持自动滚动到底部
 * 用法：在展开的子Agent卡片中渲染
 */
function SubAgentProgress({ progress }: { progress: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [progress]);

  return (
    <div
      ref={scrollRef}
      className="text-[11px] text-muted-foreground/80 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/10 max-h-64 overflow-y-auto flex flex-col gap-1 scroll-smooth"
    >
      <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
        {progress}
      </div>
    </div>
  );
}

/**
 * HeartbeatIndicator - 心跳指示器组件
 * 功能：当 Agent 运行超过 30 秒无新日志时，显示警告提示
 * 用法：在 SubAgentCard 头部实时显示，帮助用户判断 Agent 是否卡住
 */
function HeartbeatIndicator({ lastUpdateAt, status }: { lastUpdateAt?: number; status: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'running' || !lastUpdateAt) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - lastUpdateAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, lastUpdateAt]);

  if (status !== 'running' || !lastUpdateAt) return null;

  if (elapsed > 60) {
    return (
      <span className="flex items-center gap-0.5 text-[9px] text-amber-500 animate-pulse shrink-0">
        <Bug size={9} />
        <span>{elapsed}s</span>
      </span>
    );
  }
  if (elapsed > 30) {
    return (
      <span className="flex items-center gap-0.5 text-[9px] text-amber-400/70 shrink-0">
        <Clock size={9} />
        <span>{elapsed}s</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[9px] text-emerald-500/60 shrink-0">
      <Lightning size={9} weight="fill" />
    </span>
  );
}

export function SubAgentTimeline({ subAgents }: { subAgents: SubAgentInfo[] }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [userInteractedAgents, setUserInteractedAgents] = useState<Set<string>>(new Set());

  // 追踪每个 Agent 最后一次更新时间，用于心跳检测
  const lastUpdateMap = useMemo(() => {
    const map = new Map<string, number>();
    subAgents.forEach(a => {
      if (a.status === 'running' && a.progress) {
        map.set(a.id, Date.now());
      } else if (a.completedAt) {
        map.set(a.id, a.completedAt);
      }
    });
    return map;
  }, [subAgents]);

  // 自动展开/收起逻辑：
  // - 新Agent启动时，自动展开
  // - Agent完成时，如果用户没有手动操作过展开/收起，则自动收起
  // - 只要用户手动点击过展开/收起（进入了 userInteractedAgents），就不再干预它的状态
  useEffect(() => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      let changed = false;
      subAgents.forEach(agent => {
        // 如果用户手动干预过，则不自动处理
        if (userInteractedAgents.has(agent.id)) {
          return;
        }

        if (agent.status === 'running' && !next.has(agent.id)) {
          next.add(agent.id);
          changed = true;
        } else if ((agent.status === 'completed' || agent.status === 'error') && next.has(agent.id)) {
          next.delete(agent.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [subAgents, userInteractedAgents]);

  const toggleExpand = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
    // 记录用户的点击行为
    setUserInteractedAgents(prev => {
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  };

  const completedCount = subAgents.filter(a => a.status === 'completed').length;
  const errorCount = subAgents.filter(a => a.status === 'error').length;
  const runningCount = subAgents.filter(a => a.status === 'running').length;
  const totalCount = subAgents.length;

  if (totalCount === 0) return null;

  const formatDuration = (start: number, end?: number) => {
    const duration = (end || Date.now()) - start;
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStatusIcon = (status: SubAgentInfo['status']) => {
    switch (status) {
      case 'running':
        return <SpinnerGap size={14} className="animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle size={14} weight="fill" className="text-emerald-500" />;
      case 'error':
        return <XCircle size={14} weight="fill" className="text-red-500" />;
    }
  };

  // Add a fallback for names that might contain 'tester', 'qa', 'debugger' but aren't exact matches
  const getAgentLabel = (name: string, displayName?: string) => {
    const lowerName = name.toLowerCase();
    if (AGENT_META[lowerName]) return AGENT_META[lowerName].label;
    
    if (lowerName.includes('test')) return '测试者';
    if (lowerName.includes('qa')) return '质量保证';
    if (lowerName.includes('debug')) return '调试者';
    if (lowerName.includes('plan')) return '规划者';
    if (lowerName.includes('search')) return '搜索者';
    if (lowerName.includes('explor')) return '探索者';
    if (lowerName.includes('exec')) return '执行者';
    
    // 如果是类似 call_function_xxx 的模型幻觉输出，直接显示通用名称
    if (lowerName.startsWith('call_function_')) return '智能体';
    
    return displayName || name;
  };
  const getStatusBadge = (status: SubAgentInfo['status']) => {
    switch (status) {
      case 'running':
        return <span className="flex items-center gap-1 text-[11px] text-blue-500/90 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.15)]"><SpinnerGap size={12} className="animate-spin" /> <span className="font-medium tracking-wide">运行中</span></span>;
      case 'completed':
        return <span className="flex items-center gap-1 text-[11px] text-emerald-500/90 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"><CheckCircle size={12} weight="fill" /> <span className="font-medium tracking-wide">已完成</span></span>;
      case 'error':
        return <span className="flex items-center gap-1 text-[11px] text-red-500/90 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20"><XCircle size={12} weight="fill" /> <span className="font-medium tracking-wide">异常</span></span>;
    }
  };

  return (
    <div className="mt-3 space-y-2 w-full max-w-full">
      {/* 子Agent卡片列表 - 树状布局，支持并行显示 */}
      <div className="relative">
        {/* 树状连接线 */}
        {subAgents.length > 1 && (
          <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-primary/30 via-primary/20 to-primary/10" />
        )}
        <div className="grid gap-2">
        {subAgents.map((agent, idx) => {
          const isExpanded = expandedAgents.has(agent.id);
          const currentProgress = agent.progress;
          const terminalReport = agent.report || (agent.error ? `错误:\n${agent.error}` : '');
          const currentTool = agent.status === 'running' ? extractCurrentTool(agent.progress || '') : null;
          const recentLogs = agent.status === 'running' ? extractRecentLogs(agent.progress || '', 3) : [];

          // 树状连接点颜色
          const dotColor = agent.status === 'running' ? 'bg-blue-500' :
                           agent.status === 'completed' ? 'bg-emerald-500' :
                           'bg-red-500';

          return (
            <div
              key={agent.id}
              className="rounded-lg border bg-card overflow-hidden transition-all duration-200 hover:shadow-sm relative"
            >
              {/* 树状连接点 */}
              {subAgents.length > 1 && (
                <div className="absolute left-2.5 top-[18px] z-10">
                  <div className={cn("w-2 h-2 rounded-full border-2 border-background", dotColor)} />
                  {/* 水平连接线 */}
                  <div className="absolute left-2 top-[3px] w-3 h-px bg-primary/20" />
                </div>
              )}

              {/* 子Agent卡片头部 - 可点击展开/收起 */}
              <div
                className={cn("flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors", subAgents.length > 1 && "pl-8")}
                onClick={() => toggleExpand(agent.id)}
              >
                {/* 展开/收起图标 */}
                <span className="text-muted-foreground/50">
                  {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </span>

                {/* Agent Icon based on AGENT_META */}
                {(() => {
                  const meta = AGENT_META[agent.name.toLowerCase()] || { icon: Robot, color: 'text-muted-foreground', label: agent.displayName || agent.name };
                  const Icon = meta.icon;
                  return <Icon size={14} className={meta.color} />;
                })()}

                {/* Agent名称 */}
                <span className="font-medium text-xs text-foreground/90 shrink-0 flex items-center gap-1" title={agent.displayName || agent.name}>
                  {getAgentLabel(agent.name, agent.displayName)}
                  {agent.model && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono tracking-tighter ml-1">({agent.model})</span>
                  )}
                </span>

                <span className="text-muted-foreground/40 mx-1 shrink-0">|</span>

                {/* 当前工具调用（运行中）或任务摘要 */}
                {currentTool ? (
                  <span className="flex items-center gap-1 text-[11px] text-blue-500/80 truncate flex-1 max-w-[400px]" title={currentTool.name}>
                    <Gear size={10} className="animate-spin shrink-0" />
                    <span className="truncate">{currentTool.name}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground/70 truncate flex-1 max-w-[400px]" title={agent.prompt}>
                    {agent.prompt}
                  </span>
                )}

                {/* 状态标签 */}
                <div className="flex items-center gap-1.5 ml-auto">
                  {/* 心跳指示器 */}
                  <HeartbeatIndicator lastUpdateAt={lastUpdateMap.get(agent.id)} status={agent.status} />
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mr-1 shrink-0 font-mono">
                    <Clock size={10} />
                    {formatDuration(agent.startedAt, agent.completedAt)}
                  </span>
                  {getStatusBadge(agent.status)}
                </div>
              </div>

              {/* 运行中的精简日志预览（如果需要可以在这里控制，根据用户要求折叠时单行卡片，所以移除 !isExpanded 下的预览） */}
              {/* agent.status === 'running' && recentLogs.length > 0 && !isExpanded && ... 被移除 */}

              {/* 展开详情 */}
              <div
                className={cn("grid transition-all duration-300 ease-in-out", isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
              >
                <div className="overflow-hidden">
                  <div className="px-3 py-2 border-t border-border/30 bg-muted/20 space-y-2">
                  {/* 任务提示 */}
                  <div className="text-[11px] text-muted-foreground/80 break-all whitespace-pre-wrap leading-relaxed">
                    <span className="font-medium text-muted-foreground/60 mr-1">任务：</span>
                    {agent.prompt}
                  </div>

                  {/* 当前工具调用高亮（运行中） */}
                  {agent.status === 'running' && currentTool && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-blue-500/8 border border-blue-500/15">
                      <Gear size={11} className="text-blue-500 animate-spin shrink-0" />
                      <span className="text-[11px] text-blue-500/90 font-medium">当前工具：</span>
                      <span className="text-[11px] text-blue-500/70 font-mono truncate">{currentTool.name}</span>
                    </div>
                  )}

                  {/* 运行进度 */}
                  {agent.status === 'running' && currentProgress && (
                    <SubAgentProgress progress={currentProgress} />
                  )}

                  {/* 报告输出 */}
                  {(agent.status === 'completed' || agent.status === 'error') && terminalReport && (
                    <div className="text-[11px] text-muted-foreground/80 p-3 rounded-md bg-muted/30 border border-border/40 max-h-96 overflow-y-auto">
                      <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {terminalReport}
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* 子Agent状态汇总 - 放在最后面跟随光标 */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border/30">
        <div className="flex items-center gap-1.5">
          <Robot size={14} className="text-primary" />
          <span className="text-xs font-medium text-foreground">
            Team Leader ｜ {runningCount > 0 ? <span className="font-mono text-[10px] bg-blue-500/10 text-blue-500/80 px-1.5 py-0.5 rounded border border-blue-500/20">{subAgents[0]?.model || 'Team'}</span> : '监控中'} ｜ 共派发 {totalCount} 个任务，已完成 {completedCount} 个
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[11px]">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-blue-500">
              <SpinnerGap size={10} className="animate-spin" />
              {runningCount} 运行中
            </span>
          )}
          {completedCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle size={10} weight="fill" />
              {completedCount} 完成
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <XCircle size={10} weight="fill" />
              {errorCount} 错误
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
