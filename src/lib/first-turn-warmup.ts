import type { PendingSessionMessage } from './pending-session-message';

export type FirstTurnWarmupState = 'idle' | 'warming' | 'ready' | 'failed';

// 中文注释：功能名称「首轮消息剩余等待时长」，用法是统一计算不同 warmup 状态下，
// 首条消息距离“应当放行”还需要等待多久，供 UI 定时器和放行判断共用。
// 预热只是后台优化，不能阻塞用户发送；未预热完成时由完整能力冷启动兜底。
export function getPendingFirstTurnRemainingDelayMs(
  pending: PendingSessionMessage | null,
  warmupState: FirstTurnWarmupState,
  now = Date.now(),
): number {
  return 0;
}

// 中文注释：功能名称「首轮消息是否可放行」，用法是根据 warmup 状态和排队时长，
// 判断当前挂起的首条消息是否应该立即发送。
export function shouldReleasePendingFirstTurn(
  pending: PendingSessionMessage | null,
  warmupState: FirstTurnWarmupState,
  now = Date.now(),
): boolean {
  return getPendingFirstTurnRemainingDelayMs(pending, warmupState, now) === 0;
}

// 中文注释：功能名称「首轮预热状态文案」，用法是在首条消息排队期间给用户一个明确的等待反馈，
// 避免表现为静默无响应。
export function getPendingFirstTurnStatusText(
  pending: PendingSessionMessage | null,
  warmupState: FirstTurnWarmupState,
  now = Date.now(),
): string | null {
  if (!pending) return null;
  return null;
}
