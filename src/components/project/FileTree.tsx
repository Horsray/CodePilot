"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { ArrowsClockwise, MagnifyingGlass, FileCode, Code, File, Image as ImageIcon, FileZip, Play, Copy, Trash, PencilSimple, ArrowSquareOut, ChatCircleText, FolderPlus } from "@/components/ui/icon";
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
import { Folder, FolderOpen, Plus, TerminalWindow } from "@phosphor-icons/react";
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

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
  highlightPath?: string;
  highlightSeek?: string;
}

// 中文注释：功能名称「文件图标颜色映射」，用法是按文件扩展名返回与旧版增强文件树一致的彩色图标，避免轻量版回退后图标全部变成单色。
function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case "ts":
    case "tsx":
      return <FileCode size={16} className="text-blue-500" />;
    case "js":
    case "jsx":
      return <FileCode size={16} className="text-yellow-400" />;
    case "vue":
      return <FileCode size={16} className="text-green-500" />;
    case "py":
      return <FileCode size={16} className="text-blue-600" />;
    case "php":
      return <FileCode size={16} className="text-purple-500" />;
    case "html":
    case "htm":
      return <FileCode size={16} className="text-orange-500" />;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <FileCode size={16} className="text-blue-400" />;
    case "json":
      return <Code size={16} className="text-yellow-500" />;
    case "yaml":
    case "yml":
    case "toml":
      return <Code size={16} className="text-amber-500" />;
    case "csv":
      return <File size={16} className="text-green-600" />;
    case "sql":
      return <FileCode size={16} className="text-gray-500" />;
    case "md":
    case "mdx":
    case "txt":
      return <File size={16} className="text-gray-400" />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "svg":
    case "webp":
      return <ImageIcon size={16} className="text-purple-400" />;
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return <File size={16} className="text-pink-400" />;
    case "mp4":
    case "avi":
    case "mov":
    case "mkv":
      return <Play size={16} className="text-red-400" />;
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return <FileZip size={16} className="text-yellow-600" />;
    case "pdf":
      return <File size={16} className="text-red-500" />;
    case "doc":
    case "docx":
      return <File size={16} className="text-blue-600" />;
    case "xls":
    case "xlsx":
      return <File size={16} className="text-green-600" />;
    case "ppt":
    case "pptx":
      return <File size={16} className="text-orange-500" />;
    case "rs":
      return <FileCode size={16} className="text-orange-600" />;
    case "go":
      return <FileCode size={16} className="text-cyan-500" />;
    case "java":
      return <FileCode size={16} className="text-red-600" />;
    case "rb":
      return <FileCode size={16} className="text-red-500" />;
    case "swift":
      return <FileCode size={16} className="text-orange-500" />;
    case "kt":
      return <FileCode size={16} className="text-purple-500" />;
    case "dart":
      return <FileCode size={16} className="text-cyan-400" />;
    case "lua":
      return <FileCode size={16} className="text-blue-500" />;
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "cs":
    case "zig":
      return <FileCode size={16} className="text-yellow-500" />;
    default:
      return <File size={16} className="text-gray-400" />;
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
  if (node.type !== "file") return false;
  if (node.extension && EXECUTABLE_EXTENSIONS.has(node.extension)) return true;
  // Files without extension are potentially binary executables
  if (!node.extension) return true;
  return false;
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
  onAddToChat?: (path: string) => void;
}) {
  const { node, level, isExpanded } = flatNode;
  const isDirectory = node.type === "directory";
  const isSelected = selectedPath === node.path;
  const isHighlighted = highlightPath === node.path;
  const paddingLeft = level * 16 + 8; // 16px per level
  const executable = isExecutableFile(node);

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

  if (isDirectory) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "flex w-full cursor-pointer items-center gap-1 rounded py-1 pr-2 text-left transition-colors hover:bg-muted/50",
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
            {/* 文件夹图标同时作为展开/折叠按钮 */}
            <FileTreeIcon>
              {isExpanded ? (
                <FolderOpen size={16} className="text-blue-400" weight="fill" />
              ) : (
                <Folder size={16} className="text-blue-400" weight="fill" />
              )}
            </FileTreeIcon>
            <FileTreeName>{node.name}</FileTreeName>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onSelect?.(node.path)}>
            <FolderOpen size={14} className="mr-2" />
            <span>打开文件夹</span>
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
          <ContextMenuItem onSelect={() => onRename?.(node.path, true)}>
            <PencilSimple size={14} className="mr-2" />
            <span>重命名</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopyPath?.(node.path)}>
            <Copy size={14} className="mr-2" />
            <span>复制路径</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInFinder?.(node.path)}>
            <ArrowSquareOut size={14} className="mr-2" />
            <span>在 Finder 中打开</span>
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
            "group/file flex cursor-pointer items-center gap-1 rounded py-1 pr-2 transition-colors hover:bg-muted/50",
            isSelected && "bg-muted",
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
          <FileTreeName>{node.name}</FileTreeName>
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
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onSelect?.(node.path)}>
          <File size={14} className="mr-2" />
          <span>打开文件</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAddToChat?.(node.path)}>
          <ChatCircleText size={14} className="mr-2" />
          <span>添加到对话</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {executable && (
          <>
            <ContextMenuItem onSelect={() => handleExecuteInTerminal(node.path)}>
              <TerminalWindow size={14} className="mr-2" />
              <span>在终端中执行</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onRename?.(node.path, false)}>
          <PencilSimple size={14} className="mr-2" />
          <span>重命名</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyPath?.(node.path)}>
          <Copy size={14} className="mr-2" />
          <span>复制路径</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenInFinder?.(node.path)}>
          <ArrowSquareOut size={14} className="mr-2" />
          <span>在 Finder 中打开</span>
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
      showToast({ type: "error", message: err instanceof Error ? err.message : "打开失败" });
    }
  }, []);

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
      {/* Search + Refresh */}
      <div className="flex items-center gap-1.5 px-4 py-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('fileTree.filterFiles')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchTree}
          disabled={loading}
          className="h-7 w-7 shrink-0"
        >
          <ArrowsClockwise size={12} className={cn(loading && "animate-spin")} />
          <span className="sr-only">{t('fileTree.refresh')}</span>
        </Button>
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
            className="h-full rounded-none border-0 [&>div]:h-full [&>div]:min-h-0 [&>div]:p-0"
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
