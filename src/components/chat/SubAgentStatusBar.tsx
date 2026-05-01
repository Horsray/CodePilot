'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  SpinnerGap, CheckCircle, XCircle, CaretDown, CaretRight,
  Robot, MagnifyingGlass, PencilSimple, ShieldCheck, Brain,
  Wrench, Eyeglasses, ListChecks, Lightning, Eye, NotePencil,
  Code, TerminalWindow,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { SubAgentInfo } from '@/types';
import { AGENT_META } from '../ai-elements/tool-actions-group';

/**
 * 子Agent内联状态条
 * 功能：一行紧凑显示所有子Agent的执行状态，替代原来的独立卡片式SubAgentTimeline
 * 用法：在 StreamingMessage 和 MessageItem 中渲染，提供统一的多Agent并行状态视图
 */

function getAgentLabel(name: string, displayName?: string): string {
  const lowerName = name.toLowerCase();
  if (AGENT_META[lowerName]) return AGENT_META[lowerName].label;
  if (lowerName.includes('test')) return '测试';
  if (lowerName.includes('qa')) return '质量检测';
  if (lowerName.includes('debug')) return '调试';
  if (lowerName.includes('plan')) return '规划';
  if (lowerName.includes('search')) return '搜索';
  if (lowerName.includes('explor')) return '探索';
  if (lowerName.includes('exec')) return '执行';
  if (lowerName.includes('review')) return '审查';
  if (lowerName.includes('analys')) return '分析';
  if (lowerName.includes('design')) return '设计';
  if (lowerName.includes('writ')) return '撰写';
  if (lowerName.includes('monitor')) return '监控';
  if (lowerName.includes('optim')) return '优化';
  if (lowerName.includes('deploy')) return '部署';
  if (lowerName.includes('integrat')) return '集成';
  if (lowerName.includes('research')) return '调研';
  if (lowerName.includes('coordinat')) return '协调';
  if (lowerName.includes('refactor')) return '重构';
  if (lowerName.startsWith('call_function_')) return '智能体';
  return displayName || name;
}

function getAgentIcon(name: string): React.ElementType {
  const lowerName = name.toLowerCase();
  if (AGENT_META[lowerName]) return AGENT_META[lowerName].icon;
  if (lowerName.includes('test') || lowerName.includes('qa')) return ShieldCheck;
  if (lowerName.includes('debug')) return Wrench;
  if (lowerName.includes('plan')) return ListChecks;
  if (lowerName.includes('search') || lowerName.includes('explor')) return MagnifyingGlass;
  if (lowerName.includes('exec')) return PencilSimple;
  if (lowerName.includes('review')) return Eyeglasses;
  if (lowerName.includes('analys')) return Brain;
  if (lowerName.includes('design') || lowerName.includes('writ')) return NotePencil;
  if (lowerName.includes('monitor')) return Eye;
  if (lowerName.includes('optim')) return Lightning;
  if (lowerName.includes('deploy') || lowerName.includes('integrat')) return TerminalWindow;
  if (lowerName.includes('research')) return MagnifyingGlass;
  if (lowerName.includes('coordinat')) return Robot;
  if (lowerName.includes('refactor')) return Code;
  return Robot;
}

function getAgentColor(name: string): string {
  const lowerName = name.toLowerCase();
  if (AGENT_META[lowerName]) return AGENT_META[lowerName].color;
  return 'text-muted-foreground/70';
}

function formatDuration(start: number, end?: number): string {
  const duration = (end || Date.now()) - start;
  const seconds = Math.floor(duration / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

function extractCurrentTool(progress: string): string | null {
  if (!progress) return null;
  const lines = progress.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes('分析工具结果') || line.includes('等待模型响应')) {
      return line.replace(/^\.*|（已等待.*?）|\(已等待.*?\)/g, '').trim();
    }
    if (line.startsWith('> ') || line.includes('执行工具:') || line.includes('准备执行工具:')) {
      return line.replace(/^[>🛠️\s]+/, '').trim();
    }
  }
  return null;
}

interface SubAgentStatusBarProps {
  subAgents: SubAgentInfo[];
  /** 默认是否展开详情 */
  defaultExpanded?: boolean;
}

