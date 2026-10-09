/**
 * turn-outcome.ts — 任务终止态的唯一推导点（Single Source of Truth）。
 *
 * 背景：此前终止态从未被当作数据建模——服务端/前端 9 处各自合成
 * terminal_reason 字符串，4 处各自重新分类（含渲染时反向解析正文里的中文
 * 散文），导致同一条消息在消息底部徽标、系统通知、徽章之间结论互相矛盾
 * （「中断了却显示完成 / 完成了却显示中断」）。
 *
 * 统一模型分两层：
 * - TurnOutcome（大类）：所有 UI 面的一致判定标准，由 outcomeFromReason()
 *   在唯一入口推导；
 * - terminal_reason（细因）：驱动徽章文案与动作按钮，见 REASON_TABLE。
 *
 * 新增一个终止原因时，只需在本表加一行——不要再在各消费点手写补丁。
 */

import type { StreamPhase, TurnOutcome } from '@/types';

export type TurnStatus = 'completed' | 'interrupted' | 'failed';
export type TerminalTone = 'warning' | 'error' | 'info' | 'muted';

/**
 * 徽章动作 id（原定义于 TerminalReasonChip，迁移至此以保持表驱动单一化）。
 * ChatView 将每个 id 接驳到对应子系统（压缩器、1m 开关、模型切换、路由器等）。
 */
export type TerminalActionId =
  | 'compress_and_retry'
  | 'enable_1m_and_retry'
  | 'compress_only'
  | 'switch_to_sonnet'
  | 'continue_max_turns'
  | 'open_hook_settings'
  | 'retry_simple'
  | 'retry_image_upload';

export interface TurnOutcomeEntry {
  /** 细因（SDK 原生 terminal_reason 或 fork 扩展） */
  reason: string;
  /** 大类：消息底部徽标、通知、列表的一致判定标准 */
  outcome: TurnOutcome;
  /** 映射到 snapshot.phase（兼容现有 StreamPhase 消费方） */
  phase: StreamPhase;
  /**
   * 徽章配置；'silent' = 不渲染（用户已知或消息本身已说明）。
   * labelKey 为 i18n 键（'terminal.*'），未知原因无条目 → 不渲染徽章。
   */
  chip?: { tone: TerminalTone; labelKey: string } | 'silent';
  /** 徽章动作按钮（顺序即视觉顺序） */
  actions?: TerminalActionId[];
  /**
   * 追加到消息正文的用户可读说明。支持 {toolName}/{elapsedSeconds} 占位符。
   * 注意：它是给人看的散文，状态判定绝不依赖它（判定只读 outcome 字段）。
   */
  messageNote?: string;
  /** 完成系统通知（null/缺省 = 不发）。title/body 为服务端直接使用的文案。 */
  notification?: { title: string; body: string };
}

/** 大类 → 消息底部徽标（色调 + 文案键） */
export const TURN_OUTCOME_META: Record<TurnOutcome, { status: TurnStatus; labelKey: string }> = {
  completed: { status: 'completed', labelKey: 'turnOutcome.completed' },
  cancelled: { status: 'interrupted', labelKey: 'turnOutcome.cancelled' },
  upstream_error: { status: 'failed', labelKey: 'turnOutcome.upstreamError' },
  upstream_interrupted: { status: 'interrupted', labelKey: 'turnOutcome.upstreamInterrupted' },
  stalled: { status: 'interrupted', labelKey: 'turnOutcome.stalled' },
  graceful_stopped: { status: 'interrupted', labelKey: 'turnOutcome.gracefulStopped' },
  tool_timeout: { status: 'interrupted', labelKey: 'turnOutcome.toolTimeout' },
  stopped: { status: 'interrupted', labelKey: 'turnOutcome.stopped' },
};

/** 徽章动作 → 按钮文案键（沿用原 TerminalReasonChip 的 terminalAction.* 键） */
export const ACTION_LABEL_KEYS: Record<TerminalActionId, string> = {
  compress_and_retry: 'terminalAction.compressAndRetry',
  enable_1m_and_retry: 'terminalAction.enable1mAndRetry',
  compress_only: 'terminalAction.compressOnly',
  switch_to_sonnet: 'terminalAction.switchToSonnet',
  continue_max_turns: 'terminalAction.continue',
  open_hook_settings: 'terminalAction.openHookSettings',
  retry_simple: 'terminalAction.retry',
  retry_image_upload: 'terminalAction.retryImageUpload',
};

