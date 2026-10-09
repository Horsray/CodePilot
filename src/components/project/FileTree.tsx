"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { ArrowsClockwise, MagnifyingGlass, FileText, File, Image as ImageIcon, Copy, ClipboardText, Trash, PencilSimple, FolderOpen, Code, ChatCircleText, FolderPlus, Plus, TerminalWindow } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FileTreeNode } from "@/types";
import { getCachedRootFileTree, setCachedRootFileTree } from "@/lib/file-tree-cache";
import {
  FileTree as AIFileTree,
  FileTreeIcon,
  FileTreeName,
} from "@/components/ai-elements/file-tree";
import { Folder } from "@phosphor-icons/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePanelStore } from "@/store/usePanelStore";
import { useTerminal } from "@/hooks/useTerminal";
import { showToast } from "@/hooks/useToast";
import { openInFinder, openInTrae, pasteFile } from "@/lib/open-in-finder";
import { setFileClipboard, getFileClipboard, type FileClipboardEntry } from "@/lib/file-clipboard";

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
  highlightPath?: string;
  highlightSeek?: string;
}

// 中文注释：与 cc-haha 文件图标方案对齐 —— 三类图标（文本/终端脚本/图片）+ haha 配色；
// 文件夹图标保留本项目现有的 Phosphor Folder（见 FlatTreeNodeItem）。
function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case "ts":
    case "tsx":
      return <FileText size={14} className="text-blue-400" />;
    case "js":
    case "jsx":
      return <FileText size={14} className="text-yellow-400" />;
    case "py":
      return <FileText size={14} className="text-green-500" />;
    case "json":
      return <FileText size={14} className="text-yellow-500" />;
    case "md":
    case "mdx":
    case "txt":
      return <FileText size={14} className="text-gray-400" />;
    case "html":
    case "htm":
      return <FileText size={14} className="text-orange-400" />;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <FileText size={14} className="text-blue-300" />;
    case "vue":
      return <FileText size={14} className="text-green-400" />;
    case "rs":
      return <FileText size={14} className="text-orange-500" />;
    case "go":
      return <FileText size={14} className="text-cyan-400" />;
    case "java":
      return <FileText size={14} className="text-red-500" />;
    case "rb":
      return <FileText size={14} className="text-red-400" />;
    case "swift":
      return <FileText size={14} className="text-orange-400" />;
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "cs":
    case "zig":
      return <FileText size={14} className="text-yellow-400" />;
    case "yaml":
    case "yml":
    case "toml":
      return <FileText size={14} className="text-amber-400" />;
    case "sh":
    case "bash":
    case "zsh":
    case "command":
    case "fish":
    case "csh":
      return <TerminalWindow size={14} className="text-green-400" />;
    case "svg":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return <ImageIcon size={14} className="text-purple-400" />;
    case "lock":
    case "env":
    case "gitignore":
      return <FileText size={14} className="text-gray-500" />;
    default:
      return <FileText size={14} className="text-[var(--color-text-tertiary)]" />;
  }
}

interface FlatNode {
  node: FileTreeNode;
  level: number;
  isExpanded: boolean;
}

const EXECUTABLE_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "command", "fish", "csh",
  "py", "rb", "pl", "pm",
]);

function isExecutableFile(node: FileTreeNode): boolean {
  // 中文注释：与 cc-haha 对齐——只认脚本扩展名，不再把「无扩展名」一律当可执行
  if (node.type !== "file") return false;
  return !!node.extension && EXECUTABLE_EXTENSIONS.has(node.extension);
}

