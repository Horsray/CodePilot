"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  Image as ImageIcon,
  FileZip,
  Plus,
  FolderPlus,
  MagnifyingGlass,
  ArrowsClockwise,
  Copy,
  Trash,
  PencilSimple,
  ArrowSquareOut,
  ChatCircleText,
  Play,
  TerminalWindow,
} from "@/components/ui/icon";
import { usePanelStore } from "@/store/usePanelStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import type { FileTreeNode } from "@/types";
import { getCachedRootFileTree, setCachedRootFileTree } from "@/lib/file-tree-cache";
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

interface EnhancedFileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
  highlightPath?: string;
  highlightSeek?: string;
  topSlot?: ReactNode;
}

// 文件图标映射
const getFileIcon = (name: string, isDirectory: boolean, isOpen?: boolean) => {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconClass = "shrink-0";
  const size = 16;

  // 文件夹
  if (isDirectory) {
    return isOpen ? (
      <FolderOpen size={size} className={cn(iconClass, "text-blue-400")} weight="fill" />
    ) : (
      <Folder size={size} className={cn(iconClass, "text-blue-400")} weight="fill" />
    );
  }

  // 根据扩展名返回对应图标
  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode size={size} className={cn(iconClass, "text-blue-500")} />;
    case "js":
    case "jsx":
      return <FileCode size={size} className={cn(iconClass, "text-yellow-400")} />;
    case "vue":
      return <FileCode size={size} className={cn(iconClass, "text-green-500")} />;
    case "py":
      return <FileCode size={size} className={cn(iconClass, "text-blue-600")} />;
    case "php":
      return <FileCode size={size} className={cn(iconClass, "text-purple-500")} />;
    case "html":
    case "htm":
      return <FileCode size={size} className={cn(iconClass, "text-orange-500")} />;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <FileCode size={size} className={cn(iconClass, "text-blue-400")} />;
    case "json":
      return <FileCode size={size} className={cn(iconClass, "text-yellow-500")} />;
    case "csv":
      return <File size={size} className={cn(iconClass, "text-green-600")} />;
    case "sql":
      return <FileCode size={size} className={cn(iconClass, "text-gray-500")} />;
    case "md":
    case "mdx":
      return <File size={size} className={cn(iconClass, "text-gray-400")} />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "svg":
    case "webp":
      return <ImageIcon size={size} className={cn(iconClass, "text-purple-400")} />;
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return <File size={size} className={cn(iconClass, "text-pink-400")} />;
    case "mp4":
    case "avi":
    case "mov":
    case "mkv":
      return <Play size={size} className={cn(iconClass, "text-red-400")} />;
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return <FileZip size={size} className={cn(iconClass, "text-yellow-600")} />;
    case "pdf":
      return <File size={size} className={cn(iconClass, "text-red-500")} />;
    case "doc":
    case "docx":
      return <File size={size} className={cn(iconClass, "text-blue-600")} />;
    case "xls":
    case "xlsx":
      return <File size={size} className={cn(iconClass, "text-green-600")} />;
    case "ppt":
    case "pptx":
      return <File size={size} className={cn(iconClass, "text-orange-500")} />;
    case "rs":
      return <FileCode size={size} className={cn(iconClass, "text-orange-600")} />;
    case "go":
      return <FileCode size={size} className={cn(iconClass, "text-cyan-500")} />;
    case "java":
      return <FileCode size={size} className={cn(iconClass, "text-red-600")} />;
    case "rb":
      return <FileCode size={size} className={cn(iconClass, "text-red-500")} />;
    case "swift":
      return <FileCode size={size} className={cn(iconClass, "text-orange-500")} />;
    case "kt":
      return <FileCode size={size} className={cn(iconClass, "text-purple-500")} />;
    case "dart":
      return <FileCode size={size} className={cn(iconClass, "text-cyan-400")} />;
    case "lua":
      return <FileCode size={size} className={cn(iconClass, "text-blue-500")} />;
    case "zig":
      return <FileCode size={size} className={cn(iconClass, "text-yellow-500")} />;
    default:
      return <File size={size} className={cn(iconClass, "text-gray-400")} />;
  }
};

