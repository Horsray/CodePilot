import { EventEmitter } from 'events';
import { createBackgroundJob, updateBackgroundJob, getBackgroundJob } from './db';
import type { BackgroundJob } from '@/types';

/**
 * BackgroundJobManager handles the signaling and status tracking for tools
 * that have been moved to the background.
 */
class BackgroundJobManager extends EventEmitter {
  /**
   * Signal that a tool call should be moved to the background.
   * @param sessionId The session ID
   * @param toolCallId The tool call ID (from AI SDK)
   */
  signalBackground(sessionId: string, toolCallId: string) {
    console.log(`[background-job] Signaling background for session ${sessionId}, toolCallId ${toolCallId}`);
    this.emit(`background:${sessionId}:${toolCallId}`);
  }

  /**
   * Register a new background job in the database.
   */
  registerJob(sessionId: string, toolCallId: string, toolName: string, toolInput: any) {
    return createBackgroundJob({
      id: `${sessionId}:${toolCallId}`,
      sessionId,
      toolName,
      toolInput: JSON.stringify(toolInput),
    });
  }

  /**
   * Update a background job's status and output.
   */
  completeJob(sessionId: string, toolCallId: string, output: string) {
    updateBackgroundJob(`${sessionId}:${toolCallId}`, {
      status: 'completed',
      output,
    });
  }

  /**
   * Mark a background job as failed.
   */
  failJob(sessionId: string, toolCallId: string, error: string) {
    updateBackgroundJob(`${sessionId}:${toolCallId}`, {
      status: 'failed',
      error,
    });
  }

  /**
   * Mark a background job as timed out.
   */
  timeoutJob(sessionId: string, toolCallId: string) {
    updateBackgroundJob(`${sessionId}:${toolCallId}`, {
      status: 'timeout',
    });
  }
}

export const backgroundJobManager = new BackgroundJobManager();

// 中文注释：后台任务管理器，用于处理从 UI 触发的“转入后台”信号，并追踪任务的最终执行结果。
// 用法：在 tool execute 中监听 backgroundJobManager 的事件，如果收到信号则立即返回占位结果，
// 同时在后台继续执行并更新数据库状态。
