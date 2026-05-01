'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, ShareNetwork, CaretDown, CaretRight, Clock,
  PencilSimple, Trash, X, Check, Database, Lightning,
  Copy,
} from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { showToast } from '@/hooks/useToast';

interface ProjectMemory {
  version?: string;
  lastScanned?: number;
  customNotes?: string[];
  userDirectives?: string;
  techStack?: {
    languages?: Array<{ name: string }>;
    frameworks?: Array<{ name: string; version?: string }>;
    packageManager?: string;
  };
  hotPaths?: Array<{ path: string; accessCount: number; lastAccessed: number }>;
}

interface SharedMemoryEntry {
  key: string;
  value: unknown;
  namespace: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface MemoryData {
  projectMemory: ProjectMemory | null;
  sharedMemory: SharedMemoryEntry[];
}

const DEFAULT_VISIBLE = 5;

export function MemoryPanel({ workingDirectory }: { workingDirectory: string }) {
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [sharedExpanded, setSharedExpanded] = useState(true);
  const [showAllProject, setShowAllProject] = useState(false);
  const [showAllShared, setShowAllShared] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    try {
      const res = await fetch(`/api/omc-memory?dir=${encodeURIComponent(workingDirectory)}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [workingDirectory]);

  useEffect(() => { loadMemory(); }, [loadMemory]);

  if (loading) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <Brain size={12} className="animate-pulse" />
          <span>加载记忆中...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const pm = data.projectMemory;
  const projectItems = buildProjectItems(pm);
  const sharedItems = data.sharedMemory;

  if (projectItems.length === 0 && sharedItems.length === 0) return null;

  const visibleProject = showAllProject ? projectItems : projectItems.slice(0, DEFAULT_VISIBLE);
  const visibleShared = showAllShared ? sharedItems : sharedItems.slice(0, DEFAULT_VISIBLE);

  return (
    <div className="mx-4 py-2">
      <div className="rounded-lg border border-border/40 bg-primary/[0.02] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/30">
          <Database size={12} className="text-muted-foreground/60" />
          <span className="text-[11px] font-medium text-foreground/70">OMC 记忆</span>
          <button
            onClick={loadMemory}
            className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          >
            刷新
          </button>
        </div>

        {/* Project Memory Section */}
        {projectItems.length > 0 && (
          <div className="border-b border-border/20">
            <button
              onClick={() => setProjectExpanded(p => !p)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-muted/20 transition-colors"
            >
              {projectExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
              <Brain size={11} className="text-blue-400/70" />
              <span className="text-[11px] font-medium text-foreground/70">项目记忆</span>
              <span className="text-[10px] text-muted-foreground/40 ml-auto">{projectItems.length}</span>
            </button>
            {projectExpanded && (
              <div className="px-3 pb-2 space-y-0.5">
                {visibleProject.map((item, idx) => (
                  <MemoryItem
                    key={item.id}
                    item={item}
                    expanded={expandedItem === item.id}
                    onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                    compact={idx >= DEFAULT_VISIBLE}
                  />
                ))}
                {projectItems.length > DEFAULT_VISIBLE && (
                  <button
                    onClick={() => setShowAllProject(p => !p)}
                    className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 py-1 transition-colors"
                  >
                    {showAllProject ? '收起' : `展开全部 ${projectItems.length} 条`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Shared Memory Section */}
        {sharedItems.length > 0 && (
          <div>
            <button
              onClick={() => setSharedExpanded(p => !p)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-muted/20 transition-colors"
            >
              {sharedExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
              <ShareNetwork size={11} className="text-emerald-400/70" />
              <span className="text-[11px] font-medium text-foreground/70">共享记忆</span>
              <span className="text-[10px] text-muted-foreground/40 ml-auto">{sharedItems.length}</span>
            </button>
            {sharedExpanded && (
              <div className="px-3 pb-2 space-y-0.5">
                {visibleShared.map(entry => (
                  <SharedMemoryItem
                    key={`${entry.namespace}/${entry.key}`}
                    entry={entry}
                    expanded={expandedItem === `shared:${entry.namespace}/${entry.key}`}
                    onToggle={() => {
                      const id = `shared:${entry.namespace}/${entry.key}`;
                      setExpandedItem(expandedItem === id ? null : id);
                    }}
                  />
                ))}
                {sharedItems.length > DEFAULT_VISIBLE && (
                  <button
                    onClick={() => setShowAllShared(p => !p)}
                    className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 py-1 transition-colors"
                  >
                    {showAllShared ? '收起' : `展开全部 ${sharedItems.length} 条`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state for shared */}
        {projectItems.length > 0 && sharedItems.length === 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/30">
              <ShareNetwork size={10} />
              <span>暂无共享记忆</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Project memory item types ---

interface ProjectItem {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string;
  detail?: string;
}

function buildProjectItems(pm: ProjectMemory | null): ProjectItem[] {
  if (!pm) return [];
  const items: ProjectItem[] = [];

  // User directives
  if (pm.userDirectives) {
    items.push({
      id: 'directives',
      icon: Lightning,
      iconColor: 'text-amber-400/70',
      label: '用户指令',
      value: pm.userDirectives.length > 60 ? pm.userDirectives.slice(0, 60) + '...' : pm.userDirectives,
      detail: pm.userDirectives,
    });
  }

  // Custom notes
  if (pm.customNotes && pm.customNotes.length > 0) {
    for (const note of pm.customNotes) {
      items.push({
        id: `note:${note.slice(0, 30)}`,
        icon: NotePencil,
        iconColor: 'text-purple-400/70',
        label: '笔记',
        value: note.length > 60 ? note.slice(0, 60) + '...' : note,
        detail: note,
      });
    }
  }

  // Tech stack summary
  if (pm.techStack) {
    const parts: string[] = [];
    if (pm.techStack.languages?.length) {
      parts.push(...pm.techStack.languages.map(l => l.name));
    }
    if (pm.techStack.frameworks?.length) {
      parts.push(...pm.techStack.frameworks.map(f => f.version ? `${f.name}@${f.version}` : f.name));
    }
    if (parts.length > 0) {
      items.push({
        id: 'techstack',
        icon: Brain,
        iconColor: 'text-blue-400/70',
        label: '技术栈',
        value: parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` +${parts.length - 4}` : ''),
        detail: parts.join('\n'),
      });
    }
  }

  // Hot paths
  if (pm.hotPaths && pm.hotPaths.length > 0) {
    const top = pm.hotPaths.slice(0, 5);
    items.push({
      id: 'hotpaths',
      icon: Lightning,
      iconColor: 'text-orange-400/70',
      label: '热路径',
      value: top.map(h => h.path.split('/').pop()).join(', '),
      detail: pm.hotPaths.map(h => `${h.path} (${h.accessCount} 次)`).join('\n'),
    });
  }

  // Last scanned
  if (pm.lastScanned) {
    const date = new Date(pm.lastScanned);
    items.push({
      id: 'lastscanned',
      icon: Clock,
      iconColor: 'text-muted-foreground/50',
      label: '上次扫描',
      value: formatDate(date),
    });
  }

  return items;
}

function NotePencil(props: { size?: number; className?: string }) {
  return <PencilSimple {...props} />;
}

// --- Sub-components ---

function MemoryItem({ item, expanded, onToggle }: {
  item: ProjectItem;
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <div className="rounded bg-muted/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/20 transition-colors"
      >
        <Icon size={10} className={cn(item.iconColor, 'shrink-0')} />
        <span className="text-[10px] font-medium text-foreground/60 shrink-0">{item.label}</span>
        <span className="text-[10px] text-muted-foreground/50 truncate flex-1 min-w-0">{item.value}</span>
        {item.detail && (
          <CaretRight size={8} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && item.detail && (
        <div className="px-2 pb-1.5 pt-0.5">
          <pre className="text-[10px] text-muted-foreground/60 whitespace-pre-wrap break-words leading-relaxed max-h-32 overflow-y-auto">
            {item.detail}
          </pre>
        </div>
      )}
    </div>
  );
}

function SharedMemoryItem({ entry, expanded, onToggle }: {
  entry: SharedMemoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry.value, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const valuePreview = typeof entry.value === 'string'
    ? entry.value.slice(0, 50)
    : JSON.stringify(entry.value).slice(0, 50);

  return (
    <div className="rounded bg-muted/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/20 transition-colors"
      >
        <ShareNetwork size={10} className="text-emerald-400/60 shrink-0" />
        <span className="text-[10px] font-medium text-foreground/60 truncate shrink-0 max-w-[80px]">{entry.key}</span>
        <span className="text-[9px] text-muted-foreground/30 px-1 py-0 rounded bg-muted/20 shrink-0">{entry.namespace}</span>
        <span className="text-[10px] text-muted-foreground/40 truncate flex-1 min-w-0">{valuePreview}</span>
        <CaretRight size={8} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-2 pb-1.5 pt-0.5 space-y-1">
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/40">
            <span>更新: {formatDate(new Date(entry.updatedAt))}</span>
            {entry.expiresAt && <span>过期: {formatDate(new Date(entry.expiresAt))}</span>}
          </div>
          <div className="relative">
            <pre className="text-[10px] text-muted-foreground/60 whitespace-pre-wrap break-words leading-relaxed max-h-32 overflow-y-auto bg-muted/10 rounded p-1.5">
              {JSON.stringify(entry.value, null, 2)}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-1 right-1 p-0.5 rounded bg-background/60 hover:bg-background transition-colors"
              title="复制"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} className="text-muted-foreground/40" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
