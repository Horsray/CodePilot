export interface SubAgentProgressTracker {
  touch: () => void;
  setStage: (stage: string) => void;
  close: () => void;
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

export function createSubAgentProgressTracker(options: {
  id: string;
  emitSSE?: (event: { type: string; data: string }) => void;
  initialStage: string;
  heartbeatMs?: number;
  sla?: {
    softMs: number;
    hardMs: number;
  };
}): SubAgentProgressTracker {
  const { id, emitSSE, initialStage, heartbeatMs = 15_000, sla } = options;
  let lastActivityAt = Date.now();
  let currentStage = initialStage;
  let softWarned = false;
  let hardWarned = false;

  const emit = (detail: string, append = true) => {
    emitSSE?.({
      type: 'subagent_progress',
      data: JSON.stringify({ id, detail, append }),
    });
  };

  emit(initialStage + '\n', true);

  const timer = emitSSE
    ? setInterval(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (sla && !hardWarned && idleMs >= sla.hardMs) {
          hardWarned = true;
          emit(`\n⚠️ SLA 超时：${currentStage}（已等待 ${formatSeconds(idleMs)}）\n`, true);
          return;
        }
        if (sla && !softWarned && idleMs >= sla.softMs) {
          softWarned = true;
          emit(`\n⏱️ SLA 预警：${currentStage}（已等待 ${formatSeconds(idleMs)}）\n`, true);
          return;
        }
        if (idleMs >= heartbeatMs) {
          emit(`\n...${currentStage}（已等待 ${formatSeconds(idleMs)}）\n`, true);
        }
      }, heartbeatMs)
    : null;

  const resetWarnings = () => {
    softWarned = false;
    hardWarned = false;
  };

  return {
    touch() {
      lastActivityAt = Date.now();
      resetWarnings();
    },
    setStage(stage: string) {
      if (stage === currentStage) {
        lastActivityAt = Date.now();
        return;
      }
      currentStage = stage;
      lastActivityAt = Date.now();
      resetWarnings();
      // Do not emit stage changes, as executeAgentTask will emit the actual progress
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
