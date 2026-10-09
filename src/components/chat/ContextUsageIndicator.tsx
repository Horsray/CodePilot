'use client';

import type { Message } from '@/types';
import { useContextUsage } from '@/hooks/useContextUsage';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';

interface ContextUsageIndicatorProps {
  messages: Message[];
  modelName: string;
  context1m?: boolean;
  hasSummary?: boolean;
  /** Explicit context window returned by /api/providers/models. */
  contextWindow?: number;
  /** Resolved upstream model ID from /api/providers/models — needed to
   *  disambiguate alias windows (first-party opus = 1M vs Bedrock/Vertex
   *  opus = 200K). Omit for provider setups where the alias already
   *  matches the catalog context-window table. */
  upstreamModelId?: string;
  /**
   * Phase 5 — post-turn snapshot from SDK.getContextUsage(). When
   * supplied and fresh (<60s), this replaces the char-based estimator
   * as the source for used / total. Tooltip gets a "精确 · N 秒前" tag.
   */
  contextUsageSnapshot?: {
    totalTokens: number;
    maxTokens: number;
    capturedAt: number;
  };
}

function formatSnapshotAge(
  capturedAt: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const ageSec = Math.max(0, Math.floor((Date.now() - capturedAt) / 1000));
  if (ageSec < 60) return t('context.secondsAgo', { n: ageSec });
  const ageMin = Math.floor(ageSec / 60);
  return t('context.minutesAgo', { n: ageMin });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// 中文注释：对齐 cc-haha formatPercent —— 两位数以上不带小数，个位数保留一位
function formatPercent(ratio: number): string {
  const value = ratio * 100;
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)}%`;
}

/**
 * 中文注释：上下文用量指示器，形态对齐 cc-haha
 * `components/chat/ContextUsageIndicator.tsx`——16px 环形进度 + 悬停详情面板，
 * 面板内含百分比进度条、已用/总计、剩余空间，颜色阈值 80% 警告 / 95% 危险。
 */
export function ContextUsageIndicator({ messages, modelName, context1m, hasSummary, contextWindow, upstreamModelId, contextUsageSnapshot }: ContextUsageIndicatorProps) {
  const { t } = useTranslation();
  const usage = useContextUsage(messages, modelName, {
    context1m,
    hasSummary,
    contextWindow,
    upstreamModelId,
    snapshot: contextUsageSnapshot,
  });

  const size = 16;
  const strokeWidth = 1.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedRatio = Math.max(0, Math.min(1, usage.ratio));
  const offset = circumference - clampedRatio * circumference;

  const freeTokens = usage.contextWindow ? Math.max(0, usage.contextWindow - usage.used) : 0;

  // Color thresholds mirror cc-haha: >=95% critical, >=80% warning, else brand.
  let strokeColor = 'var(--outline)';
  if (usage.hasData) {
    if (usage.state === 'critical') strokeColor = 'var(--status-error)';
    else if (usage.state === 'warning') strokeColor = 'var(--status-warning)';
    else strokeColor = 'var(--brand)';
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="p-1">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              className="stroke-muted"
            />
            {/* Usage arc */}
            {usage.hasData && usage.ratio > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ stroke: strokeColor, transition: 'stroke-dashoffset 0.3s ease' }}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
          </svg>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-[280px] p-3 text-xs">
        {!usage.hasData ? (
          <p className="text-muted-foreground">{t('context.noData')}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.model')}</span>
              <span className="max-w-[160px] truncate font-medium">{usage.modelName}</span>
            </div>

            {usage.contextWindow && (
              <>
                {/* 占用百分比 */}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('context.usage')}</span>
                  <span className="font-medium">{formatPercent(usage.ratio)}</span>
                </div>
                {/* 进度条（对齐 cc-haha） */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0.5, usage.ratio * 100))}%`,
                      backgroundColor: strokeColor,
                    }}
                  />
                </div>
                {/* 已用 / 总计 */}
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    {formatTokens(usage.used)} {t('context.used')}
                  </span>
                  <span className="text-muted-foreground">/ {formatTokens(usage.contextWindow)}</span>
                </div>
                {/* 剩余空间 */}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('context.free')}</span>
                  <span className="font-medium">{formatTokens(freeTokens)}</span>
                </div>
                {usage.estimatedNextTurn > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('context.nextEstimate')}</span>
                    <span className={`font-medium ${usage.estimatedNextRatio >= 0.8 ? 'text-status-warning-foreground' : ''}`}>
                      ~{formatTokens(usage.estimatedNextTurn)} ({formatPercent(usage.estimatedNextRatio)})
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context.cacheRead')}</span>
                <span>{formatTokens(usage.cacheReadTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context.cacheCreation')}</span>
                <span>{formatTokens(usage.cacheCreationTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context.outputTokens')}</span>
                <span>{formatTokens(usage.outputTokens)}</span>
              </div>
            </div>
            {usage.hasSummary && (
              <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                <span className="text-muted-foreground">{t('context.summary')}</span>
                <span className="text-green-600 dark:text-green-400">{t('context.summaryActive')}</span>
              </div>
            )}
            {usage.state !== 'normal' && (
              <p className="text-[10px] pt-1 border-t border-border text-status-warning-foreground">
                {usage.state === 'critical' ? t('context.criticalHint') : t('context.warningHint')}
              </p>
            )}
            {/* Phase 5 — data source indicator. Both 'snapshot' (unused
                today) and 'result_usage' (active primary source) are
                SDK-authoritative numbers — NOT char-based estimates. */}
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
              {usage.source === 'snapshot' && usage.snapshotCapturedAt
                ? `📌 ${t('context.sourceSnapshot')} · ${formatSnapshotAge(usage.snapshotCapturedAt, t)}`
                : `📌 ${t('context.sourceResultUsage')}`}
            </p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
