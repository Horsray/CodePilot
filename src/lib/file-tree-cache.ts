"use client";

import type { FileTreeNode } from "@/types";

type CacheEntry<T> = { value: T; ts: number };

const FILE_TREE_CACHE_TTL_MS = 30_000;
const rootTreeCache = new Map<string, CacheEntry<FileTreeNode[]>>();

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

export function getCachedRootFileTree(workingDirectory: string): FileTreeNode[] | null {
  if (!workingDirectory) return null;
  return getCached(rootTreeCache, workingDirectory);
}

export function setCachedRootFileTree(workingDirectory: string, tree: FileTreeNode[]) {
  if (!workingDirectory) return;
  setCached(rootTreeCache, workingDirectory, tree);
}

export async function prefetchRootFileTree(
  workingDirectory: string,
  signal?: AbortSignal,
): Promise<FileTreeNode[] | null> {
  if (!workingDirectory) return null;

  const cached = getCachedRootFileTree(workingDirectory);
  if (cached) return cached;

  try {
    // 中文注释：功能名称「文件树根节点预取」，用法是在会话进入时后台请求首层目录，
    // 让真正打开面板时优先命中客户端缓存，避免首次点击后才开始扫描目录。
    const res = await fetch(
      `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=1`,
      signal ? { signal } : undefined,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tree?: FileTreeNode[] };
    const tree = data.tree || [];
    setCachedRootFileTree(workingDirectory, tree);
    return tree;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return null;
    }
    return null;
  }
}
