/**
 * TerminalReasonChip — renders a contextual end-of-turn status chip based on
 * the turn's terminal reason (SDK 0.2.111+ native values + fork extensions).
 *
 * 统一终止态（turn-outcome.ts）之后：徽章的可见性 / 色调 / 文案 / 动作按钮
 * 全部由 src/lib/turn-outcome.ts 的总表驱动——新增 reason 只需在表里加一行，
 * 不再维护白名单 + 色调表 + 文案表三份拷贝。
 *
 * 未知 reason（含未来 SDK 新值）不渲染徽章：fail-safe 静默，
 * 不再用「本轮已结束」黄色警示误报。消息底部状态由落库的 outcome 字段决定。
 */

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  chipForReason,
  actionsForReason,
  ACTION_LABEL_KEYS,
  ACTION_VARIANTS,
  type TerminalActionId,
  type TerminalTone,
} from '@/lib/turn-outcome';

export type { TerminalActionId };

interface Props {
  reason: string | undefined;
  onAction?: (actionId: TerminalActionId) => void;
}

const TONE_CLASSES: Record<TerminalTone, string> = {
  warning: 'bg-status-warning-muted text-status-warning-foreground border-status-warning-muted',
  error: 'bg-status-error-muted text-status-error-foreground border-status-error-muted',
  info: 'bg-status-info-muted text-status-info-foreground border-status-info-muted',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function TerminalReasonChip({ reason, onAction }: Props) {
  const { t } = useTranslation();

  const chip = chipForReason(reason);
  // 无条目（未知 reason）或显式 silent → 不渲染
  if (!chip || chip === 'silent') return null;

  const actions = onAction ? actionsForReason(reason) : [];

  return (
    <div className="mx-auto mt-2 flex w-full max-w-3xl flex-wrap items-center justify-start gap-2 px-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[chip.tone]}`}
        data-terminal-reason={reason}
      >
        {t(chip.labelKey as TranslationKey)}
      </span>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction?.(action)}
          data-terminal-action={action}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            ACTION_VARIANTS[action] === 'primary'
              ? `${TONE_CLASSES[chip.tone]} hover:opacity-90`
              : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          {t(ACTION_LABEL_KEYS[action] as TranslationKey)}
        </button>
      ))}
    </div>
  );
}