/** 徽章动作 → 主/次按钮样式（primary 用徽章色调实底，secondary 用 ghost） */
export const ACTION_VARIANTS: Record<TerminalActionId, 'primary' | 'secondary'> = {
  compress_and_retry: 'primary',
  enable_1m_and_retry: 'secondary',
  compress_only: 'secondary',
  switch_to_sonnet: 'primary',
  continue_max_turns: 'primary',
  open_hook_settings: 'secondary',
  retry_simple: 'primary',
  retry_image_upload: 'primary',
};

/**
 * 唯一真相表：reason → 全部消费语义。
 * 覆盖 SDK 原生值、fork 扩展值、以及前端本地合成值。
 */
const REASON_TABLE: Record<string, TurnOutcomeEntry> = {
  // ── 正常完成 ─────────────────────────────────────────────
  completed: {
    reason: 'completed',
    outcome: 'completed',
    phase: 'completed',
    chip: 'silent',
  },

  // ── 用户主动中止 ─────────────────────────────────────────
  user_cancel: {
    reason: 'user_cancel',
    outcome: 'cancelled',
    phase: 'stopped',
    chip: 'silent',
    messageNote: '*(任务已由用户手动中断)*',
  },
  /** useSSEStream 兜底：aborted 事件无 reason 时发出 */
  aborted: {
    reason: 'aborted',
    outcome: 'stopped',
    phase: 'aborted',
  },
  aborted_streaming: {
    reason: 'aborted_streaming',
    outcome: 'cancelled',
    phase: 'stopped',
    chip: 'silent',
  },
  aborted_tools: {
    reason: 'aborted_tools',
    outcome: 'cancelled',
    phase: 'stopped',
    chip: 'silent',
  },

  // ── 模型上游错误 / 限流 ──────────────────────────────────
  error: {
    reason: 'error',
    outcome: 'upstream_error',
    phase: 'error',
    chip: 'silent', // 消息正文已有 chat-error 块 + 底部红色徽标，不再加徽章
  },
  max_turns: {
    reason: 'max_turns',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'warning', labelKey: 'terminal.max_turns' },
    actions: ['continue_max_turns'],
  },
  prompt_too_long: {
    reason: 'prompt_too_long',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'error', labelKey: 'terminal.prompt_too_long' },
    actions: ['compress_and_retry', 'enable_1m_and_retry', 'compress_only'],
  },
  blocking_limit: {
    reason: 'blocking_limit',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'error', labelKey: 'terminal.blocking_limit' },
    actions: ['switch_to_sonnet'],
  },
  rapid_refill_breaker: {
    reason: 'rapid_refill_breaker',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'error', labelKey: 'terminal.rapid_refill_breaker' },
    actions: ['switch_to_sonnet'],
  },
  image_error: {
    reason: 'image_error',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'error', labelKey: 'terminal.image_error' },
    actions: ['retry_image_upload'],
  },
  model_error: {
    reason: 'model_error',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'error', labelKey: 'terminal.model_error' },
    actions: ['retry_simple'],
  },
  length: {
    reason: 'length',
    outcome: 'upstream_error',
    phase: 'completed',
    chip: { tone: 'warning', labelKey: 'terminal.length' },
    actions: ['retry_simple'],
  },

  // ── 上游连接中断 ─────────────────────────────────────────
  upstream_interrupted: {
    reason: 'upstream_interrupted',
    outcome: 'upstream_interrupted',
    phase: 'aborted',
    chip: { tone: 'warning', labelKey: 'terminal.upstream_interrupted' },
    messageNote: '*(模型上游中断，本轮任务未完成；可直接重新发送消息继续)*',
    notification: { title: '任务中断', body: '模型上游中断，任务未完成；请重新发送消息继续' },
  },
  /** 前端本地合成：连接断开但服务端任务仍在后台继续 */
  connection_lost: {
    reason: 'connection_lost',
    outcome: 'upstream_interrupted',
    phase: 'completed',
    chip: { tone: 'info', labelKey: 'terminal.connection_lost' },
    messageNote: '*(连接已中断，任务仍在后台继续；稍后刷新可查看最终结果)*',
  },

  // ── 上游长时间无响应（看门狗） ───────────────────────────
  stalled: {
    reason: 'stalled',
    outcome: 'stalled',
    phase: 'aborted',
    chip: { tone: 'error', labelKey: 'terminal.stalled' },
    messageNote: '*(模型上游长时间无响应，本轮任务已中止；可直接重新发送消息重试)*',
    notification: { title: '任务已中止', body: '模型上游长时间无响应，可直接重新发送消息重试' },
  },

  // ── fork 优雅收尾（后台任务仍在运行） ────────────────────
  background_wait_timeout: {
    reason: 'background_wait_timeout',
    outcome: 'graceful_stopped',
    phase: 'completed',
    chip: { tone: 'info', labelKey: 'terminal.background_wait_timeout' },
    messageNote: '*(后台任务仍在运行，本轮已结束等待；任务完成后的结果会保留在会话中，可直接继续对话)*',
    notification: { title: '本轮已收尾', body: '后台任务仍在运行，结果会保留在会话中' },
  },
  background_finalization_graceful: {
    reason: 'background_finalization_graceful',
    outcome: 'graceful_stopped',
    phase: 'completed',
    chip: { tone: 'info', labelKey: 'terminal.background_finalization_graceful' },
    messageNote: '*(本轮未等到后台任务的最终汇总，已直接收尾；未完成的部分可直接继续对话)*',
    notification: { title: '本轮已收尾', body: '未等到后台任务的最终汇总，已直接收尾' },
  },
  /**
   * 汇总输出已转发但注入轮 result 迟到/丢失时的正常收尾。
   * 与 background_finalization_graceful 的区别：总结用户已经看到，
   * 不得再说「未等到汇总」——否则出现「总结明明显示了却提示没等到」的竞态误报。
   */
  background_summary_received: {
    reason: 'background_summary_received',
    outcome: 'completed',
    phase: 'completed',
    chip: 'silent',
  },
  /** 历史值（服务端已不再发出，保留映射防止旧数据/旧版本回流误判） */
  background_finalization_timeout: {
    reason: 'background_finalization_timeout',
    outcome: 'graceful_stopped',
    phase: 'aborted',
    chip: { tone: 'warning', labelKey: 'terminal.background_finalization_timeout' },
    messageNote: '*(后台任务已返回，但主任务未能接收结果；正在自动继续原任务)*',
    notification: { title: '任务已中止', body: '后台任务已返回，但主任务未能接收结果' },
  },

  // ── 工具无进度超时 ───────────────────────────────────────
  tool_timeout: {
    reason: 'tool_timeout',
    outcome: 'tool_timeout',
    phase: 'aborted',
    chip: { tone: 'warning', labelKey: 'terminal.tool_timeout' },
    messageNote: '*(工具「{toolName}」超过 {elapsedSeconds} 秒无响应，判定卡死，本轮任务已中止)*',
    notification: { title: '任务已中止', body: '工具长时间无响应，已判定卡死' },
  },

  // ── Hook 中止 / 其他未完成 ───────────────────────────────
  hook_stopped: {
    reason: 'hook_stopped',
    outcome: 'stopped',
    phase: 'aborted',
    chip: { tone: 'muted', labelKey: 'terminal.hook_stopped' },
    actions: ['open_hook_settings'],
  },
  stop_hook_prevented: {
    reason: 'stop_hook_prevented',
    outcome: 'stopped',
    phase: 'aborted',
    chip: { tone: 'muted', labelKey: 'terminal.stop_hook_prevented' },
    actions: ['open_hook_settings'],
  },

  // ── 完成但有未决事项 ─────────────────────────────────────
  tool_deferred: {
    reason: 'tool_deferred',
    outcome: 'completed',
    phase: 'completed',
    chip: { tone: 'info', labelKey: 'terminal.tool_deferred' },
  },
};

