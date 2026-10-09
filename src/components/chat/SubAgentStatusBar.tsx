'use client';

import { useState, useMemo } from 'react';
import {
  SpinnerGap, CheckCircle, XCircle, CaretDown, CaretRight,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { SubAgentInfo } from '@/types';

/**
 * 子Agent内联状态条（简化版）
 * 功能：一行紧凑显示「已派发 X 个 Agent · 已返回 N 个结论 · M 个进行中」，
 * 不再展示单个 Agent 的实时工具/日志等细节；全部完成后统一回复由消息正文承载。
 * 用法：在 StreamingMessage 和 MessageItem 中渲染。
 */

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

  const summaryText = useMemo(() => {
    if (totalCount === 0) return '';
    if (runningCount > 0) {
      return `已派发 ${totalCount} 个 Agent · 已返回 ${completedCount} 个结论 · ${runningCount} 个进行中`;
    }
    if (errorCount > 0) return `${completedCount} 个完成 · ${errorCount} 个异常`;
    return `已派发 ${totalCount} 个 Agent，全部完成`;
  }, [completedCount, errorCount, runningCount, totalCount]);

  if (totalCount === 0) return null;

  return (
    <div className="mt-2 w-full max-w-full">
      {/* 内联状态条：只保留一行汇总 + 可选详情 */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/40">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          {runningCount > 0 && <SpinnerGap size={11} className="animate-spin text-blue-400" />}
          {runningCount === 0 && completedCount + errorCount === totalCount && errorCount === 0 && (
            <CheckCircle size={11} weight="fill" className="text-emerald-400" />
          )}
          {runningCount === 0 && errorCount > 0 && (
            <XCircle size={11} weight="fill" className="text-amber-400" />
          )}
          <span>{summaryText}</span>
        </div>

        {/* 展开/收起详情按钮（默认收起，报告在详情里查看） */}
        <button
          onClick={() => setDetailExpanded(prev => !prev)}
          className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors shrink-0"
        >
          {detailExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
          <span>详情</span>
        </button>
      </div>

      {/* 展开的详情区域：仅展示各 Agent 的最终报告/错误，不展示过程细节 */}
      {detailExpanded && (
        <div className="mt-1 space-y-0.5 px-1">
          {subAgents.map(agent => {
            const isDone = agent.status === 'completed' || agent.status === 'error';
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
                {agent.status === 'running' && <SpinnerGap size={11} className="animate-spin text-blue-400 shrink-0 mt-0.5" />}
                {agent.status === 'completed' && <CheckCircle size={11} weight="fill" className="text-emerald-400 shrink-0 mt-0.5" />}
                {agent.status === 'error' && <XCircle size={11} weight="fill" className="text-red-400 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground/80">{agent.displayName || agent.name}</span>
                    <span className="text-muted-foreground/50 truncate flex-1" title={agent.prompt}>{agent.prompt}</span>
                  </div>
                  {isDone && agent.report && (
                    <div className="text-muted-foreground/60 mt-0.5 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                      {agent.report}
                    </div>
                  )}
                  {agent.error && (
                    <div className="text-red-400/70 mt-0.5 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
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
