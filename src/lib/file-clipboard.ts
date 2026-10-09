/**
 * 中文注释：文件树「复制 / 粘贴」内部剪贴板。
 * 只记录一次复制的源路径；粘贴由 /api/files/paste 完成实际拷贝。
 * 用模块级单例，让 FileTree 与 EnhancedFileTree 共享同一份剪贴板。
 */

export interface FileClipboardEntry {
  path: string;
  isDirectory: boolean;
}

let clipboardEntry: FileClipboardEntry | null = null;

export function setFileClipboard(entry: FileClipboardEntry | null): void {
  clipboardEntry = entry;
}

export function getFileClipboard(): FileClipboardEntry | null {
  return clipboardEntry;
}

export function clearFileClipboard(): void {
  clipboardEntry = null;
}
