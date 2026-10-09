"use client";

/**
 * 中文注释：功能名称「交付折叠」的开关。
 *
 * 开启时（默认开启）：助手开始输出最终结论的那一刻，把前面的思考 + 工具调用过程
 * 平滑收起成一条汇总条，只交付结论；用户点汇总条可随时展开回看过程。
 * 关闭时：行为与以前完全一致，过程全程铺开。
 *
 * 与设置里的提示音选择同一套做法 —— 偏好存 localStorage，不改数据库 schema。
 * 这里额外用 useSyncExternalStore 做了一层订阅，让设置页里的开关能立刻影响
 * 已经挂在屏幕上的对话流，而不需要刷新应用。
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "codepilot.collapseProcessOnDeliver";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

export function getCollapseProcessOnDeliver(): boolean {
  if (cached !== null) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // 未设置过时默认开启
    cached = stored === null ? true : stored === "true";
  } catch {
    cached = true;
  }
  return cached;
}

export function setCollapseProcessOnDeliver(value: boolean): void {
  cached = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* noop —— 隐私模式下 localStorage 可能不可写，仅内存生效 */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 服务端渲染时按默认值（开启）输出，避免首帧闪烁。 */
function getServerSnapshot(): boolean {
  return true;
}

export function useProcessCollapseEnabled(): boolean {
  return useSyncExternalStore(subscribe, getCollapseProcessOnDeliver, getServerSnapshot);
}