// 可执行文件扩展名
const EXECUTABLE_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "command", "fish", "csh",
  "py", "rb", "pl", "pm",
]);

function isExecutableFile(node: FileTreeNode): boolean {
  if (node.type !== "file") return false;
  if (node.extension && EXECUTABLE_EXTENSIONS.has(node.extension)) return true;
  if (!node.extension) return true;
  return false;
}

// 扁平化节点类型
interface FlatNode {
  node: FileTreeNode;
  level: number;
  isExpanded: boolean;
}

type CacheEntry<T> = { value: T; ts: number };

const FILE_TREE_CACHE_TTL_MS = 30_000;
const directoryChildrenCache = new Map<string, CacheEntry<FileTreeNode[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > FILE_TREE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, ts: Date.now() });
}

// 树节点组件
interface TreeNodeProps {
  flatNode: FlatNode;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string, isDirectory: boolean) => void;
  onDelete: (path: string, isDirectory: boolean) => void;
  onCopyPath: (path: string) => void;
  onOpenInFinder: (path: string) => void;
  onAddToChat: (path: string) => void;
  isLoading?: boolean;
  isHighlighted?: boolean;
}

function TreeNode({
  flatNode,
  onToggle,
  onSelect,
  selectedPath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onOpenInFinder,
  onAddToChat,
  isLoading,
  isHighlighted,
}: TreeNodeProps) {
  const { node, level, isExpanded } = flatNode;
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === "directory";
  const paddingLeft = level * 12 + 8;
  const executable = isExecutableFile(node);

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleOpenInTerminal = (targetPath: string) => {
    const store = usePanelStore.getState();
    store.setBottomPanelOpen(true);
    store.setBottomPanelTab("terminal");
    window.dispatchEvent(new CustomEvent('terminal:execute-command', { detail: { command: `cd "${targetPath}"` } }));
  };

  const handleExecuteInTerminal = (targetPath: string) => {
    const store = usePanelStore.getState();
    store.setBottomPanelOpen(true);
    store.setBottomPanelTab("terminal");
    window.dispatchEvent(new CustomEvent('terminal:execute-command', { detail: { command: `"${targetPath}"` } }));
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={handleClick}
            style={{ paddingLeft }}
            className={cn(
              "flex items-center gap-1.5 py-1 pr-2 text-[13px] cursor-pointer select-none",
              "hover:bg-accent/50 transition-colors",
              isSelected && "bg-accent text-accent-foreground",
              isHighlighted && "file-tree-flash"
            )}
            id={isHighlighted ? "file-tree-highlight" : undefined}
          >
            {/* 文件夹图标同时作为展开/折叠按钮 */}
            {isDirectory ? (
              isExpanded ? (
                <FolderOpen size={16} className="shrink-0 text-blue-400" weight="fill" />
              ) : (
                <Folder size={16} className="shrink-0 text-blue-400" weight="fill" />
              )
            ) : (
              getFileIcon(node.name, isDirectory, isExpanded)
            )}

            {/* 文件名 */}
            <span className="truncate flex-1">{node.name}</span>
            {isDirectory && isExpanded && isLoading ? (
              <ArrowsClockwise size={13} className="shrink-0 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-48">
          {isDirectory ? (
            <>
              <ContextMenuItem onSelect={() => onSelect(node.path)}>
                <FolderOpen size={14} className="mr-2" />
                打开文件夹
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onNewFile(node.path)}>
                <Plus size={14} className="mr-2" />
                新建文件
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onNewFolder(node.path)}>
                <FolderPlus size={14} className="mr-2" />
                新建文件夹
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => handleOpenInTerminal(node.path)}>
                <TerminalWindow size={14} className="mr-2" />
                在终端中打开
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => onSelect(node.path)}>
                <File size={14} className="mr-2" />
                打开文件
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onAddToChat(node.path)}>
                <ChatCircleText size={14} className="mr-2" />
                添加到对话
              </ContextMenuItem>
              <ContextMenuSeparator />
              {executable && (
                <>
                  <ContextMenuItem onSelect={() => handleExecuteInTerminal(node.path)}>
                    <TerminalWindow size={14} className="mr-2" />
                    在终端中执行
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
            </>
          )}
          <ContextMenuItem onSelect={() => onRename(node.path, isDirectory)}>
            <PencilSimple size={14} className="mr-2" />
            重命名
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopyPath(node.path)}>
            <Copy size={14} className="mr-2" />
            复制路径
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInFinder(node.path)}>
            <ArrowSquareOut size={14} className="mr-2" />
            在 Finder 中打开
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onDelete(node.path, isDirectory)}
            className="text-red-600"
          >
            <Trash size={14} className="mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

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

