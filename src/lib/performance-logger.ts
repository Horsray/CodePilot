/**
 * Performance Logger - 毫秒级性能追踪系统
 * 用于全面分析从用户输入到AI响应的整个链路性能
 */

export interface PerformanceMarker {
  name: string;
  timestamp: number;
  delta: number; // 距上一个marker的耗时
  total: number; // 距第一个marker的累计耗时
}

export interface PerformanceReport {
  markers: PerformanceMarker[];
  summary: {
    totalDuration: number;
    bottleneckMarker: PerformanceMarker | null;
    bottleneckScore: number; // 瓶颈占比百分比
  };
  metadata: Record<string, unknown>;
}

// 全局性能追踪器实例
class PerformanceTracker {
  private markers: Map<string, PerformanceMarker> = new Map();
  private startTime: number = 0;
  private lastMarker: string = '';
  private enabled: boolean = true;
  private sessionId: string = '';

  /**
   * 初始化追踪器
   */
  init(label?: string): void {
    this.markers.clear();
    this.startTime = performance.now();
    this.lastMarker = '';
    this.sessionId = label || `perf-${Date.now()}`;
    this.enabled = true;

    if (typeof window !== 'undefined') {
      console.log(`%c[PERF] 🚀 Performance tracking started: ${this.sessionId}`, 'color: #4CAF50; font-weight: bold');
    }
  }

  /**
   * 记录一个性能标记点
   */
  mark(name: string, metadata?: Record<string, unknown>): PerformanceMarker {
    if (!this.enabled) {
      return { name, timestamp: 0, delta: 0, total: 0 };
    }

    const now = performance.now();
    const total = now - this.startTime;
    const lastTime = this.lastMarker ? this.markers.get(this.lastMarker)?.timestamp || this.startTime : this.startTime;
    const delta = now - lastTime;

    const marker: PerformanceMarker = {
      name,
      timestamp: now,
      delta,
      total,
    };

    this.markers.set(name, marker);
    this.lastMarker = name;

    // 输出格式化日志
    this.logMarker(marker, metadata);

    return marker;
  }

  /**
   * 记录异步操作的开始
   */
  markAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    this.mark(`${name}_start`, metadata);
    const start = performance.now();

    return fn().finally(() => {
      const duration = performance.now() - start;
      this.mark(`${name}_end`, { ...metadata, duration });
    });
  }

  /**
   * 输出带样式的标记点日志
   */
  private logMarker(marker: PerformanceMarker, metadata?: Record<string, unknown>): void {
    if (typeof window === 'undefined') {
      // Node.js 环境
      const deltaStr = marker.delta.toFixed(2).padStart(8);
      const totalStr = marker.total.toFixed(2).padStart(8);
      console.log(`[PERF] ${totalStr}ms | +${deltaStr}ms | ${marker.name}`, metadata || '');
      return;
    }

    // 浏览器环境 - 使用彩色样式
    const deltaColor = marker.delta > 100 ? '#f44336' : marker.delta > 50 ? '#ff9800' : '#4CAF50';
    const totalStr = marker.total.toFixed(2).padStart(8);
    const deltaStr = marker.delta.toFixed(2).padStart(8);

    console.log(
      `%c[PERF] ${totalStr}ms | %c+${deltaStr}ms%c | ${marker.name}`,
      'color: #9e9e9e',
      `color: ${deltaColor}; font-weight: bold`,
      'color: inherit',
      metadata || ''
    );
  }

  /**
   * 获取完整报告
   */
  getReport(metadata?: Record<string, unknown>): PerformanceReport {
    const markersArray = Array.from(this.markers.values());
    const totalDuration = markersArray.length > 0
      ? markersArray[markersArray.length - 1].total
      : 0;

    // 找出瓶颈点（delta最大的标记）
    let bottleneckMarker: PerformanceMarker | null = null;
    let maxDelta = 0;
    for (const marker of markersArray) {
      if (marker.delta > maxDelta) {
        maxDelta = marker.delta;
        bottleneckMarker = marker;
      }
    }

    return {
      markers: markersArray,
      summary: {
        totalDuration,
        bottleneckMarker,
        bottleneckScore: totalDuration > 0 ? (maxDelta / totalDuration) * 100 : 0,
      },
      metadata: metadata || {},
    };
  }

  /**
   * 打印简洁报告到控制台
   */
  printReport(label?: string): void {
    const report = this.getReport();

    console.log(`\n%c═══ Performance Report: ${label || this.sessionId} ═══`, 'color: #2196F3; font-weight: bold; font-size: 14px');
    console.log(`%cTotal Duration: ${report.summary.totalDuration.toFixed(2)}ms`, 'color: #333; font-weight: bold');

    if (report.summary.bottleneckMarker) {
      console.log(
        `%cBottleneck: ${report.summary.bottleneckMarker.name} ` +
        `(+${report.summary.bottleneckMarker.delta.toFixed(2)}ms, ${report.summary.bottleneckScore.toFixed(1)}%)`,
        'color: #f44336; font-weight: bold'
      );
    }

    console.log('\n%cAll Markers:', 'color: #666; font-weight: bold');
    for (const marker of report.markers) {
      const deltaColor = marker.delta > 100 ? '#f44336' : marker.delta > 50 ? '#ff9800' : '#4CAF50';
      const bar = '█'.repeat(Math.min(Math.floor(marker.delta / 5), 50));
      console.log(
        `%c  +${marker.delta.toFixed(2).padStart(8)}ms%c | ${marker.name}`,
        `color: ${deltaColor}`,
        'color: #333'
      );
    }
    console.log('%c═══════════════════════════════════════\n', 'color: #2196F3');
  }

  /**
   * 导出JSON格式报告（供分析工具使用）
   */
  exportJSON(): string {
    return JSON.stringify(this.getReport(), null, 2);
  }

  /**
   * 禁用追踪
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 启用追踪
   */
  enable(): void {
    this.enabled = true;
  }
}

// 导出单例
export const perf = new PerformanceTracker();

// 前端便捷函数：在组件中使用
export function usePerformanceTracker() {
  return perf;
}

// 后端便捷函数
export function createPerformanceTracker(label?: string) {
  const tracker = new PerformanceTracker();
  tracker.init(label);
  return tracker;
}
