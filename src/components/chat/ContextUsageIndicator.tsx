'use client';

import type { TranslationKey } from '@/i18n';
import type { Message } from '@/types';
import { useContextUsage } from '@/hooks/useContextUsage';
import { useTranslation } from '@/hooks/useTranslation';
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
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function ContextUsageIndicator({ messages, modelName, context1m, hasSummary }: ContextUsageIndicatorProps) {
  const { t } = useTranslation();
  const usage = useContextUsage(messages, modelName, { context1m, hasSummary });

  const size = 16;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - usage.ratio * circumference;

  // Color based on context state
  let strokeColor = 'text-muted-foreground';
  if (usage.hasData) {
    if (usage.state === 'critical') strokeColor = 'text-status-error-foreground';
    else if (usage.state === 'warning') strokeColor = 'text-status-warning-foreground';
    else strokeColor = 'text-zinc-600 dark:text-zinc-400';
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
                className={`${strokeColor} transition-all`}
                style={{ stroke: 'currentColor' }}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
          </svg>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-56 p-3 text-xs">
        {!usage.hasData ? (
          <p className="text-muted-foreground">{t('context.noData')}</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.model')}</span>
              <span className="font-medium">{usage.modelName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.used')}</span>
              <span className="font-medium">{formatTokens(usage.used)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.actualContext' as TranslationKey)}</span>
              <span>{formatTokens(usage.actualContextTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.actualCache' as TranslationKey)}</span>
              <span>{formatTokens(usage.actualCacheReadTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('context.total')}</span>
              <span className="font-medium">
                {usage.contextWindow ? formatTokens(usage.contextWindow) : t('context.unknown')}
              </span>
            </div>
            {usage.contextWindow && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('context.percentage')}</span>
                  <span className="font-medium">{(usage.ratio * 100).toFixed(1)}%</span>
                </div>
                {usage.estimatedNextTurn > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('context.nextEstimate')}</span>
                    <span className={`font-medium ${usage.estimatedNextRatio >= 0.8 ? 'text-status-warning-foreground' : ''}`}>
                      ~{formatTokens(usage.estimatedNextTurn)} ({(usage.estimatedNextRatio * 100).toFixed(1)}%)
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context.cacheRead')}</span>
                <span>{formatTokens(usage.actualCacheReadTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context.cacheCreation')}</span>
                <span>{formatTokens(usage.actualCacheCreationTokens)}</span>
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
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
              {t('context.estimate')}
            </p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
