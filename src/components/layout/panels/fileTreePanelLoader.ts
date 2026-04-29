"use client";

import type { ComponentType } from "react";

type FileTreePanelModule = typeof import("./FileTreePanel");

// 中文注释：功能名称「文件树面板预加载器」，用法是在真正点击文件树前提前拉取对应 chunk，
// 消除首次打开面板时因动态导入带来的长时间无响应。
const loadFileTreePanelModule = () =>
  import("./FileTreePanel") as Promise<FileTreePanelModule>;

export const loadFileTreePanel = async (): Promise<{ default: ComponentType }> => {
  const mod = await loadFileTreePanelModule();
  return { default: mod.FileTreePanel as ComponentType };
};

export function preloadFileTreePanel() {
  void loadFileTreePanelModule();
}
