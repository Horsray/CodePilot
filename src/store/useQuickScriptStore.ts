"use client";

import { create } from "zustand";

/**
 * 中文注释：快捷脚本（移植自 cc-haha quickScriptStore）——
 * name 是菜单显示名，path 是本机 shell 脚本绝对路径；
 * 点击后打开终端面板并执行 `bash "<path>"`。数据持久化在 localStorage。
 */
export type QuickScript = {
  id: string;
  name: string;
  path: string;
};

const STORAGE_KEY = "codepilot-quick-scripts";

// 中文注释：首次启动的预设快捷脚本（与 cc-haha 保持一致），用户可在弹窗内增删。
const DEFAULT_SCRIPTS: QuickScript[] = [
  { id: "plugin-test", name: "插件测试", path: "/Users/horsray/Documents/hueying-allcode/Ps-plugins/build-test.sh" },
  { id: "version-release", name: "版本发布", path: "/Users/horsray/Documents/hueying-allcode/Ps-plugins/启动桌面端.sh" },
];

function loadScripts(): QuickScript[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SCRIPTS;
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as QuickScript[]).filter(
        (s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.path === "string",
      );
    }
  } catch {
    // localStorage 不可用或数据损坏时回退预设
  }
  return DEFAULT_SCRIPTS;
}

function persist(scripts: QuickScript[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch {
    // 忽略持久化失败
  }
}

type QuickScriptStore = {
  scripts: QuickScript[];
  hydrated: boolean;
  hydrate: () => void;
  addScript: (name: string, path: string) => void;
  updateScript: (id: string, name: string, path: string) => void;
  removeScript: (id: string) => void;
};

export const useQuickScriptStore = create<QuickScriptStore>((set) => ({
  // 中文注释：SSR 阶段不读 localStorage（避免 hydration 不一致），挂载后由 hydrate() 补齐。
  scripts: [],
  hydrated: false,
  hydrate: () => set((s) => (s.hydrated ? s : { scripts: loadScripts(), hydrated: true })),
  addScript: (name, path) =>
    set((s) => {
      const next = [...s.scripts, { id: `qs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, path }];
      persist(next);
      return { scripts: next };
    }),
  updateScript: (id, name, path) =>
    set((s) => {
      const next = s.scripts.map((x) => (x.id === id ? { ...x, name, path } : x));
      persist(next);
      return { scripts: next };
    }),
  removeScript: (id) =>
    set((s) => {
      const next = s.scripts.filter((x) => x.id !== id);
      persist(next);
      return { scripts: next };
    }),
}));
