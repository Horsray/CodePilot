'use client';

import { useState, useEffect, useCallback } from 'react';
import { SpinnerGap, CheckCircle, XCircle, Robot, CircleDashed, Rocket } from '@phosphor-icons/react';

/**
 * TeamLeaderWidget - Team Leader监控面板组件
 *
 * 功能：
 * - 监听 team_start / team_agent_update / team_done 事件
 * - 显示团队目标、agent列表、实时状态
 * - 渲染精致的卡片样式，带动画效果
 * - 支持并行显示多个agent的执行状态
 */

interface TeamGoal {
  id: string;
  goal: string;
  startedAt: number;
}

interface AgentUpdate {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  model?: string;
  progress?: string;
  report?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

interface TeamLeaderWidgetProps {
  sessionId?: string;
}

export function TeamLeaderWidget({ sessionId }: TeamLeaderWidgetProps) {
  const [teamGoal, setTeamGoal] = useState<TeamGoal | null>(null);
  const [agents, setAgents] = useState<AgentUpdate[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  // 监听team相关事件
  useEffect(() => {
    const handleTeamStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.goal) {
        setTeamGoal({
          id: `team-${Date.now()}`,
          goal: detail.goal,
          startedAt: Date.now(),
        });
        setIsComplete(false);
        // 解析pipeline agents
        if (detail.agents) {
          setAgents(detail.agents.map((name: string) => ({
            agent: name,
            status: 'pending' as const,
          })));
        }
      }
    };

    const handleTeamAgentStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agent) {
        setAgents(prev => {
          const existing = prev.find(a => a.agent === detail.agent);
          if (existing) {
            return prev.map(a =>
              a.agent === detail.agent
                ? { ...a, status: 'running' as const, model: detail.model, startedAt: Date.now() }
                : a
            );
          }
          return [...prev, {
            agent: detail.agent,
            status: 'running' as const,
            model: detail.model,
            startedAt: Date.now(),
          }];
        });
      }
    };

    const handleTeamAgentUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agent) {
        setAgents(prev => prev.map(a =>
          a.agent === detail.agent
            ? { ...a, progress: detail.progress, status: detail.status || a.status }
            : a
        ));
      }
    };

    const handleTeamAgentDone = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agent) {
        setAgents(prev => prev.map(a =>
          a.agent === detail.agent
            ? {
                ...a,
                status: detail.error ? 'error' as const : 'completed' as const,
                report: detail.report,
                error: detail.error,
                completedAt: Date.now(),
              }
            : a
        ));
      }
    };

    const handleTeamDone = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsComplete(true);
      // 更新最终统计
      if (detail?.summary) {
        setAgents(prev => prev.map(a => ({
          ...a,
          report: a.report || detail.summary,
        })));
      }
    };

    window.addEventListener('team_start', handleTeamStart);
    window.addEventListener('team_agent_start', handleTeamAgentStart);
    window.addEventListener('team_agent_update', handleTeamAgentUpdate);
    window.addEventListener('team_agent_done', handleTeamAgentDone);
    window.addEventListener('team_done', handleTeamDone);

    return () => {
      window.removeEventListener('team_start', handleTeamStart);
      window.removeEventListener('team_agent_start', handleTeamAgentStart);
      window.removeEventListener('team_agent_update', handleTeamAgentUpdate);
      window.removeEventListener('team_agent_done', handleTeamAgentDone);
      window.removeEventListener('team_done', handleTeamDone);
    };
  }, []);

  const getAgentIcon = useCallback((status: AgentUpdate['status']) => {
    switch (status) {
      case 'running':
        return <SpinnerGap size={14} className="animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle size={14} className="text-green-500" weight="fill" />;
      case 'error':
        return <XCircle size={14} className="text-red-500" weight="fill" />;
      default:
        return <CircleDashed size={14} className="text-muted-foreground/50" />;
    }
  }, []);

  const getStatusBadge = useCallback((status: AgentUpdate['status']) => {
    switch (status) {
      case 'running':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-500 border border-blue-500/30">
            运行中
          </span>
        );
      case 'completed':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-500 border border-green-500/30">
            完成
          </span>
        );
      case 'error':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-500 border border-red-500/30">
            错误
          </span>
        );
      default:
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-muted-foreground/20">
            等待中
          </span>
        );
    }
  }, []);

  const completedCount = agents.filter(a => a.status === 'completed').length;
  const runningCount = agents.filter(a => a.status === 'running').length;
  const errorCount = agents.filter(a => a.status === 'error').length;

  // 如果没有team数据，不渲染任何内容
  if (!teamGoal && agents.length === 0) {
    return null;
  }

  return (
    <div className="my-3 rounded-xl border border-border/50 bg-gradient-to-br from-background to-muted/20 shadow-sm overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
          {isComplete ? (
            <Rocket size={18} weight="fill" className="text-green-500" />
          ) : (
            <Robot size={18} weight="fill" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground">
              Team Leader
            </span>
            <span className="text-muted-foreground/50 text-xs">|</span>
            <span className="text-xs text-muted-foreground">监控中</span>
          </div>
          {teamGoal && (
            <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
              目标：{teamGoal.goal}
            </p>
          )}
        </div>
        {/* 状态指示器 */}
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-blue-500">
              <SpinnerGap size={12} className="animate-spin" />
              {runningCount}
            </span>
          )}
          {completedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <CheckCircle size={12} weight="fill" />
              {completedCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <XCircle size={12} weight="fill" />
              {errorCount}
            </span>
          )}
        </div>
      </div>

      {/* Agent列表 */}
      <div className="p-3 space-y-2">
        {agents.map((agent, idx) => (
          <div
            key={agent.agent}
            className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/30 hover:border-border/50 transition-colors"
          >
            {/* 序号和状态图标 */}
            <div className="flex items-center gap-2 min-w-[80px]">
              {getAgentIcon(agent.status)}
              <span className="text-xs font-medium text-muted-foreground/70">
                {agent.agent}
              </span>
            </div>

            {/* 进度/报告 */}
            <div className="flex-1 min-w-0">
              {agent.status === 'running' && agent.progress && (
                <p className="text-xs text-blue-500/80 truncate">{agent.progress}</p>
              )}
              {agent.status === 'completed' && agent.report && (
                <p className="text-xs text-muted-foreground/70 line-clamp-2">
                  {agent.report.slice(0, 200)}
                  {agent.report.length > 200 ? '...' : ''}
                </p>
              )}
              {agent.status === 'error' && agent.error && (
                <p className="text-xs text-red-500/80 line-clamp-2">{agent.error}</p>
              )}
              {agent.status === 'pending' && (
                <p className="text-xs text-muted-foreground/50 italic">等待执行...</p>
              )}
            </div>

            {/* 状态标签 */}
            <div className="shrink-0">
              {getStatusBadge(agent.status)}
            </div>
          </div>
        ))}
      </div>

      {/* 底部进度条 */}
      {agents.length > 0 && !isComplete && (
        <div className="h-1 bg-muted/50">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
            style={{
              width: `${((completedCount + errorCount) / agents.length) * 100}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default TeamLeaderWidget;
