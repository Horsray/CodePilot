'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, ShareNetwork, CaretDown, CaretRight, Clock,
  PencilSimple, Check, Database, Lightning, ArrowClockwise,
  Copy,
} from '@/components/ui/icon';
import { cn } from '@/lib/utils';

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

const DEFAULT_VISIBLE = 3;

export function MemoryPanel({ workingDirectory }: { workingDirectory: string }) {
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
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
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/40">
        <Brain size={11} className="animate-pulse" />
        <span>加载中...</span>
      </div>
    );
  }

  if (!data) return null;

  const pm = data.projectMemory;
  const projectItems = buildProjectItems(pm);
  const sharedItems = data.sharedMemory;

  if (projectItems.length === 0 && sharedItems.length === 0) return null;

  // Filter out lastscanned from project items for separate display
  const contentItems = projectItems.filter(item => item.id !== 'lastscanned');
  const lastScannedItem = projectItems.find(item => item.id === 'lastscanned');
  const lastScannedLabel = lastScannedItem?.value;

  const visibleContent = showAll ? contentItems : contentItems.slice(0, DEFAULT_VISIBLE);
  const totalCount = contentItems.length + sharedItems.length;

  return (
    <div>
      {/* Top border */}
      <div className="h-px bg-border/40 mb-2" />

      {/* Header row with badge and refresh */}
      <div className="flex items-center gap-2 mb-1.5">
        <button
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary/70 hover:bg-primary/15 transition-colors"
        >
          <Database size={10} />
          <span>OMC 记忆</span>
          <span className="text-[10px] opacity-60">{totalCount}</span>
        </button>
        <button
          onClick={loadMemory}
          className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors flex items-center gap-0.5"
        >
          <ArrowClockwise size={9} />
          <span>刷新</span>
        </button>
      </div>

      {/* Content */}
      <div className="space-y-0.5">
        {/* Project items */}
        {contentItems.length > 0 && visibleContent.map((item) => (
          <MemoryItem
            key={item.id}
            item={item}
            expanded={expandedItem === item.id}
            onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
          />
        ))}

        {/* Shared items */}
        {sharedItems.length > 0 && sharedItems.map(entry => (
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

        {/* Show more */}
        {contentItems.length > DEFAULT_VISIBLE && (
          <button
            onClick={() => setShowAll(p => !p)}
            className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 py-0.5 transition-colors"
          >
            {showAll ? '收起' : `更多 ${contentItems.length - DEFAULT_VISIBLE} 条`}
          </button>
        )}

        {/* Last scanned - bottom right */}
        {lastScannedLabel && (
          <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground/30 pt-1">
            <Clock size={9} />
            <span>{lastScannedLabel}</span>
          </div>
        )}
      </div>

      {/* Bottom border */}
      <div className="h-px bg-border/40 mt-2" />
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

  if (pm.userDirectives) {
    items.push({
      id: 'directives',
      icon: Lightning,
      iconColor: 'text-amber-400/70',
      label: '指令',
      value: pm.userDirectives.length > 60 ? pm.userDirectives.slice(0, 60) + '...' : pm.userDirectives,
      detail: pm.userDirectives,
    });
  }

  if (pm.customNotes && pm.customNotes.length > 0) {
    for (const note of pm.customNotes.slice(0, 5)) {
      items.push({
        id: `note:${note.slice(0, 20)}`,
        icon: NotePencil,
        iconColor: 'text-purple-400/70',
        label: '笔记',
        value: note.length > 60 ? note.slice(0, 60) + '...' : note,
        detail: note,
      });
    }
  }

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

  if (pm.hotPaths && pm.hotPaths.length > 0) {
    const top = pm.hotPaths.slice(0, 5);
    items.push({
      id: 'hotpaths',
      icon: Lightning,
      iconColor: 'text-orange-400/70',
      label: '热路径',
      value: top.map(h => h.path.split('/').pop()).join(', '),
      detail: pm.hotPaths.map(h => `${h.path} (${h.accessCount})`).join('\n'),
    });
  }

  if (pm.lastScanned) {
    items.push({
      id: 'lastscanned',
      icon: Clock,
      iconColor: 'text-muted-foreground/50',
      label: '上次扫描',
      value: formatDate(new Date(pm.lastScanned)),
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
}) {
  const Icon = item.icon;
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-1 py-0.5 text-left hover:bg-muted/10 transition-colors rounded"
      >
        <Icon size={10} className={cn(item.iconColor, 'shrink-0')} />
        <span className="text-[11px] font-medium text-foreground/60 shrink-0">{item.label}</span>
        <span className="text-[11px] text-muted-foreground/50 truncate flex-1 min-w-0">{item.value}</span>
        {item.detail && (
          <CaretRight size={8} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && item.detail && (
        <div className="pl-4 pb-1">
          <pre className="text-[11px] text-muted-foreground/60 whitespace-pre-wrap break-words leading-relaxed max-h-28 overflow-y-auto">
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
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-1 py-0.5 text-left hover:bg-muted/10 transition-colors rounded"
      >
        <ShareNetwork size={10} className="text-emerald-400/60 shrink-0" />
        <span className="text-[11px] font-medium text-foreground/60 truncate shrink-0 max-w-[70px]">{entry.key}</span>
        <span className="text-[9px] text-muted-foreground/30 px-0.5 py-0 rounded bg-muted/20 shrink-0">{entry.namespace}</span>
        <span className="text-[11px] text-muted-foreground/40 truncate flex-1 min-w-0">{valuePreview}</span>
        <CaretRight size={8} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="pl-4 pb-1 space-y-0.5">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
            <span>更新: {formatDate(new Date(entry.updatedAt))}</span>
          </div>
          <div className="relative">
            <pre className="text-[11px] text-muted-foreground/60 whitespace-pre-wrap break-words leading-relaxed max-h-28 overflow-y-auto bg-muted/5 rounded p-1.5">
              {JSON.stringify(entry.value, null, 2)}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-1 right-1 p-0.5 rounded bg-background/60 hover:bg-background transition-colors"
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