"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { ArrowsClockwise, MagnifyingGlass, FileCode, Code, File, Image as ImageIcon, FileZip, Play } from "@/components/ui/icon";
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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePanelStore } from "@/store/usePanelStore";
import { useTerminal } from "@/hooks/useTerminal";

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

function FlatTreeNodeItem({
  flatNode,
  togglePath,
  selectedPath,
  onSelect,
  onAdd,
  highlightPath,
}: {
  flatNode: FlatNode;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  highlightPath?: string;
}) {
  const { node, level, isExpanded } = flatNode;
  const isDirectory = node.type === "directory";
  const isSelected = selectedPath === node.path;
  const isHighlighted = highlightPath === node.path;
  const paddingLeft = level * 16 + 8; // 16px per level

  const handleOpenInTerminal = () => {
    let command = "";
    if (isDirectory) {
      command = `cd "${node.path}"`;
    } else {
      command = `"${node.path}"`;
    }
    usePanelStore.getState().setTerminalOpen(true);
    window.dispatchEvent(new CustomEvent('terminal:execute-command', { detail: { command } }));
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
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleOpenInTerminal}>
            <TerminalWindow size={14} className="mr-2" />
            <span>在终端中打开</span>
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
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleOpenInTerminal}>
          <TerminalWindow size={14} className="mr-2" />
          <span>在终端中打开</span>
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
                />
              )}
            />
          </AIFileTree>
        )}
      </div>
    </div>
  );
}
