/**
 * runtime/index.ts — Initialize and register all agent runtimes.
 *
 * Import this module once at app startup to make runtimes available
 * via resolveRuntime().
 */

export type { AgentRuntime, RuntimeStreamOptions } from './types';
export { registerRuntime, getRuntime, getAllRuntimes, getAvailableRuntimes, resolveRuntime, predictNativeRuntime } from './registry';

import { registerRuntime } from './registry';
import { sdkRuntime } from './sdk-runtime';

// 中文注释：功能名称「单运行时注册」，用法是应用启动时只注册 Claude Code CLI，
// 不再把 Native / AI SDK 运行时挂进全局注册表，避免任何隐式回退。
registerRuntime(sdkRuntime);
