'use client';

import { FileText, Sparkle } from '@phosphor-icons/react';

interface TimelineFinalSummaryProps {
  content: string;
}

/**
 * 中文注释：功能名称「时间线最终总结卡片」，用法是在时间线步骤渲染结束后展示模型最终回答，
 * 避免最终文本和步骤明细混在一起，方便用户快速查看结论。
 */
export function TimelineFinalSummary({ content }: TimelineFinalSummaryProps) {
  const clean = content.trim();
  if (!clean) return null;

  return (
    <div className="mt-3 rounded-xl border border-border/40 bg-muted/[0.16] px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80">
        <Sparkle size={12} />
        <span>最终总结</span>
      </div>
      <div className="rounded-lg border border-border/30 bg-background/80 px-3 py-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/65">
          <FileText size={11} />
          <span>模型回复</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground/90">
          {clean}
        </div>
      </div>
    </div>
  );
}
