'use client';

import { useState, useEffect } from 'react';
import { SpinnerGap, CheckCircle, XCircle, Clock, Robot, CaretDown, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AGENT_META } from '../ai-elements/tool-actions-group';

/**
 * SubAgentInfo - 子Agent状态信息接口
 */
interface SubAgentInfo {
  id: string;
  name: string;
  displayName: string;
  prompt: string;
  status: 'running' | 'completed' | 'error';
  report?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  progress?: string;
}

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
export function SubAgentTimeline({ subAgents }: { subAgents: SubAgentInfo[] }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [agentProgress, setAgentProgress] = useState<Record<string, string>>({});

  // 监听子Agent进度更新事件
  useEffect(() => {
    const handleProgress = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        setAgentProgress(prev => ({
          ...prev,
          [detail.id]: detail.detail || detail.status || '处理中...',
        }));
      }
    };

    window.addEventListener('subagent-progress', handleProgress);
    return () => window.removeEventListener('subagent-progress', handleProgress);
  }, []);

  // 当有新的子Agent启动时，自动展开；完成时自动折叠
  useEffect(() => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      let changed = false;
      subAgents.forEach(agent => {
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
  }, [subAgents]);

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
        return <CheckCircle size={14} className="text-green-500" weight="fill" />;
      case 'error':
        return <XCircle size={14} className="text-red-500" weight="fill" />;
    }
  };

  const getStatusBadge = (status: SubAgentInfo['status']) => {
    switch (status) {
      case 'running':
        return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-500 border border-blue-500/30">运行中</span>;
      case 'completed':
        return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-500 border border-green-500/30">完成</span>;
      case 'error':
        return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-500 border border-red-500/30">错误</span>;
    }
  };

  // 并行显示：所有agent卡片同时可见，不互相覆盖
  return (
    <div className="mt-3 space-y-2 w-full max-w-full">
      {/* 子Agent状态汇总 - 精致的头部 */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border/30">
        <div className="flex items-center gap-1.5">
          <Robot size={14} className="text-primary" />
          <span className="text-xs font-medium text-foreground">Team Leader ｜ 监控中 ｜ 共派发 {totalCount} 个任务，已完成 {completedCount} 个</span>
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
        {runningCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60">
            等待全部完成...
          </span>
        )}
      </div>

      {/* 子Agent卡片列表 - 网格布局，支持并行显示 */}
      <div className="grid gap-2">
        {subAgents.map((agent) => {
          const isExpanded = expandedAgents.has(agent.id);
          const currentProgress = agent.progress || agentProgress[agent.id];

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
                <span className="font-medium text-xs text-foreground/90 shrink-0">
                  {AGENT_META[agent.name.toLowerCase()]?.label || agent.displayName || agent.name}
                </span>
                
                <span className="text-muted-foreground/40 mx-1 shrink-0">|</span>
                
                <span className="text-xs text-muted-foreground/70 truncate flex-1 max-w-[400px]">
                  {agent.prompt}
                </span>

                {/* 状态标签 */}
                <div className="flex items-center gap-1.5 ml-auto">
                  {getStatusIcon(agent.status)}
                  {getStatusBadge(agent.status)}
                </div>

                {/* 时长 */}
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 ml-2 mr-2 shrink-0">
                  <Clock size={10} />
                  {formatDuration(agent.startedAt, agent.completedAt)}
                </span>
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
                    <div className="flex items-center gap-2 text-[11px] text-blue-500/80">
                      <SpinnerGap size={10} className="animate-spin" />
                      <span>{currentProgress}</span>
                    </div>
                  )}

                  {/* 错误信息 */}
                  {agent.status === 'error' && agent.error && (
                    <div className="text-[11px] text-red-500/80 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <span className="font-medium">错误：</span>
                      {agent.error}
                    </div>
                  )}

                  {/* 完成报告摘要 */}
                  {agent.status === 'completed' && agent.report && (
                    <div className="text-[11px] text-muted-foreground/70 p-2 rounded bg-muted/30 border border-border/20 max-h-32 overflow-y-auto">
                      <span className="font-medium text-muted-foreground/60">报告：</span>
                      <pre className="whitespace-pre-wrap break-words mt-1 font-mono text-[10px]">
                        {agent.report.length > 500 ? `${agent.report.slice(0, 500)}...` : agent.report}
                      </pre>
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
  );
}
