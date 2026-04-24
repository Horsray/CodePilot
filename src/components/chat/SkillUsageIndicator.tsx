/**
 * SkillUsageIndicator.tsx — 技能调用指示器组件
 *
 * 功能：在聊天输入框右上角显示本轮对话的 Skill 调用计数，
 * 点击后展开显示具体的技能名称和描述。
 *
 * 只追踪 Skill 工具调用（name === 'Skill'），不追踪普通工具调用。
 *
 * 用法：
 *   <SkillUsageIndicator toolUses={toolUses} toolResults={toolResults} />
 */

'use client';

import { useState, useMemo } from 'react';
import { PuzzlePiece, CaretDown, CheckCircle, XCircle } from '@/components/ui/icon';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

/** 工具调用信息 */
interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

/** 工具调用结果信息 */
interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** 解析后的技能调用信息 */
interface SkillInvocation {
  /** 调用 ID */
  id: string;
  /** 技能名称 */
  skillName: string;
  /** 传入参数 */
  arguments?: Record<string, string>;
  /** 是否执行失败 */
  isFailed: boolean;
}

/** 组件属性 */
interface SkillUsageIndicatorProps {
  /** 本轮对话的工具调用列表 */
  toolUses?: ToolUseInfo[];
  /** 工具调用结果列表 */
  toolResults?: ToolResultInfo[];
}

/**
 * 从 toolUses 中提取 Skill 调用。
 * 只关注 name === 'Skill' 的工具调用。
 */
function extractSkillInvocations(
  toolUses: ToolUseInfo[],
  toolResults: ToolResultInfo[],
): SkillInvocation[] {
  const failedIds = new Set<string>();
  for (const result of toolResults) {
    if (result.is_error) failedIds.add(result.tool_use_id);
  }

  const skills: SkillInvocation[] = [];
  for (const use of toolUses) {
    if (use.name !== 'Skill') continue;

    const input = (use.input || {}) as Record<string, unknown>;
    const skillName = typeof input.skill_name === 'string' ? input.skill_name : 'unknown';
    const args = typeof input.arguments === 'object' && input.arguments !== null
      ? input.arguments as Record<string, string>
      : undefined;

    skills.push({
      id: use.id,
      skillName,
      arguments: args,
      isFailed: failedIds.has(use.id),
    });
  }

  return skills;
}

/**
 * 技能调用指示器组件。
 * 显示在输入框右上角，只统计 Skill 工具调用。
 */
export function SkillUsageIndicator({ toolUses = [], toolResults = [] }: SkillUsageIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 提取技能调用
  const skills = useMemo(
    () => extractSkillInvocations(toolUses, toolResults),
    [toolUses, toolResults],
  );

  const totalCount = skills.length;
  const uniqueCount = new Set(skills.map(s => s.skillName)).size;
  const hasErrors = skills.some(s => s.isFailed);

  // 无技能调用时不显示
  if (totalCount === 0) return null;

  return (
    <HoverCard openDelay={100} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`
            absolute -top-3 right-3 z-10
            flex items-center gap-1 px-2 py-0.5
            rounded-full text-xs font-medium
            transition-all duration-200 cursor-pointer
            border shadow-sm
            ${hasErrors
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50'
              : 'bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/50'
            }
          `}
          title="点击查看技能调用详情"
        >
          <PuzzlePiece size={12} />
          <span>{totalCount}</span>
          <CaretDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 p-0 overflow-hidden"
      >
        {/* 头部 */}
        <div className="px-3 py-2 bg-muted/50 border-b">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              本轮技能调用
            </span>
            <span className="text-xs text-muted-foreground">
              {uniqueCount} 种技能 · {totalCount} 次调用
            </span>
          </div>
        </div>

        {/* 技能列表 */}
        <div className="max-h-60 overflow-y-auto">
          {skills.map((skill, index) => (
            <div
              key={skill.id}
              className={`
                flex items-start gap-2 px-3 py-2 text-xs
                ${index < skills.length - 1 ? 'border-b border-border/50' : ''}
                ${skill.isFailed ? 'bg-red-50/50 dark:bg-red-950/20' : ''}
              `}
            >
              {/* 状态图标 */}
              <span className="mt-0.5 shrink-0">
                {skill.isFailed ? (
                  <XCircle size={12} className="text-red-500" />
                ) : (
                  <CheckCircle size={12} className="text-violet-500" />
                )}
              </span>

              {/* 技能信息 */}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground">
                  {skill.skillName}
                </span>
                {skill.arguments && Object.keys(skill.arguments).length > 0 && (
                  <div className="text-muted-foreground truncate mt-0.5">
                    {Object.entries(skill.arguments).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                )}
              </div>

              {/* 序号 */}
              <span className="text-muted-foreground/40 shrink-0">
                #{index + 1}
              </span>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
