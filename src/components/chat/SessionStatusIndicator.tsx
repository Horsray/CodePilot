/**
 * SessionStatusIndicator.tsx — 会话状态指示器组件
 *
 * 功能：在聊天框底部状态栏显示当前会话的紧凑状态信息，
 * 包括子Agent数量、工具调用数、技能调用数。
 *
 * hover 时显示本轮实际使用的工具名和技能名。
 */

'use client';

import { useMemo } from 'react';
import { Robot, Wrench, PuzzlePiece, SpinnerGap, CheckCircle, XCircle } from '@phosphor-icons/react';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import { useTranslation } from '@/hooks/useTranslation';
import type { SubAgentInfo } from '@/types';

/** 工具调用信息 */
interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

/** 组件属性 */
interface SessionStatusIndicatorProps {
  /** 当前活跃的子Agent列表 */
  subAgents?: SubAgentInfo[];
  /** 本轮工具调用列表 */
  toolUses?: ToolUseInfo[];
  /** 技能调用总数 */
  skillCount?: number;
}

function pickEntryName(entry: unknown, fallback: string): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const candidate = entry as Record<string, unknown>;
    const raw = candidate.name ?? candidate.id ?? candidate.command ?? candidate.slug ?? candidate.title;
    if (typeof raw === 'string' && raw.trim()) return raw;
  }
  return fallback;
}

function normalizeNamedEntries(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => pickEntryName(entry, `item-${index + 1}`))
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

/**
 * 会话状态指示器组件
 * 紧凑显示 agent、工具、技能的调用情况，hover 查看具体名称。
 */
export function SessionStatusIndicator({ subAgents = [], toolUses = [], skillCount = 0 }: SessionStatusIndicatorProps) {
  const { t } = useTranslation();

  // 计算 agent 统计
  const agentStats = useMemo(() => {
    const total = subAgents.length;
    const running = subAgents.filter(a => a.status === 'running').length;
    const completed = subAgents.filter(a => a.status === 'completed').length;
    const error = subAgents.filter(a => a.status === 'error').length;
    return { total, running, completed, error };
  }, [subAgents]);

  // 提取去重的工具名
  const uniqueToolNames = useMemo(() => {
    const names = toolUses.map(t => t.name).filter(Boolean);
    return [...new Set(names)];
  }, [toolUses]);

  const toolCount = toolUses.length;
  const hasData = agentStats.total > 0 || toolCount > 0 || skillCount > 0;

  if (!hasData) return null;

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-1.5 py-0.5 rounded-md text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-muted/30 transition-colors cursor-default"
        >
          {/* Agent 数量 */}
          {agentStats.total > 0 && (
            <span className="flex items-center gap-0.5">
              <Robot size={10} />
              <span>{agentStats.total}</span>
              {agentStats.running > 0 && (
                <SpinnerGap size={8} className="animate-spin text-blue-500" />
              )}
            </span>
          )}

          {/* 工具调用数 */}
          {toolCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Wrench size={10} />
              <span>{toolCount}</span>
            </span>
          )}

          {/* 技能调用数 */}
          {skillCount > 0 && (
            <span className="flex items-center gap-0.5">
              <PuzzlePiece size={10} />
              <span>{skillCount}</span>
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-64 p-3 text-xs">
        <div className="space-y-1.5">
          {/* Agent 统计 */}
          {agentStats.total > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('session.agents')}</span>
                <span className="font-medium">{agentStats.total}</span>
              </div>
              {agentStats.running > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('session.running')}</span>
                  <span className="font-medium text-blue-500 flex items-center gap-1">
                    <SpinnerGap size={10} className="animate-spin" />
                    {agentStats.running}
                  </span>
                </div>
              )}
              {agentStats.completed > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('session.completed')}</span>
                  <span className="font-medium text-emerald-500 flex items-center gap-1">
                    <CheckCircle size={10} weight="fill" />
                    {agentStats.completed}
                  </span>
                </div>
              )}
              {agentStats.error > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('session.errors')}</span>
                  <span className="font-medium text-red-500 flex items-center gap-1">
                    <XCircle size={10} weight="fill" />
                    {agentStats.error}
                  </span>
                </div>
              )}
            </>
          )}

          {/* 工具调用 — 显示具体工具名 */}
          {uniqueToolNames.length > 0 && (
            <div className="border-t border-border pt-1.5 mt-1.5">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">{t('session.toolCalls')}</span>
                <span className="font-medium">{toolCount}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {uniqueToolNames.map(name => (
                  <span key={name} className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 技能调用 — 仅显示技能数，无具体名称 */}
          {skillCount > 0 && uniqueToolNames.length === 0 && (
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="text-muted-foreground">技能调用</span>
              <span className="font-medium">{skillCount}</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