function FlatTreeNodeItem({
  flatNode,
  togglePath,
  selectedPath,
  onSelect,
  onAdd,
  highlightPath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onOpenInFinder,
  onOpenInTrae,
  onCopyFile,
  onPaste,
  hasClipboard,
  onAddToChat,
}: {
  flatNode: FlatNode;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  highlightPath?: string;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (path: string, isDirectory: boolean) => void;
  onDelete?: (path: string, isDirectory: boolean) => void;
  onCopyPath?: (path: string) => void;
  onOpenInFinder?: (path: string) => void;
  onOpenInTrae?: (path: string) => void;
  onCopyFile?: (path: string, isDirectory: boolean) => void;
  onPaste?: (destDir: string) => void;
  hasClipboard?: boolean;
  onAddToChat?: (path: string) => void;
}) {
  const { node, level, isExpanded } = flatNode;
  const isDirectory = node.type === "directory";
  const isSelected = selectedPath === node.path;
  const isHighlighted = highlightPath === node.path;
  const paddingLeft = level * 16 + 8; // 16px per level
  const executable = isExecutableFile(node);

  // 中文注释：打开/执行前先关闭文件树等右侧面板，再打开终端 —— 否则两个 flex-1 面板会同时渲染、
  // 上下平分卡片高度，把文件树挤到下方（与 QuickScriptMenu.runScript 的关闭逻辑对齐）。
  const closeOtherPanelsAndOpenTerminal = (store: ReturnType<typeof usePanelStore.getState>) => {
    store.setFileTreeOpen(false);
    store.setGitPanelOpen(false);
    store.setDashboardPanelOpen(false);
    store.setAssistantPanelOpen(false);
    store.setPreviewOpen(false);
    store.setBottomPanelTab("terminal");
    store.setBottomPanelOpen(true);
  };

  const handleOpenInTerminal = (targetPath: string) => {
    const store = usePanelStore.getState();
    closeOtherPanelsAndOpenTerminal(store);
    window.dispatchEvent(new CustomEvent('terminal:execute-command', { detail: { command: `cd "${targetPath}"` } }));
  };

  // 中文注释：对齐 cc-haha handleExecuteInTerminal——先 cd 到脚本所在目录再执行，保证运行 cwd 是项目路径
  const handleExecuteInTerminal = (targetPath: string) => {
    const store = usePanelStore.getState();
    closeOtherPanelsAndOpenTerminal(store);
    const dirPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
    window.dispatchEvent(new CustomEvent('terminal:execute-command', { detail: { command: `cd "${dirPath}" && "${targetPath}"` } }));
  };

  if (isDirectory) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-[3px] text-left text-[12px] transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
              isHighlighted && "file-tree-flash"
            )}
            style={{ paddingLeft }}
            role="button"
            tabIndex={0}
            id={isHighlighted ? "file-tree-highlight" : undefined}
            onClick={() => togglePath(node.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePath(node.path);
              }
            }}
          >
            {/* 文件夹图标同时作为展开/折叠按钮（保留本项目现有 Phosphor 文件夹图标） */}
            <FileTreeIcon>
              {isExpanded ? (
                <FolderOpen size={16} className="text-blue-400" weight="fill" />
              ) : (
                <Folder size={16} className="text-blue-400" weight="fill" />
              )}
            </FileTreeIcon>
            <FileTreeName className="min-w-0 flex-1">{node.name}</FileTreeName>
          </div>
        </ContextMenuTrigger>
        {/* 中文注释：目录右键菜单——项序/分隔/文案与 cc-haha FileTreePanel 对齐 */}
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onSelect?.(node.path)}>
            <FolderOpen size={14} className="mr-2" />
            <span>打开</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onNewFile?.(node.path)}>
            <Plus size={14} className="mr-2" />
            <span>新建文件</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onNewFolder?.(node.path)}>
            <FolderPlus size={14} className="mr-2" />
            <span>新建文件夹</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => handleOpenInTerminal(node.path)}>
            <TerminalWindow size={14} className="mr-2" />
            <span>在终端中打开</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/* 中文注释：复制=拷贝文件/目录供粘贴；粘贴=拷到当前目录 */}
          <ContextMenuItem onSelect={() => onCopyFile?.(node.path, true)}>
            <Copy size={14} className="mr-2" />
            <span>复制</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onPaste?.(node.path)} disabled={!hasClipboard}>
            <ClipboardText size={14} className="mr-2" />
            <span>粘贴</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onRename?.(node.path, true)}>
            <PencilSimple size={14} className="mr-2" />
            <span>重命名</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopyPath?.(node.path)}>
            <Copy size={14} className="mr-2" />
            <span>复制路径</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInFinder?.(node.path)}>
            <FolderOpen size={14} className="mr-2" />
            <span>在 Finder 中打开</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInTrae?.(node.path)}>
            <Code size={14} className="mr-2" />
            <span>在 Trae 中打开</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => onDelete?.(node.path, true)}
            className="text-red-600"
          >
            <Trash size={14} className="mr-2" />
            <span>删除</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group/file flex cursor-pointer items-center gap-1.5 rounded px-1 py-[3px] text-[12px] transition-colors",
            isSelected
              ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
            isHighlighted && "file-tree-flash"
          )}
          style={{ paddingLeft: paddingLeft + 24 }} // Align with folder text (CaretRight width)
          id={isHighlighted ? "file-tree-highlight" : undefined}
          onClick={() => onSelect?.(node.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(node.path);
            }
          }}
          role="treeitem"
          aria-selected={isSelected}
          tabIndex={0}
        >
          <FileTreeIcon>
            {getFileIcon(node.extension)}
          </FileTreeIcon>
          <FileTreeName className="min-w-0 flex-1">{node.name}</FileTreeName>
          {onAdd && (
            <button
              type="button"
              className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onAdd(node.path);
              }}
              title="Add to chat"
            >
              <Plus size={12} className="text-muted-foreground" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      {/* 中文注释：文件右键菜单——项序/分隔/文案与 cc-haha FileTreePanel 对齐 */}
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onSelect?.(node.path)}>
          <File size={14} className="mr-2" />
          <span>打开</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAddToChat?.(node.path)}>
          <ChatCircleText size={14} className="mr-2" />
          <span>添加到对话</span>
        </ContextMenuItem>
        {executable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => handleExecuteInTerminal(node.path)}>
              <TerminalWindow size={14} className="mr-2" />
              <span>在终端中运行</span>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        {/* 中文注释：复制=拷贝文件供粘贴；粘贴=拷到该文件所在目录 */}
        <ContextMenuItem onSelect={() => onCopyFile?.(node.path, false)}>
          <Copy size={14} className="mr-2" />
          <span>复制</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onPaste?.(node.path.substring(0, node.path.lastIndexOf('/')))}
          disabled={!hasClipboard}
        >
          <ClipboardText size={14} className="mr-2" />
          <span>粘贴</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onRename?.(node.path, false)}>
          <PencilSimple size={14} className="mr-2" />
          <span>重命名</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyPath?.(node.path)}>
          <Copy size={14} className="mr-2" />
          <span>复制路径</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenInFinder?.(node.path)}>
          <FolderOpen size={14} className="mr-2" />
          <span>在 Finder 中打开</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenInTrae?.(node.path)}>
          <Code size={14} className="mr-2" />
          <span>在 Trae 中打开</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onDelete?.(node.path, false)}
          className="text-red-600"
        >
          <Trash size={14} className="mr-2" />
          <span>删除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// localStorage key for storing expanded paths
