'use client';

import { useState, useEffect, useRef } from 'react';
import { SpinnerGap, CheckCircle, XCircle, Clock, Robot, CaretDown, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AGENT_META } from '../ai-elements/tool-actions-group';

import { SubAgentInfo } from '@/types';

/**
 * SubAgentTimeline - 子Agent嵌套时间线组件
 *
 * 功能：
 * - 显示子Agent的独立卡片，位于主时间线内侧
 * - 显示智能体名称、状态（运行中/完成/错误）
 * - 运行时显示进度信息，完成后显示报告摘要
 * - 支持并行显示多个agent（不互相覆盖）
 * - 字体比主时间线小
 * - 主Agent下方显示子Agent完成统计
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

export function SubAgentTimeline({ subAgents }: { subAgents: SubAgentInfo[] }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [userInteractedAgents, setUserInteractedAgents] = useState<Set<string>>(new Set());

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
      {/* 子Agent卡片列表 - 网格布局，支持并行显示 */}
      <div className="grid gap-2">
        {subAgents.map((agent) => {
          const isExpanded = expandedAgents.has(agent.id);
          const currentProgress = agent.progress;

          return (
            <div
              key={agent.id}
              className="rounded-lg border bg-card overflow-hidden transition-all duration-200 hover:shadow-sm"
            >
              {/* 子Agent卡片头部 - 可点击展开/收起 */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
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
                <span className="font-medium text-xs text-foreground/90 shrink-0 flex items-center gap-1">
                  {getAgentLabel(agent.name, agent.displayName)}
                  {agent.model && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono tracking-tighter ml-1">({agent.model})</span>
                  )}
                </span>
                
                <span className="text-muted-foreground/40 mx-1 shrink-0">|</span>
                
                <span className="text-xs text-muted-foreground/70 truncate flex-1 max-w-[400px]">
                  {agent.prompt}
                </span>

                {/* 状态标签 */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mr-2 shrink-0 font-mono">
                    <Clock size={10} />
                    {formatDuration(agent.startedAt, agent.completedAt)}
                  </span>
                  {getStatusBadge(agent.status)}
                </div>
              </div>

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

                  {/* 运行进度 */}
                  {agent.status === 'running' && currentProgress && (
                    <SubAgentProgress progress={currentProgress} />
                  )}

                  {/* 报告输出 */}
                  {(agent.status === 'completed' || agent.status === 'error') && agent.report && (
                    <div className="text-[11px] text-muted-foreground/80 p-3 rounded-md bg-muted/30 border border-border/40 max-h-96 overflow-y-auto">
                      <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {agent.report}
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
