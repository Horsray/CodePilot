/**
 * runtime/registry.ts — Runtime registration and resolution.
 *
 * 产品已收口到单一路径：只允许 Claude Code CLI runtime。
 * 这里保留运行时注册表壳子，是为了尽量少改调用方接口，但所有解析结果
 * 都会收敛到 `claude-code-sdk`，不再给 Native / AI SDK 保留回退分支。
 */

import type { AgentRuntime } from './types';
const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return runtimes.get(id);
}

export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}

export function getAvailableRuntimes(): AgentRuntime[] {
  return getAllRuntimes().filter(r => r.isAvailable());
}

/**
 * Pick the runtime to use for a given request.
 *
 * 这里固定只返回 Claude Code CLI runtime。
 * 如果 CLI 不可用，直接抛错，让上层提示安装/连接，而不是悄悄回退到另一套执行链。
 */
export function resolveRuntime(_overrideId?: string, _providerId?: string): AgentRuntime {
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable()) return sdk;
  throw new Error('Claude Code CLI runtime is unavailable. Please install or reconnect Claude Code.');
}

/**
 * Predict whether the native runtime will be used for a given request.
 *
 * 产品主路径已移除 Native runtime，这里固定返回 false，
 * 让聊天入口、Bridge 和预热链路统一按 Claude Code CLI 方式准备资源。
 */
export function predictNativeRuntime(_providerId?: string): boolean {
  return false;
}
