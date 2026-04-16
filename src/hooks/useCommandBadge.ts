import { useState, useCallback } from 'react';
import type { CommandBadge, CliBadge } from '@/types';

export type { CommandBadge, CliBadge } from '@/types';

export interface UseCommandBadgeReturn {
  badges: CommandBadge[];
  addBadge: (badge: CommandBadge) => void;
  clearBadges: () => void;
  badge: CommandBadge | null;
  setBadge: (badge: CommandBadge | null) => void;
  cliBadge: CliBadge | null;
  setCliBadge: (badge: CliBadge | null) => void;
  removeBadge: (command?: string) => void;
  removeCliBadge: () => void;
  hasBadge: boolean;
}

export function useCommandBadge(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
): UseCommandBadgeReturn {
  const [badges, setBadges] = useState<CommandBadge[]>([]);
  const [cliBadge, setCliBadge] = useState<CliBadge | null>(null);

  // 中文注释：功能名称「命令徽章追加策略」。
  // 用法：agent_skill 允许多选去重，其他类型保持单选替换，兼容官方输入交互。
  const addBadge = useCallback((incoming: CommandBadge) => {
    setBadges((prev) => {
      if (incoming.kind !== 'agent_skill') {
        return [incoming];
      }
      const allSkills = prev.every((b) => b.kind === 'agent_skill');
      if (!allSkills) return [incoming];
      if (prev.some((b) => b.command === incoming.command)) return prev;
      return [...prev, incoming];
    });
  }, []);

  const setBadge = useCallback((incoming: CommandBadge | null) => {
    setBadges(incoming ? [incoming] : []);
  }, []);

  const clearBadges = useCallback(() => {
    setBadges([]);
  }, []);

  const removeBadge = useCallback((command?: string) => {
    setBadges((prev) => {
      if (prev.length === 0) return prev;
      if (!command) return prev.slice(0, -1);
      return prev.filter((b) => b.command !== command);
    });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [textareaRef]);

  const removeCliBadge = useCallback(() => {
    setCliBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [textareaRef]);

  return {
    badges,
    addBadge,
    clearBadges,
    badge: badges[0] || null,
    setBadge,
    cliBadge,
    setCliBadge,
    removeBadge,
    removeCliBadge,
    hasBadge: badges.length > 0 || !!cliBadge,
  };
}
