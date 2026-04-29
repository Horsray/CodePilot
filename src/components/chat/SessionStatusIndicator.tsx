/**
 * SessionStatusIndicator.tsx — 会话状态指示器组件
 *
 * 功能：在聊天框底部状态栏显示当前会话的紧凑状态信息，
 * 包括子Agent数量、工具调用数、技能调用数。
 * 使用小字体设计，不干扰主会话区域的视觉。
 *
 * 用法：
 *   <SessionStatusIndicator subAgents={subAgents} toolCount={toolCount} skillCount={skillCount} />
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
import type { ClaudeInitMeta, PromptInstructionSourceMeta, SubAgentInfo } from '@/types';

/** 组件属性 */
interface SessionStatusIndicatorProps {
  /** 当前活跃的子Agent列表 */
  subAgents?: SubAgentInfo[];
  /** 工具调用总数 */
  toolCount?: number;
  /** 技能调用总数 */
  skillCount?: number;
  /** Claude Code system/init 返回的能力快照 */
  initMeta?: ClaudeInitMeta | null;
  /** 本轮实际注入的规则/索引来源 */
  instructionSources?: PromptInstructionSourceMeta[];
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
 * 功能：紧凑显示当前会话的 agent 数量、工具调用数、技能调用数
 * 用法：放置在 ChatComposerActionBar 的右侧区域
 */
export function SessionStatusIndicator({ subAgents = [], toolCount = 0, skillCount = 0, initMeta = null, instructionSources = [] }: SessionStatusIndicatorProps) {
  const { t } = useTranslation();

  // 计算 agent 统计
  const agentStats = useMemo(() => {
    const total = subAgents.length;
    const running = subAgents.filter(a => a.status === 'running').length;
    const completed = subAgents.filter(a => a.status === 'completed').length;
    const error = subAgents.filter(a => a.status === 'error').length;
    return { total, running, completed, error };
  }, [subAgents]);

  const visibleInstructionSources = useMemo(
    () => instructionSources.filter((source) => source.category === 'hard_rule' || source.category === 'repo_instruction' || source.category === 'index_doc'),
    [instructionSources],
  );

  const initSummary = useMemo(() => {
    const tools = normalizeNamedEntries(initMeta?.tools);
    const slashCommands = normalizeNamedEntries(initMeta?.slash_commands);
    const skills = normalizeNamedEntries(initMeta?.skills);
    const mcpServers = normalizeNamedEntries(initMeta?.mcp_servers);
    const plugins = Array.isArray(initMeta?.plugins)
      ? initMeta!.plugins
        .map((plugin) => plugin?.name || plugin?.path)
        .filter(Boolean)
      : [];

    return {
      tools,
      slashCommands,
      skills,
      mcpServers,
      plugins,
      outputStyle: typeof initMeta?.output_style === 'string' ? initMeta.output_style : '',
    };
  }, [initMeta]);

  const hasInitDiagnostics =
    initSummary.tools.length > 0 ||
    initSummary.slashCommands.length > 0 ||
    initSummary.skills.length > 0 ||
    initSummary.mcpServers.length > 0 ||
    initSummary.plugins.length > 0 ||
    !!initSummary.outputStyle;

  // 无活跃数据时不显示
  if (agentStats.total === 0 && toolCount === 0 && skillCount === 0 && visibleInstructionSources.length === 0 && !hasInitDiagnostics) return null;

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

          {visibleInstructionSources.length > 0 && (
            <span className="flex items-center gap-0.5">
              <span>规</span>
              <span>{visibleInstructionSources.length}</span>
            </span>
          )}

          {hasInitDiagnostics && (
            <span className="flex items-center gap-0.5">
              <span>载</span>
              <span>{initSummary.skills.length + initSummary.mcpServers.length + initSummary.plugins.length}</span>
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-3 text-xs">
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

          {/* 工具调用统计 */}
          {toolCount > 0 && (
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="text-muted-foreground">{t('session.toolCalls')}</span>
              <span className="font-medium">{toolCount}</span>
            </div>
          )}

          {/* 技能调用统计 */}
          {skillCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">技能调用</span>
              <span className="font-medium">{skillCount}</span>
            </div>
          )}

          {hasInitDiagnostics && (
            <>
              <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                <span className="text-muted-foreground">CLI 已加载能力</span>
                <span className="font-medium">
                  技能 {initSummary.skills.length} / MCP {initSummary.mcpServers.length}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">工具</span>
                  <span className="font-medium">{initSummary.tools.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slash 命令</span>
                  <span className="font-medium">{initSummary.slashCommands.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skills</span>
                  <span className="font-medium">{initSummary.skills.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MCP</span>
                  <span className="font-medium">{initSummary.mcpServers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plugins</span>
                  <span className="font-medium">{initSummary.plugins.length}</span>
                </div>
                {initSummary.outputStyle && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">输出风格</span>
                    <span className="font-medium">{initSummary.outputStyle}</span>
                  </div>
                )}
                {initSummary.skills.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-muted-foreground">已加载 Skills</div>
                    {initSummary.skills.slice(0, 5).map((name) => (
                      <div key={name} className="truncate text-foreground/85">{name}</div>
                    ))}
                    {initSummary.skills.length > 5 && (
                      <div className="text-[10px] text-muted-foreground">+{initSummary.skills.length - 5} 个 Skills</div>
                    )}
                  </div>
                )}
                {initSummary.mcpServers.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-muted-foreground">已加载 MCP</div>
                    {initSummary.mcpServers.slice(0, 5).map((name) => (
                      <div key={name} className="truncate text-foreground/85">{name}</div>
                    ))}
                    {initSummary.mcpServers.length > 5 && (
                      <div className="text-[10px] text-muted-foreground">+{initSummary.mcpServers.length - 5} 个 MCP</div>
                    )}
                  </div>
                )}
                {initSummary.plugins.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-muted-foreground">已加载插件</div>
                    {initSummary.plugins.slice(0, 4).map((name) => (
                      <div key={name} className="truncate text-foreground/85">{name}</div>
                    ))}
                    {initSummary.plugins.length > 4 && (
                      <div className="text-[10px] text-muted-foreground">+{initSummary.plugins.length - 4} 个插件</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {visibleInstructionSources.length > 0 && (
            <>
              <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                <span className="text-muted-foreground">{t('session.injectedRules')}</span>
                <span className="font-medium">{visibleInstructionSources.length}</span>
              </div>
              <div className="space-y-1">
                {visibleInstructionSources.slice(0, 6).map((source) => (
                  <div key={`${source.level}:${source.filename}`} className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">{source.filename}</span>
                    <span className="shrink-0 text-[10px] text-foreground/80">{source.level}</span>
                  </div>
                ))}
                {visibleInstructionSources.length > 6 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{visibleInstructionSources.length - 6} {t('session.moreRules')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
