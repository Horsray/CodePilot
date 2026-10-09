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
  let stageStartedAt = Date.now();
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
        // Use stageStartedAt instead of lastActivityAt to accurately track how long
        // the agent has been stuck in the CURRENT stage (e.g. waiting for tool execution).
        // This prevents keep_alive events from resetting the wait timer.
        const stageIdleMs = Date.now() - stageStartedAt;
        
        if (sla && !hardWarned && stageIdleMs >= sla.hardMs) {
          hardWarned = true;
          emit(`\n⚠️ SLA 超时：${currentStage}（已等待 ${formatSeconds(stageIdleMs)}）\n`, true);
          return;
        }
        if (sla && !softWarned && stageIdleMs >= sla.softMs) {
          softWarned = true;
          emit(`\n⏱️ SLA 预警：${currentStage}（已等待 ${formatSeconds(stageIdleMs)}）\n`, true);
          return;
        }
        if (stageIdleMs >= heartbeatMs) {
          emit(`\n...${currentStage}（已等待 ${formatSeconds(stageIdleMs)}）\n`, true);
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
      // We don't reset stageStartedAt here, so the wait time for the current stage keeps accumulating
    },
    setStage(stage: string) {
      if (stage === currentStage) {
        lastActivityAt = Date.now();
        return;
      }
      currentStage = stage;
      lastActivityAt = Date.now();
      stageStartedAt = Date.now(); // Reset stage timer when stage actually changes
      resetWarnings();
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