export function SubAgentStatusBar({ subAgents, defaultExpanded = false }: SubAgentStatusBarProps) {
  const [detailExpanded, setDetailExpanded] = useState(defaultExpanded);

  const completedCount = subAgents.filter(a => a.status === 'completed').length;
  const errorCount = subAgents.filter(a => a.status === 'error').length;
  const runningCount = subAgents.filter(a => a.status === 'running').length;
  const totalCount = subAgents.length;

  // 运行中自动展开详情，全部完成后自动折叠
  useEffect(() => {
    if (runningCount > 0) {
      setDetailExpanded(true);
    } else if (runningCount === 0 && totalCount > 0) {
      setDetailExpanded(false);
    }
  }, [runningCount, totalCount]);

  const summaryText = useMemo(() => {
    if (totalCount === 0) return '';
    if (runningCount > 0 && completedCount === 0) return `已派发 ${totalCount} 个任务，${runningCount} 个运行中`;
    if (runningCount > 0) return `已完成 ${completedCount} 个，等待其余 ${runningCount} 个`;
    if (errorCount > 0 && completedCount + errorCount === totalCount) return `${completedCount} 个完成，${errorCount} 个异常`;
    if (completedCount === totalCount) return `全部 ${totalCount} 个任务已完成`;
    return `${completedCount}/${totalCount} 已完成`;
  }, [completedCount, errorCount, runningCount, totalCount]);

  if (totalCount === 0) return null;

  return (
    <div className="mt-2 w-full max-w-full">
      {/* 内联状态条 */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/40">
        {subAgents.map(agent => {
          const Icon = getAgentIcon(agent.name);
          const color = getAgentColor(agent.name);
          const label = getAgentLabel(agent.name, agent.displayName);
          const duration = agent.startedAt ? formatDuration(agent.startedAt, agent.completedAt) : null;
          const currentTool = agent.status === 'running' ? extractCurrentTool(agent.progress || '') : null;

          return (
            <div
              key={agent.id}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors",
                agent.status === 'running' && "bg-blue-500/8",
                agent.status === 'completed' && "bg-emerald-500/8",
                agent.status === 'error' && "bg-red-500/8",
              )}
              title={agent.prompt || label}
            >
              <Icon size={11} className={cn(color, "shrink-0")} />
              <span className="font-medium text-foreground/80">{label}</span>
              {agent.status === 'running' && (
                <SpinnerGap size={10} className="animate-spin text-blue-500 shrink-0" />
              )}
              {agent.status === 'completed' && (
                <CheckCircle size={10} weight="fill" className="text-emerald-500 shrink-0" />
              )}
              {agent.status === 'error' && (
                <XCircle size={10} weight="fill" className="text-red-500 shrink-0" />
              )}
              {duration && (
                <span className="text-muted-foreground/50 tabular-nums">{duration}</span>
              )}
              {currentTool && (
                <span className="text-blue-500/60 truncate max-w-[80px]" title={currentTool}>
                  {currentTool}
                </span>
              )}
            </div>
          );
        })}

        {/* 分隔 */}
        <span className="text-muted-foreground/30 mx-0.5">|</span>

        {/* 汇总 */}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
          {runningCount > 0 && <SpinnerGap size={10} className="animate-spin text-blue-400" />}
          {runningCount === 0 && completedCount === totalCount && <CheckCircle size={10} weight="fill" className="text-emerald-400" />}
          {runningCount === 0 && errorCount > 0 && <XCircle size={10} weight="fill" className="text-amber-400" />}
          <span>{summaryText}</span>
        </div>

        {/* 展开/收起详情按钮 */}
        <button
          onClick={() => setDetailExpanded(prev => !prev)}
          className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors shrink-0"
        >
          {detailExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
          <span>详情</span>
        </button>
      </div>

      {/* 展开的详情区域 */}
      {detailExpanded && (
        <div className="mt-1 space-y-0.5 px-1">
          {subAgents.map(agent => {
            const label = getAgentLabel(agent.name, agent.displayName);
            const Icon = getAgentIcon(agent.name);
            const color = getAgentColor(agent.name);
            const duration = agent.startedAt ? formatDuration(agent.startedAt, agent.completedAt) : null;

            return (
              <div
                key={agent.id}
                className={cn(
                  "flex items-start gap-2 px-2 py-1.5 rounded text-[11px]",
                  agent.status === 'running' && "bg-blue-500/5",
                  agent.status === 'completed' && "bg-emerald-500/5",
                  agent.status === 'error' && "bg-red-500/5",
                )}
              >
                <Icon size={11} className={cn(color, "shrink-0 mt-0.5")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground/80">{label}</span>
                    {duration && <span className="text-muted-foreground/40 tabular-nums">{duration}</span>}
                    {agent.status === 'running' && (
                      <SpinnerGap size={9} className="animate-spin text-blue-500" />
                    )}
                    {agent.status === 'completed' && (
                      <CheckCircle size={9} weight="fill" className="text-emerald-500" />
                    )}
                    {agent.status === 'error' && (
                      <XCircle size={9} weight="fill" className="text-red-500" />
                    )}
                  </div>
                  {agent.prompt && (
                    <div className="text-muted-foreground/50 truncate mt-0.5" title={agent.prompt}>
                      {agent.prompt}
                    </div>
                  )}
                  {agent.report && (
                    <div className="text-muted-foreground/60 mt-0.5 whitespace-pre-wrap break-words line-clamp-3">
                      {agent.report}
                    </div>
                  )}
                  {agent.error && (
                    <div className="text-red-400/70 mt-0.5 truncate" title={agent.error}>
                      {agent.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