export function entryForReason(reason: string | null | undefined): TurnOutcomeEntry | undefined {
  if (!reason) return undefined;
  return REASON_TABLE[reason];
}

export function isKnownOutcome(value: string | null | undefined): value is TurnOutcome {
  return !!value && value in TURN_OUTCOME_META;
}

/**
 * 唯一分类入口：reason（细因）→ TurnOutcome（大类）。
 *
 * 规则：
 * - 无 reason 且无错误 → completed（SDK/CLI 正常结束不携带 reason）
 * - isError → upstream_error（错误分类的最高优先级信号）
 * - 未知 reason → stopped（本轮已结束但原因未知；绝不误报「任务完成」，
 *   徽章不渲染、通知不发——fail-safe 静默，不制造黄色误报警示）
 */
export function outcomeFromReason(
  reason: string | null | undefined,
  opts: { isError?: boolean } = {},
): TurnOutcome {
  if (opts.isError) return 'upstream_error';
  if (!reason) return 'completed';
  return REASON_TABLE[reason]?.outcome ?? 'stopped';
}

/** 终态 → snapshot.phase（兼容 StreamPhase 消费方） */
export function phaseForReason(
  reason: string | null | undefined,
  opts: { isError?: boolean } = {},
): StreamPhase {
  if (opts.isError) return 'error';
  if (!reason) return 'completed';
  return REASON_TABLE[reason]?.phase ?? 'aborted';
}

