"use client";

import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CaretDown, CaretRight, PushPin } from "@/components/ui/icon";
import type { TranslationKey } from "@/i18n";

interface PinnedSessionsSectionProps {
  /** 收藏的会话数量（分组头右侧显示） */
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  children: ReactNode;
}

/**
 * 中文注释：收藏会话模块 —— 位于「绘影智能体」（助手工作区分组）下方、其余项目分组之前。
 * 被收藏（图钉）的会话从原项目分组隐藏，统一在这里展示；折叠状态按本地偏好记忆。
 *
 * 行内容由调用方以 children 注入：复用项目分组内的同一套 SessionListItem 渲染，
 * 从而完整继承任务运行态（转圈）、完成未读（蓝点）与待批准（铃铛）指示。
 */
export function PinnedSessionsSection({
  count,
  collapsed,
  onToggleCollapse,
  t,
  children,
}: PinnedSessionsSectionProps) {
  return (
    <div className="mt-1 first:mt-0">
      <div
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
        onClick={onToggleCollapse}
      >
        {collapsed ? (
          <CaretRight size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <CaretDown size={14} className="shrink-0 text-muted-foreground" />
        )}
        <PushPin size={14} weight="fill" className="shrink-0 text-primary" />
        <span className="flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
          {t('chatList.pinnedSessions' as TranslationKey)}
        </span>
        <span className="text-[11px] text-muted-foreground/60">{count}</span>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
