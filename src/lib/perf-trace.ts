import crypto from 'crypto';

export interface PerfTraceEvent {
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  detail?: Record<string, unknown>;
}

export interface PerfTraceSnapshot {
  id: string;
  label: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs: number;
  events: PerfTraceEvent[];
  metadata?: Record<string, unknown>;
}

const BUFFER_SIZE = 50;
const GLOBAL_KEY = '__codepilot_perf_traces__' as const;

interface PerfTraceState {
  traces: PerfTraceSnapshot[];
}

function getState(): PerfTraceState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { traces: [] as PerfTraceSnapshot[] };
  }
  return g[GLOBAL_KEY] as PerfTraceState;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function pushTrace(trace: PerfTraceSnapshot): void {
  const state = getState();
  state.traces.push(trace);
  if (state.traces.length > BUFFER_SIZE) {
    state.traces.splice(0, state.traces.length - BUFFER_SIZE);
  }
}

export function createPerfTraceId(prefix = 'trace'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createPerfTrace(
  label: string,
  options?: {
    id?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const id = options?.id || createPerfTraceId(label);
  const traceStart = now();
  const startedAt = new Date().toISOString();
  const marks = new Map<string, number>();
  const events: PerfTraceEvent[] = [];

  // 中文注释：记录一个性能阶段的开始时间，配合 end 使用。
  function start(name: string): void {
    marks.set(name, now());
  }

  // 中文注释：结束一个性能阶段并写入耗时明细，可附带额外上下文。
  function end(name: string, detail?: Record<string, unknown>): PerfTraceEvent | null {
    const startTime = marks.get(name);
    if (startTime === undefined) return null;
    const endTime = now();
    const event: PerfTraceEvent = {
      name,
      startTime,
      endTime,
      durationMs: Number((endTime - startTime).toFixed(2)),
      ...(detail ? { detail } : {}),
    };
    events.push(event);
    marks.delete(name);
    return event;
  }

  // 中文注释：为同步逻辑包裹性能测量，统一产出阶段耗时。
  function measure<T>(name: string, fn: () => T, detail?: Record<string, unknown>): T {
    start(name);
    try {
      return fn();
    } finally {
      end(name, detail);
    }
  }

  // 中文注释：为异步逻辑包裹性能测量，适合接口、初始化、I/O 等阶段。
  async function measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    detail?: Record<string, unknown>,
  ): Promise<T> {
    start(name);
    try {
      return await fn();
    } finally {
      end(name, detail);
    }
  }

  // 中文注释：记录一个零耗时事件，用于补充阶段性说明。
  function annotate(name: string, detail?: Record<string, unknown>): void {
    const at = now();
    events.push({
      name,
      startTime: at,
      endTime: at,
      durationMs: 0,
      ...(detail ? { detail } : {}),
    });
  }

  // 中文注释：生成可序列化快照，用于 SSE、日志或调试接口。
  function snapshot(extra?: { ended?: boolean; metadata?: Record<string, unknown> }): PerfTraceSnapshot {
    const totalDurationMs = Number((now() - traceStart).toFixed(2));
    return {
      id,
      label,
      startedAt,
      ...(extra?.ended ? { endedAt: new Date().toISOString() } : {}),
      totalDurationMs,
      events: [...events],
      metadata: {
        ...(options?.metadata || {}),
        ...(extra?.metadata || {}),
      },
    };
  }

  // 中文注释：结束追踪并写入全局环形缓冲，便于后续回看最近请求。
  function finish(metadata?: Record<string, unknown>): PerfTraceSnapshot {
    const trace = snapshot({ ended: true, metadata });
    pushTrace(trace);
    return trace;
  }

  return {
    id,
    start,
    end,
    measure,
    measureAsync,
    annotate,
    snapshot,
    finish,
  };
}

export function getRecentPerfTraces(limit = 20): PerfTraceSnapshot[] {
  const traces = getState().traces;
  return traces.slice(Math.max(0, traces.length - limit));
}