/** 徽章 tone（未知 reason 无条目 → 不渲染） */
export function chipForReason(reason: string | null | undefined): TurnOutcomeEntry['chip'] {
  if (!reason) return undefined;
  return REASON_TABLE[reason]?.chip;
}

/** 徽章动作（未知 reason → 无动作） */
export function actionsForReason(reason: string | null | undefined): TerminalActionId[] {
  if (!reason) return [];
  return REASON_TABLE[reason]?.actions ?? [];
}

/**
 * 正文说明（用户可读散文，由表生成——此前散落在 stream-session-manager
 * 的 if 链里，新增原因时漏加导致「干到一半突然结束、毫无提示」）。
 */
export function noteForReason(
  reason: string | null | undefined,
  ctx: { toolName?: string; elapsedSeconds?: number } = {},
): string | undefined {
  if (!reason) return undefined;
  const note = REASON_TABLE[reason]?.messageNote;
  if (!note) return undefined;
  return note
    .replace(/\{toolName\}/g, ctx.toolName ?? '未知工具')
    .replace(/\{elapsedSeconds\}/g, String(ctx.elapsedSeconds ?? 0));
}

/** 完成通知（null = 不发）。服务端 route.ts 落库后据此投递。 */
export function notificationForReason(
  reason: string | null | undefined,
  opts: { isError?: boolean } = {},
): { title: string; body: string } | null {
  if (opts.isError) return null;
  if (!reason) return { title: '任务已完成', body: '模型回复已就绪' }; // 无 reason 的正常完成
  const entry = REASON_TABLE[reason];
  // 大类为 completed 的所有细因（含 'completed' 本身与 background_summary_received）
  // 都按正常完成通知处理——此前只认「无 reason」，SDK 显式携带 terminal_reason:
  // 'completed' 时反而丢失完成通知。
  if (entry?.outcome === 'completed') return { title: '任务已完成', body: '模型回复已就绪' };
  return entry?.notification ?? null;
}

/**
 * 服务端落库时的终止态推导（chat/route.ts 专用）。
 * 优先级：明确的中止原因 > hasError > result 携带的 terminal_reason > 正常完成。
 */
export function deriveServerOutcome(params: {
  abortReason: string | null;
  hasError: boolean;
  terminalReason?: string | null;
}): { outcome: TurnOutcome; effectiveReason: string | null } {
  const { abortReason, hasError, terminalReason } = params;
  const explicit = ['user_cancel', 'stalled', 'upstream_interrupted', 'tool_timeout', 'error'];
  if (abortReason && explicit.includes(abortReason)) {
    const entry = REASON_TABLE[abortReason];
    if (entry) return { outcome: entry.outcome, effectiveReason: abortReason };
  }
  if (hasError) return { outcome: 'upstream_error', effectiveReason: 'error' };
  if (terminalReason) {
    const entry = REASON_TABLE[terminalReason];
    if (entry) return { outcome: entry.outcome, effectiveReason: terminalReason };
    return { outcome: 'stopped', effectiveReason: terminalReason };
  }
  return { outcome: 'completed', effectiveReason: null };
}
