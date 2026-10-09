/**
 * 中文注释：全局统一的「在 Finder/资源管理器 中打开」与「在编辑器 中打开」工具函数。
 * 对齐 cc-haha `desktop/src/lib/openInFinder.ts`：走后端 reveal/open-in-editor，
 * 而不是 `open path`（那会用默认应用打开，文件就被浏览器抢走了）。
 */

/** 在系统文件管理器中显示并选中该路径（macOS: open -R / Windows: explorer /select, / Linux: 打开父目录） */
export async function openInFinder(path: string): Promise<void> {
  if (!path) return;
  const res = await fetch("/api/utils/open-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, reveal: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(data.error || "在文件管理器中打开失败");
  }
}

/** 在 Trae（国际版）中打开，与 cc-haha「在 Trae 中打开」对齐 */
export async function openInTrae(path: string): Promise<void> {
  if (!path) return;
  const res = await fetch("/api/utils/open-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, editor: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(data.error || "在 Trae 中打开失败");
  }
}

/** 复制文件/目录到目标目录（文件树右键「粘贴」） */
export async function pasteFile(sourcePath: string, destDir: string): Promise<string> {
  const res = await fetch("/api/files/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath, destDir }),
  });
  const data = await res.json().catch(() => ({} as { path?: string; error?: string }));
  if (!res.ok) {
    throw new Error(data.error || "粘贴失败");
  }
  return data.path as string;
}