export function EnhancedFileTree({ workingDirectory, onFileSelect, onFileAdd, highlightPath, highlightSeek, topSlot }: EnhancedFileTreeProps) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const seekKeyRef = useRef<string | null>(null);
  const treeRef = useRef<FileTreeNode[]>([]);
  const expandedRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());
  // 中文注释：用于渲染“目录展开加载中”的占位状态，避免用户误以为点击无响应。
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());

  // 新建文件/文件夹对话框状态
  const [newItemDialog, setNewItemDialog] = useState<{
    open: boolean;
    type: "file" | "folder";
    parentPath: string;
    name: string;
  }>({ open: false, type: "file", parentPath: "", name: "" });

  // 重命名对话框状态
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    path: string;
    isDirectory: boolean;
    newName: string;
  }>({ open: false, path: "", isDirectory: false, newName: "" });

  // 删除确认对话框状态
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    path: string;
    isDirectory: boolean;
  }>({ open: false, path: "", isDirectory: false });

  // 保存展开状态到 localStorage
  const saveExpandedState = useCallback((expandedSet: Set<string>) => {
    if (!workingDirectory) return;
    const key = `codepilot:file-tree:expanded:${workingDirectory}`;
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(expandedSet)));
    } catch {
      // 忽略存储错误
    }
  }, [workingDirectory]);

  // 从 localStorage 加载展开状态
  const loadExpandedState = useCallback((): Set<string> => {
    if (!workingDirectory) return new Set();
    const key = `codepilot:file-tree:expanded:${workingDirectory}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch {
      // 忽略解析错误
    }
    return new Set();
  }, [workingDirectory]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const updateTreeChildren = useCallback((nodes: FileTreeNode[], targetPath: string, children: FileTreeNode[]): FileTreeNode[] => {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.path === targetPath) {
        if (node.type !== "directory") return node;
        changed = true;
        return { ...node, children };
      }
      if (node.type === "directory" && node.children) {
        const updatedChildren = updateTreeChildren(node.children, targetPath, children);
        if (updatedChildren !== node.children) {
          changed = true;
          return { ...node, children: updatedChildren };
        }
      }
      return node;
    });
    return changed ? next : nodes;
  }, []);

  const findNode = useCallback((nodes: FileTreeNode[], targetPath: string): FileTreeNode | null => {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.type === "directory" && node.children) {
        const found = findNode(node.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const ensureDirectoryChildrenLoaded = useCallback(
    async (dirPath: string, signal?: AbortSignal) => {
      if (!workingDirectory) return;

      const cached = getCached(directoryChildrenCache, dirPath);
      if (cached) {
        setTree((prev) => {
          const next = updateTreeChildren(prev, dirPath, cached);
          treeRef.current = next;
          return next;
        });
        return;
      }

      if (loadingDirectoriesRef.current.has(dirPath)) return;
      loadingDirectoriesRef.current.add(dirPath);
      setLoadingDirectories((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      try {
        const res = await fetch(
          `/api/files?dir=${encodeURIComponent(dirPath)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=1`,
          signal ? { signal } : undefined
        );
        if (!res.ok) return;
        const data = await res.json();
        const children = (data.tree || []) as FileTreeNode[];
        setCached(directoryChildrenCache, dirPath, children);
        setTree((prev) => {
          const next = updateTreeChildren(prev, dirPath, children);
          treeRef.current = next;
          return next;
        });
      } finally {
        loadingDirectoriesRef.current.delete(dirPath);
        setLoadingDirectories((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [workingDirectory, updateTreeChildren]
  );

  const hydrateExpandedDirectories = useCallback(
    async (expandedSet: Set<string>, signal?: AbortSignal) => {
      if (!workingDirectory) return;
      const paths = Array.from(expandedSet);
      paths.sort((a, b) => a.split("/").length - b.split("/").length);

      for (const dirPath of paths) {
        const node = findNode(treeRef.current, dirPath);
        if (!node || node.type !== "directory") continue;
        if (node.children !== undefined) continue;
        await ensureDirectoryChildrenLoaded(dirPath, signal);
      }
    },
    [workingDirectory, findNode, ensureDirectoryChildrenLoaded]
  );

  // 获取文件树
  const fetchTree = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!workingDirectory) {
      abortRef.current = null;
      treeRef.current = [];
      setTree([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const cachedRoot = getCachedRootFileTree(workingDirectory);
      if (cachedRoot && treeRef.current.length === 0) {
        treeRef.current = cachedRoot;
        setTree(cachedRoot);
      }

      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=1`,
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

        const savedExpanded = loadExpandedState();
        if (highlightPath) {
          const next = new Set(savedExpanded);
          for (const parent of getParentPaths(highlightPath)) {
            next.add(parent);
          }
          setExpanded(next);
          void hydrateExpandedDirectories(next, controller.signal);
        } else {
          setExpanded(savedExpanded);
          void hydrateExpandedDirectories(savedExpanded, controller.signal);
        }
      } else {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        treeRef.current = [];
        setTree([]);
        setError(errData.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      treeRef.current = [];
      setTree([]);
      setError("Failed to load file tree");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [workingDirectory, loadExpandedState, highlightPath, hydrateExpandedDirectories]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // File Watcher SSE connection
  useEffect(() => {
    if (!workingDirectory) return;

    let eventSource: EventSource | null = null;
    let retryCount = 0;
    let retryTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      eventSource = new EventSource(`/api/workspace/events?cwd=${encodeURIComponent(workingDirectory)}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "change") {
            fetchTree();
            // Optional: Also trigger git-refresh if needed, since file changes often affect git
            window.dispatchEvent(new CustomEvent('git-refresh'));
          }
        } catch {
          // Ignore
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        // Exponential backoff retry (max 30s)
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        retryTimeout = setTimeout(connect, delay);
      };

      eventSource.onopen = () => {
        retryCount = 0;
      };
    };

    connect();

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      eventSource?.close();
    };
  }, [workingDirectory, fetchTree]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const handleToggle = useCallback(
    (path: string) => {
      const shouldExpand = !expandedRef.current.has(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        saveExpandedState(next);
        return next;
      });

      if (!shouldExpand) return;
      const node = findNode(treeRef.current, path);
      if (!node || node.type !== "directory") return;
      if (node.children !== undefined) return;
      void ensureDirectoryChildrenLoaded(path, abortRef.current?.signal);
    },
    [saveExpandedState, findNode, ensureDirectoryChildrenLoaded]
  );

  useEffect(() => {
    if (!highlightPath) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const parent of getParentPaths(highlightPath)) {
        next.add(parent);
      }
      return next;
    });
    setSelectedPath(highlightPath);
  }, [highlightPath, highlightSeek]);

  // 选择文件
  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onFileSelect(path);
    },
    [onFileSelect]
  );

  // 新建文件
  const handleNewFile = useCallback((parentPath: string) => {
    setNewItemDialog({
      open: true,
      type: "file",
      parentPath,
      name: "",
    });
  }, []);

  // 新建文件夹
  const handleNewFolder = useCallback((parentPath: string) => {
    setNewItemDialog({
      open: true,
      type: "folder",
      parentPath,
      name: "",
    });
  }, []);

  // 创建新项目
  const handleCreateItem = useCallback(async () => {
    if (!newItemDialog.name.trim()) return;

    const basePath = newItemDialog.parentPath || workingDirectory;
    const fullPath = `${basePath}/${newItemDialog.name}`;
    try {
      const res = await fetch("/api/files/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: fullPath,
          type: newItemDialog.type,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }

      showToast({
        type: "success",
        message: newItemDialog.type === "file" ? "文件创建成功" : "文件夹创建成功",
      });

      setNewItemDialog({ open: false, type: "file", parentPath: "", name: "" });
      fetchTree(); // 刷新文件树
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "创建失败",
      });
    }
  }, [newItemDialog, fetchTree, workingDirectory]);

  // 重命名
  const handleRename = useCallback((path: string, isDirectory: boolean) => {
    const name = path.split("/").pop() || "";
    setRenameDialog({
      open: true,
      path,
      isDirectory,
      newName: name,
    });
  }, []);

  // 执行重命名
  const handleDoRename = useCallback(async () => {
    if (!renameDialog.newName.trim()) return;
    if (!renameDialog.path) {
      showToast({ type: "error", message: "缺少文件路径" });
      return;
    }

    const oldPath = renameDialog.path;

    try {
      const res = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: oldPath,
          newName: renameDialog.newName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "重命名失败");
      }

      showToast({
        type: "success",
        message: "重命名成功",
      });

      setRenameDialog({ open: false, path: "", isDirectory: false, newName: "" });
      fetchTree(); // 刷新文件树
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "重命名失败",
      });
    }
  }, [renameDialog, fetchTree]);

  // 删除
  const handleDelete = useCallback((path: string, isDirectory: boolean) => {
    setDeleteDialog({
      open: true,
      path,
      isDirectory,
    });
  }, []);

  // 执行删除
  const handleDoDelete = useCallback(async () => {
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: deleteDialog.path,
          recursive: deleteDialog.isDirectory,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除失败");
      }

      showToast({
        type: "success",
        message: "删除成功",
      });

      setDeleteDialog({ open: false, path: "", isDirectory: false });
      fetchTree(); // 刷新文件树
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "删除失败",
      });
    }
  }, [deleteDialog, fetchTree]);

  // 复制路径
  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      showToast({
        type: "success",
        message: "路径已复制到剪贴板",
      });
    } catch {
      showToast({
        type: "error",
        message: "复制失败",
      });
    }
  }, []);

  // 在 Finder 中打开
  const handleOpenInFinder = useCallback(async (path: string) => {
    try {
      const res = await fetch("/api/files/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "打开失败");
      }
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "打开失败",
      });
    }
  }, []);

  // 添加到对话
  const handleAddToChat = useCallback((path: string) => {
    if (onFileAdd) {
      onFileAdd(path);
      showToast({
        type: "success",
        message: "文件已添加到对话",
      });
    }
  }, [onFileAdd]);

  // 计算扁平化列表
  const flatNodes = useMemo(() => {
    const filterNodes = (nodesList: FileTreeNode[]): FileTreeNode[] => {
      if (!searchQuery) return nodesList;
      const q = searchQuery.toLowerCase();
      return nodesList.reduce<FileTreeNode[]>((acc, node) => {
        const isMatch = node.name.toLowerCase().includes(q);
        if (node.type === "directory" && node.children) {
          const filteredChildren = filterNodes(node.children);
          if (isMatch || filteredChildren.length > 0) {
            acc.push({ ...node, children: filteredChildren });
          }
        } else if (isMatch) {
          acc.push(node);
        }
        return acc;
      }, []);
    };

    const flattenNodes = (nodes: FileTreeNode[], level = 0): FlatNode[] => {
      const result: FlatNode[] = [];
      for (const node of nodes) {
        // 如果有搜索词，强制展开包含匹配项的文件夹
        const isExpanded = searchQuery ? true : expanded.has(node.path);
        result.push({ node, level, isExpanded });
        if (node.type === "directory" && isExpanded && node.children) {
          result.push(...flattenNodes(node.children, level + 1));
        }
      }
      return result;
    };

    const filteredTree = filterNodes(tree);
    return flattenNodes(filteredTree);
  }, [tree, searchQuery, expanded]);

  useEffect(() => {
    if (!workingDirectory || !highlightPath || flatNodes.length === 0) return;
    const seekTargetKey = `${workingDirectory}::${highlightPath}::${highlightSeek || ''}`;
    if (seekKeyRef.current === seekTargetKey) return;

    const index = flatNodes.findIndex((item) => item.node.path === highlightPath);
    if (index < 0) return;

    virtuosoRef.current?.scrollToIndex({
      index,
      align: 'center',
      behavior: 'smooth',
    });
    seekKeyRef.current = seekTargetKey;
  }, [workingDirectory, highlightPath, highlightSeek, flatNodes]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header - 标题和工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("panel.files")}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            onClick={() => handleNewFile(workingDirectory)}
            title="新建文件"
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            onClick={() => handleNewFolder(workingDirectory)}
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            onClick={fetchTree}
            disabled={loading}
            title="刷新"
          >
            <ArrowsClockwise size={14} className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {topSlot ? (
        <div className="border-b border-border/40 px-2.5 py-2.5 shrink-0">
          {topSlot}
        </div>
      ) : null}

      {/* Search */}
      <div className="px-3 py-2 border-b border-border/40 shrink-0">
        <div className="relative">
          <MagnifyingGlass
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            placeholder={t("fileTree.filterFiles")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-hidden py-1">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <ArrowsClockwise size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {error ? error : workingDirectory ? t("fileTree.noFiles") : t("fileTree.selectFolder")}
          </p>
        ) : flatNodes.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            没有找到匹配的文件
          </p>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            data={flatNodes}
            itemContent={(_index: number, flatNode: any) => (
              <TreeNode
                key={flatNode.node.path}
                flatNode={flatNode}
                onToggle={handleToggle}
                onSelect={handleSelect}
                selectedPath={selectedPath}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
                onRename={handleRename}
                onDelete={handleDelete}
                onCopyPath={handleCopyPath}
                onOpenInFinder={handleOpenInFinder}
                onAddToChat={handleAddToChat}
                isLoading={loadingDirectories.has(flatNode.node.path)}
                isHighlighted={flatNode.node.path === highlightPath}
              />
            )}
          />
        )}
      </div>

      {/* New Item Dialog */}
      <Dialog
        open={newItemDialog.open}
        onOpenChange={(open) =>
          setNewItemDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {newItemDialog.type === "file" ? "新建文件" : "新建文件夹"}
            </DialogTitle>
            <DialogDescription>
              在 {newItemDialog.parentPath} 下创建
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={newItemDialog.type === "file" ? "文件名..." : "文件夹名..."}
              value={newItemDialog.name}
              onChange={(e) =>
                setNewItemDialog((prev) => ({ ...prev, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateItem();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setNewItemDialog({ open: false, type: "file", parentPath: "", name: "" })
              }
            >
              取消
            </Button>
            <Button onClick={handleCreateItem} disabled={!newItemDialog.name.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog
        open={renameDialog.open}
        onOpenChange={(open) =>
          setRenameDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription>
              将 {renameDialog.isDirectory ? "文件夹" : "文件"} 重命名为
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="新名称..."
              value={renameDialog.newName}
              onChange={(e) =>
                setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleDoRename();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setRenameDialog({ open: false, path: "", isDirectory: false, newName: "" })
              }
            >
              取消
            </Button>
            <Button onClick={handleDoRename} disabled={!renameDialog.newName.trim()}>
              重命名
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除 {deleteDialog.isDirectory ? "文件夹" : "文件"} {deleteDialog.path.split("/").pop()} 吗？
              {deleteDialog.isDirectory && " 此操作将删除文件夹中的所有内容。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteDialog({ open: false, path: "", isDirectory: false })
              }
            >
              取消
            </Button>
            <Button variant="destructive" onClick={handleDoDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
