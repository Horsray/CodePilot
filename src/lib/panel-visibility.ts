/**
 * 「右侧面板是否可见」的唯一判定来源。
 *
 * 这个布尔值同时决定两件事，而这两件事必须永远一致：
 * 1) `PanelZone` 里右侧卡片的显隐与宽度动画（anyOpen）；
 * 2) `UnifiedTopBar` 里「面板切换按钮放顶栏还是让位给面板头」。
 *
 * 从 cc-haha 移植时这两处各写了一份 `||` 串联判断，顶栏那份漏了 browserPanelOpen，
 * 于是打开浏览器面板时顶栏按钮不让位 —— 顶栏与面板卡片头同时渲染，屏幕上出现
 * 两排各 5 个切换图标。抽出单一来源后，参数是 Required 形状，任何一方漏传标志
 * 都会在编译期直接报错，而不是变成一次静默的 UI 重复。
 */
export interface PanelVisibilityFlags {
  previewOpen: boolean;
  previewFile: string | null;
  gitPanelOpen: boolean;
  fileTreeOpen: boolean;
  dashboardPanelOpen: boolean;
  assistantPanelOpen: boolean;
  bottomPanelOpen: boolean;
  browserPanelOpen: boolean;
}

export function isRightPanelOpen(flags: PanelVisibilityFlags): boolean {
  return (
    flags.gitPanelOpen ||
    flags.fileTreeOpen ||
    flags.dashboardPanelOpen ||
    flags.bottomPanelOpen ||
    flags.assistantPanelOpen ||
    flags.browserPanelOpen ||
    (flags.previewOpen && !!flags.previewFile)
  );
}