const getExpandedPathsKey = (workingDirectory: string) =>
  `fileTree_expanded_${workingDirectory}`;

function getParentPaths(filePath: string): string[] {
  const parents: string[] = [];
  let current = filePath;
  while (true) {
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (!parent || parent === current) break;
    parents.push(parent);
    current = parent;
  }
  return parents;
}

export function FileTree({ workingDirectory, onFileSelect, onFileAdd, highlightPath, highlightSeek }: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const treeRef = useRef<FileTreeNode[]>([]);
  const mountedRef = useRef(false);
  const { t } = useTranslation();
  const seekKeyRef = useRef<string | null>(null);

  // Dialog states
  const [newItemDialog, setNewItemDialog] = useState<{
    open: boolean;
    type: "file" | "folder";
    parentPath: string;
    name: string;
  }>({ open: false, type: "file", parentPath: "", name: "" });
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    path: string;
    isDirectory: boolean;
    newName: string;
  }>({ open: false, path: "", isDirectory: false, newName: "" });
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    path: string;
    isDirectory: boolean;
  }>({ open: false, path: "", isDirectory: false });

  const fetchTree = useCallback(async () => {
    // Always cancel in-flight request first — even when clearing directory,
    // otherwise a stale response from the old project can arrive and repopulate the tree.
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!workingDirectory) {
      abortRef.current = null;
      setTree([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const cachedRoot = getCachedRootFileTree(workingDirectory);
    if (cachedRoot && treeRef.current.length === 0) {
      treeRef.current = cachedRoot;
      setTree(cachedRoot);
    }

    setLoading(!(cachedRoot && cachedRoot.length > 0));
    setError(null);
    try {
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=4&_t=${Date.now()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        const nextTree = (data.tree || []) as FileTreeNode[];
        treeRef.current = nextTree;
        setTree(nextTree);
        setCachedRootFileTree(workingDirectory, nextTree);
      } else {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        treeRef.current = [];
        setTree([]);
        setError(errData.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        if (mountedRef.current && abortRef.current === controller) {
          setLoading(false);
        }
        return;
      }
      treeRef.current = [];
      setTree([]);
      setError('Failed to load file tree');
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [workingDirectory]);

  // Handlers for context menu actions
  const handleNewFile = useCallback((parentPath: string) => {
    setNewItemDialog({ open: true, type: "file", parentPath, name: "" });
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setNewItemDialog({ open: true, type: "folder", parentPath, name: "" });
  }, []);

  const handleCreateItem = useCallback(async () => {
    if (!newItemDialog.name.trim()) return;
    const basePath = newItemDialog.parentPath || workingDirectory;
    const fullPath = `${basePath}/${newItemDialog.name}`;
    try {
      const res = await fetch("/api/files/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath, type: newItemDialog.type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
      showToast({ type: "success", message: newItemDialog.type === "file" ? "文件创建成功" : "文件夹创建成功" });
      setNewItemDialog({ open: false, type: "file", parentPath: "", name: "" });
      fetchTree();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "创建失败" });
    }
  }, [newItemDialog, workingDirectory, fetchTree]);

  const handleRename = useCallback((path: string, isDirectory: boolean) => {
    const name = path.split("/").pop() || "";
    setRenameDialog({ open: true, path, isDirectory, newName: name });
  }, []);

  const handleDoRename = useCallback(async () => {
    if (!renameDialog.newName.trim() || !renameDialog.path) return;
    try {
      const res = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: renameDialog.path, newName: renameDialog.newName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "重命名失败");
      }
      showToast({ type: "success", message: "重命名成功" });
      setRenameDialog({ open: false, path: "", isDirectory: false, newName: "" });
      fetchTree();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "重命名失败" });
    }
  }, [renameDialog, fetchTree]);

  const handleDelete = useCallback((path: string, isDirectory: boolean) => {
    setDeleteDialog({ open: true, path, isDirectory });
  }, []);

  const handleDoDelete = useCallback(async () => {
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: deleteDialog.path, recursive: deleteDialog.isDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除失败");
      }
      showToast({ type: "success", message: "删除成功" });
      setDeleteDialog({ open: false, path: "", isDirectory: false });
      fetchTree();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "删除失败" });
    }
  }, [deleteDialog, fetchTree]);

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      showToast({ type: "success", message: "路径已复制到剪贴板" });
    } catch {
      showToast({ type: "error", message: "复制失败" });
    }
  }, []);

  // 中文注释：必须走 reveal（open -R）定位到文件，不能用默认应用打开——否则 .md/.html 会被浏览器抢走
  const handleOpenInFinder = useCallback(async (path: string) => {
    try {
      await openInFinder(path);
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "在 Finder 中打开失败" });
    }
  }, []);

  const handleOpenInTrae = useCallback(async (path: string) => {
    try {
      await openInTrae(path);
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "在 Trae 中打开失败" });
    }
  }, []);

  // 文件树复制/粘贴剪贴板（与 EnhancedFileTree 共享 module 单例）
  const [fileClipboard, setFileClipboardState] = useState<FileClipboardEntry | null>(getFileClipboard());

  const handleCopyFile = useCallback((path: string, isDirectory: boolean) => {
    const entry = { path, isDirectory };
    setFileClipboard(entry);
    setFileClipboardState(entry);
    showToast({ type: "success", message: "已复制，右键目标文件夹粘贴" });
  }, []);

  const handlePaste = useCallback(async (destDir: string) => {
    const entry = getFileClipboard();
    if (!entry) {
      showToast({ type: "error", message: "剪贴板为空，请先复制文件" });
      return;
    }
    try {
      const newPath = await pasteFile(entry.path, destDir);
      showToast({ type: "success", message: "粘贴成功" });
      fetchTree();
      return newPath;
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : "粘贴失败" });
    }
  }, [fetchTree]);

  const handleAddToChat = useCallback((path: string) => {
    if (onFileAdd) {
      onFileAdd(path);
      showToast({ type: "success", message: "文件已添加到对话" });
    }
  }, [onFileAdd]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Clear stale tree data when switching projects to avoid cross-session seek races.
  useEffect(() => {
    setTree([]);
    setError(null);
    treeRef.current = [];
    seekKeyRef.current = null;
  }, [workingDirectory]);

  // Load expanded paths from localStorage when workingDirectory changes
  useEffect(() => {
    if (workingDirectory) {
      try {
        const key = getExpandedPathsKey(workingDirectory);
        const saved = localStorage.getItem(key);
        if (saved) {
          const paths = JSON.parse(saved);
          setExpandedPaths(new Set(paths));
        } else {
          // Default: all collapsed
          setExpandedPaths(new Set());
        }
      } catch {
        setExpandedPaths(new Set());
      }
    } else {
      setExpandedPaths(new Set());
    }
  }, [workingDirectory]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // Auto-refresh when AI finishes streaming
  useEffect(() => {
    const handler = () => fetchTree();
    window.addEventListener('refresh-file-tree', handler);
    return () => window.removeEventListener('refresh-file-tree', handler);
  }, [fetchTree]);

  // Handle expanded paths change
  const handleExpandedChange = useCallback((newExpanded: Set<string>) => {
    setExpandedPaths(newExpanded);
    // Save to localStorage
    if (workingDirectory) {
      try {
        const key = getExpandedPathsKey(workingDirectory);
        localStorage.setItem(key, JSON.stringify(Array.from(newExpanded)));
      } catch {
        // Ignore storage errors
      }
    }
  }, [workingDirectory]);

  // Handle single path toggle
  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      // Save to localStorage immediately
      if (workingDirectory) {
        try {
          const key = getExpandedPathsKey(workingDirectory);
          localStorage.setItem(key, JSON.stringify(Array.from(next)));
        } catch {}
      }
      return next;
    });
  }, [workingDirectory]);

  useEffect(() => {
    if (!highlightPath) return;
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const parent of getParentPaths(highlightPath)) {
        next.add(parent);
      }
      return next;
    });
  }, [highlightPath, highlightSeek]);

  // Compute flat nodes
  const flatNodes = useMemo(() => {
    function containsMatch(node: FileTreeNode, query: string): boolean {
      const q = query.toLowerCase();
      if (node.name.toLowerCase().includes(q)) return true;
      if (node.children) {
        return node.children.some((child) => containsMatch(child, query));
      }
      return false;
    }

    function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
      if (!query) return nodes;
      return nodes
        .filter((node) => containsMatch(node, query))
        .map((node) => ({
          ...node,
          children: node.children ? filterTree(node.children, query) : undefined,
        }));
    }

    const filtered = searchQuery ? filterTree(tree, searchQuery) : tree;

    function flatten(nodes: FileTreeNode[], level = 0): FlatNode[] {
      const result: FlatNode[] = [];
      for (const node of nodes) {
        const isExpanded = searchQuery ? true : expandedPaths.has(node.path);
        result.push({ node, level, isExpanded });
        if (node.type === "directory" && isExpanded && node.children) {
          result.push(...flatten(node.children, level + 1));
        }
      }
      return result;
    }

    return flatten(filtered);
  }, [tree, searchQuery, expandedPaths]);

  // Track selected path for UI highlighting
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
    onFileSelect(path);
  }, [onFileSelect]);

  // Scroll to and flash highlighted file from search results.
  // Guarded by seekKeyRef so tree auto-refreshes don't re-trigger the scroll.
  useEffect(() => {
    if (!workingDirectory || !highlightPath || tree.length === 0) return;
    const seekTargetKey = `${workingDirectory}::${highlightPath}::${highlightSeek || ''}`;
    if (seekKeyRef.current === seekTargetKey) return;

    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      const el = document.getElementById('file-tree-highlight');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        seekKeyRef.current = seekTargetKey;
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [workingDirectory, highlightPath, highlightSeek, tree]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部：标题 + 刷新/新建文件/新建文件夹（与 cc-haha FileTreePanel 对齐） */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {t('fileTree.sectionTitle')}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={t('fileTree.refresh')}
            title={t('fileTree.refresh')}
            onClick={() => void fetchTree()}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-all hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-95"
          >
            <ArrowsClockwise size={14} className={cn(loading && "animate-spin")} />
          </button>
          <button
            type="button"
            aria-label={t('fileTree.newFile')}
            title={t('fileTree.newFile')}
            onClick={() => handleNewFile('')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-all hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-95"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            aria-label={t('fileTree.newFolder')}
            title={t('fileTree.newFolder')}
            onClick={() => handleNewFolder('')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-all hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-95"
          >
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      {/* Search（cc-haha 样式：圆角边框盒 + 内嵌图标） */}
      <div className="shrink-0 px-3 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2 py-1">
          <MagnifyingGlass size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('fileTree.filterFiles')}
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-hidden">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <ArrowsClockwise size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {error ? error : workingDirectory ? t('fileTree.noFiles') : t('fileTree.selectFolder')}
          </p>
        ) : flatNodes.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            没有找到匹配的文件
          </p>
        ) : (
          <AIFileTree
            expanded={expandedPaths}
            onExpandedChange={handleExpandedChange}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onSelect={handleSelect as any}
            onAdd={onFileAdd}
            className="h-full rounded-none border-0 bg-transparent text-[12px] [&>div]:h-full [&>div]:min-h-0 [&>div]:p-0"
          >
            <Virtuoso
              style={{ height: '100%', width: '100%' }}
              data={flatNodes}
              itemContent={(_index: number, flatNode: any) => (
                <FlatTreeNodeItem
                  key={flatNode.node.path}
                  flatNode={flatNode}
                  togglePath={togglePath}
                  selectedPath={selectedPath}
                  onSelect={handleSelect}
                  onAdd={onFileAdd}
                  highlightPath={highlightPath}
                  onNewFile={handleNewFile}
                  onNewFolder={handleNewFolder}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onCopyPath={handleCopyPath}
                  onOpenInFinder={handleOpenInFinder}
                  onOpenInTrae={handleOpenInTrae}
                  onCopyFile={handleCopyFile}
                  onPaste={handlePaste}
                  hasClipboard={!!fileClipboard}
                  onAddToChat={handleAddToChat}
                />
              )}
            />
          </AIFileTree>
        )}
      </div>

      {/* 新建文件/文件夹对话框 */}
      <Dialog open={newItemDialog.open} onOpenChange={(open) => setNewItemDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newItemDialog.type === "file" ? "新建文件" : "新建文件夹"}</DialogTitle>
            <DialogDescription>
              在 {newItemDialog.parentPath || workingDirectory} 下创建
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={newItemDialog.type === "file" ? "文件名" : "文件夹名"}
            value={newItemDialog.name}
            onChange={(e) => setNewItemDialog((prev) => ({ ...prev, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleCreateItem()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewItemDialog({ open: false, type: "file", parentPath: "", name: "" })}>
              取消
            </Button>
            <Button size="sm" onClick={handleCreateItem} disabled={!newItemDialog.name.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameDialog.open} onOpenChange={(open) => setRenameDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription>
              {renameDialog.isDirectory ? "重命名文件夹" : "重命名文件"}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDialog.newName}
            onChange={(e) => setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleDoRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameDialog({ open: false, path: "", isDirectory: false, newName: "" })}>
              取消
            </Button>
            <Button size="sm" onClick={handleDoRename} disabled={!renameDialog.newName.trim()}>
              重命名
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {deleteDialog.isDirectory
                ? `确定要删除文件夹 "${deleteDialog.path.split("/").pop()}" 及其所有内容吗？此操作不可撤销。`
                : `确定要删除文件 "${deleteDialog.path.split("/").pop()}" 吗？此操作不可撤销。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteDialog({ open: false, path: "", isDirectory: false })}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDoDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
