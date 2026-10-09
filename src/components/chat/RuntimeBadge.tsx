'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';

interface RuntimeBadgeProps {
  providerId?: string;
}

interface ClaudeStatusPayload {
  connected?: boolean;
  omcConfigured?: boolean;
  omcLoaded?: boolean;
}

export function RuntimeBadge({ providerId }: RuntimeBadgeProps) {
  const [status, setStatus] = useState<ClaudeStatusPayload>({});
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const qs = providerId ? `?providerId=${encodeURIComponent(providerId)}` : '';
        const res = await fetch(`/api/claude-status${qs}`).catch(() => null);
        const data = res?.ok ? await res.json() : null;
        setStatus(data || {});
      } catch {
        /* ignore — keep previous status */
      }
    };
    loadStatus();
    const handler = () => loadStatus();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [providerId]);

  if (!status.connected || (!status.omcConfigured && !status.omcLoaded)) {
    return null;
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="text-[10px] px-0 py-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => router.push('/settings#cli')}
        >
          OMC
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-3 text-xs space-y-1.5">
        {/* 中文注释：功能名称「OMC 会话徽章」，用法是只在检测到 OMC 已启用或已加载时，
            在聊天底部显示简洁的 OMC 文本标签，帮助用户直观看到当前会话是否接近终端版体验。 */}
        <p className="text-foreground">
          {status.omcLoaded
            ? (isZh ? 'OMC 已接管当前会话' : 'OMC is active in this session')
            : (isZh ? 'OMC 已启用，下一轮会话应接管' : 'OMC is enabled and should attach on the next turn')}
        </p>
        <p className="text-muted-foreground">
          {isZh ? '点击前往设置' : 'Click to open settings'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
