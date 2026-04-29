import type { PendingSessionMessage } from './pending-session-message';

export type FirstTurnWarmupState = 'idle' | 'warming' | 'ready' | 'failed';

// 中文注释：功能名称「首轮预热空闲兜底窗口」，用法是在新会话刚跳转到会话页、预热请求
// 还未来得及把状态切到 warming 时，仅短暂等待一小段时间；超时后直接放行首条消息，
// 避免用户误以为“发送后没反应”。
export const FIRST_TURN_WARMUP_IDLE_GRACE_MS = 1_200;

// 中文注释：功能名称「首轮预热等待时长」，用法是为新会话首条消息预留一个可接受的等待窗口，
// 优先复用 warmup 结果；超过窗口后自动直发，避免用户看到“没反应”。
export const FIRST_TURN_WARMUP_TIMEOUT_MS = 8_000;

// 中文注释：功能名称「首轮消息剩余等待时长」，用法是统一计算不同 warmup 状态下，
// 首条消息距离“应当放行”还需要等待多久，供 UI 定时器和放行判断共用。
export function getPendingFirstTurnRemainingDelayMs(
  pending: PendingSessionMessage | null,
  warmupState: FirstTurnWarmupState,
  now = Date.now(),
): number {
  if (!pending) return 0;
  if (warmupState === 'ready' || warmupState === 'failed') return 0;

  const elapsedMs = now - pending.createdAt;
  if (warmupState === 'idle') {
    return Math.max(0, FIRST_TURN_WARMUP_IDLE_GRACE_MS - elapsedMs);
  }

  return Math.max(0, FIRST_TURN_WARMUP_TIMEOUT_MS - elapsedMs);
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
  if (warmupState === 'ready') return 'Claude Code 已就绪，正在发送首条消息...';
  if (warmupState === 'failed') return '预热较慢，已直接发送首条消息...';

  const remainingDelayMs = getPendingFirstTurnRemainingDelayMs(pending, warmupState, now);
  if (remainingDelayMs === 0) {
    return '正在直接发送首条消息...';
  }

  if (warmupState === 'idle') {
    return '正在建立新会话...';
  }

  return '正在准备 Claude Code 环境...';
}
