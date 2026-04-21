"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Trash, ArrowDown, Copy, Check, MagnifyingGlass, X, ListMagnifyingGlass, Sparkle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import {
  copyTextToClipboard,
  formatConsoleEntryForCopy,
  formatConsoleTimestamp,
  getHighlightRanges,
  isConsoleEntryMatched,
  parseSearchKeywords,
  type LogLevel,
} from "@/lib/console-utils";

export interface ConsoleEntry {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: number;
  source?: string;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: "text-foreground",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-muted-foreground",
};

const LEVEL_BG: Record<LogLevel, string> = {
  log: "",
  info: "",
  warn: "bg-yellow-500/5",
  error: "bg-red-500/5",
  debug: "",
};

let entryIdCounter = 0;
const CONSOLE_BRIDGE_KEY = "__codepilot_console_bridge_installed__" as const;

export function ConsolePanel() {
  const { t } = useTranslation();
  const [runtimeEntries, setRuntimeEntries] = useState<ConsoleEntry[]>([]);
  const [eventEntries, setEventEntries] = useState<ConsoleEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMatchesOnly, setShowMatchesOnly] = useState(true);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [copiedEntryId, setCopiedEntryId] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<VirtuosoHandle>(null);

  const addEntry = useCallback((level: LogLevel, message: string, source?: string) => {
    setEventEntries((prev) => {
      const next = [
        ...prev,
        {
          id: ++entryIdCounter,
          level,
          message,
          timestamp: Date.now(),
          source,
        },
      ];
      return next.length > 10000 ? next.slice(-10000) : next;
    });
  }, []);

  useEffect(() => {
    const globalScope = window as Window & { [CONSOLE_BRIDGE_KEY]?: boolean };
    if (globalScope[CONSOLE_BRIDGE_KEY]) return;

    const installBridge = <T extends keyof Console>(level: T, eventLevel: LogLevel) => {
      const original = console[level] as (...args: unknown[]) => void;
      console[level] = ((...args: unknown[]) => {
        const message = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(" ");
        window.dispatchEvent(new CustomEvent("console-log", {
          detail: { level: eventLevel, message, source: "browser" },
        }));
        original.apply(console, args);
      }) as Console[T];
    };

    installBridge("log", "log");
    installBridge("info", "info");
    installBridge("warn", "warn");
    installBridge("error", "error");
    installBridge("debug", "debug");
    globalScope[CONSOLE_BRIDGE_KEY] = true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRuntimeLogs = async () => {
      try {
        const res = await fetch('/api/runtime-logs', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data: { logs?: Array<{ level: LogLevel; message: string; timestamp: string }> } = await res.json();
        if (cancelled) return;
        const next = (data.logs || []).map((entry, index) => ({
          id: -(new Date(entry.timestamp).getTime() + index + 1),
          level: entry.level,
          message: entry.message,
          timestamp: new Date(entry.timestamp).getTime(),
          source: 'runtime',
        }));
        setRuntimeEntries(next);
      } catch {
        // ignore polling failures
      }
    };

    void loadRuntimeLogs();
    const timer = window.setInterval(loadRuntimeLogs, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Listen for console events from the built-in browser iframe
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        addEntry(detail.level || "log", detail.message || "", detail.source);
      }
    };
    window.addEventListener("console-log", handler);
    return () => window.removeEventListener("console-log", handler);
  }, [addEntry]);

  // Listen for build output events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        addEntry(detail.level || "info", detail.message, "build");
      }
    };
    window.addEventListener("build-output", handler);
    return () => window.removeEventListener("build-output", handler);
  }, [addEntry]);

  const clearEntries = useCallback(() => {
    setEventEntries([]);
    setRuntimeEntries([]);
    setSelectedEntryIds(new Set());
    fetch('/api/runtime-logs', { method: 'DELETE' }).catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    const total = visibleEntriesRef.current.length;
    if (total > 0 && listRef.current) {
      listRef.current.scrollToIndex({ index: total - 1, align: "end", behavior: "smooth" });
      setAutoScroll(true);
    }
  }, []);

  const entries = useMemo(
    () => [...runtimeEntries, ...eventEntries].sort((a, b) => a.timestamp - b.timestamp),
    [runtimeEntries, eventEntries]
  );
  const levelFilteredEntries = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.level === filter)),
    [entries, filter]
  );
  const keywords = useMemo(() => parseSearchKeywords(searchQuery), [searchQuery]);

  const searchedEntries = useMemo(
    () =>
      levelFilteredEntries.map((entry) => {
        const isMatch = isConsoleEntryMatched(entry, keywords);
        return {
          entry,
          isMatch,
          highlightRanges: isMatch ? getHighlightRanges(entry.message, keywords) : [],
        };
      }),
    [levelFilteredEntries, keywords]
  );

  const visibleEntries = useMemo(
    () =>
      keywords.length > 0 && showMatchesOnly
        ? searchedEntries.filter((item) => item.isMatch)
        : searchedEntries,
    [searchedEntries, keywords.length, showMatchesOnly]
  );

  const visibleEntriesRef = useRef(visibleEntries);
  useEffect(() => {
    visibleEntriesRef.current = visibleEntries;
  }, [visibleEntries]);

  const firstMatchVisibleIndex = useMemo(
    () => visibleEntries.findIndex((item) => item.isMatch),
    [visibleEntries]
  );

  useEffect(() => {
    if (autoScroll && visibleEntries.length > 0 && listRef.current) {
      listRef.current.scrollToIndex({ index: visibleEntries.length - 1, align: "end", behavior: "auto" });
    }
  }, [visibleEntries, autoScroll]);

  useEffect(() => {
    if (keywords.length > 0 && firstMatchVisibleIndex >= 0 && listRef.current) {
      listRef.current.scrollToIndex({ index: firstMatchVisibleIndex, align: "center", behavior: "auto" });
    }
  }, [keywords, firstMatchVisibleIndex]);

  const toggleSelectEntry = useCallback((entryId: number) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const copyEntries = useCallback(
    async (entriesToCopy: ConsoleEntry[]) => {
      if (entriesToCopy.length === 0) {
        return;
      }
      const text = entriesToCopy.map((entry) => formatConsoleEntryForCopy(entry)).join("\n");
      const copied = await copyTextToClipboard(text);
      if (copied) {
        showToast({
          type: "success",
          message:
            entriesToCopy.length === 1
              ? t("console.copySingleSuccess")
              : t("console.copyBatchSuccess").replace("{count}", String(entriesToCopy.length)),
        });
      } else {
        showToast({ type: "error", message: t("console.copyFailed") });
      }
    },
    [t]
  );

  const copySelectedEntries = useCallback(async () => {
    const selectedEntries = entries.filter((entry) => selectedEntryIds.has(entry.id));
    await copyEntries(selectedEntries);
  }, [copyEntries, entries, selectedEntryIds]);

  const copySingleEntry = useCallback(
    async (entry: ConsoleEntry) => {
      await copyEntries([entry]);
      setCopiedEntryId(entry.id);
      window.setTimeout(() => {
        setCopiedEntryId((prev) => (prev === entry.id ? null : prev));
      }, 1200);
    },
    [copyEntries]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "Escape" && searchQuery) {
        event.preventDefault();
        setSearchQuery("");
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setShowMatchesOnly((prev) => !prev);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectedEntryIds.size > 0) {
        const active = document.activeElement as HTMLElement | null;
        const isEditable =
          active?.isContentEditable ||
          active?.tagName === "INPUT" ||
          active?.tagName === "TEXTAREA";
        if (isEditable) {
          return;
        }
        event.preventDefault();
        void copySelectedEntries();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedEntries, searchQuery, selectedEntryIds.size]);

  const renderHighlightedMessage = useCallback(
    (message: string, ranges: Array<[number, number]>) => {
      if (ranges.length === 0) {
        return message;
      }

      const fragments: React.ReactNode[] = [];
      let cursor = 0;
      for (const [start, end] of ranges) {
        if (start > cursor) {
          fragments.push(message.slice(cursor, start));
        }
        fragments.push(
          <mark key={`${start}-${end}`} className="bg-yellow-500/25 text-inherit rounded px-0.5">
            {message.slice(start, end)}
          </mark>
        );
        cursor = end;
      }
      if (cursor < message.length) {
        fragments.push(message.slice(cursor));
      }
      return fragments;
    },
    []
  );

  const appendToChat = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('append-chat-text', { detail: { text } }));
  }, []);

  const handleAppendSelectedToChat = useCallback(() => {
    if (selectedEntryIds.size === 0) return;
    const selectedEntries = [...runtimeEntries, ...eventEntries]
      .filter((e) => selectedEntryIds.has(e.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    const text = selectedEntries.map(formatConsoleEntryForCopy).join('\n');
    appendToChat(`\`\`\`log\n${text}\n\`\`\``);
  }, [selectedEntryIds, runtimeEntries, eventEntries, appendToChat]);

  const handleAppendErrorsToChat = useCallback(() => {
    const errorEntries = [...runtimeEntries, ...eventEntries]
      .filter((e) => e.level === 'error')
      .sort((a, b) => a.timestamp - b.timestamp);
    if (errorEntries.length === 0) return;
    const text = errorEntries.map(formatConsoleEntryForCopy).join('\n');
    appendToChat(`我遇到了以下报错：\n\`\`\`log\n${text}\n\`\`\`\n请帮我分析原因并修复。`);
  }, [runtimeEntries, eventEntries, appendToChat]);

  const errorCount = useMemo(() => {
    return [...runtimeEntries, ...eventEntries].filter(e => e.level === 'error').length;
  }, [runtimeEntries, eventEntries]);

  const selectedCount = selectedEntryIds.size;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-0.5 text-[10px]">
          {(["all", "log", "info", "warn", "error", "debug"] as const).map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                filter === level
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {level === "all" ? t('console.all') : level}
              {level !== "all" && (
                <span className="ml-0.5 opacity-60">
                  {entries.filter((entry) => entry.level === level).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[180px] max-w-[360px] mx-2">
          <div className="relative">
            <MagnifyingGlass size={12} className="absolute left-2 top-1.5 text-muted-foreground/60" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-6 pl-6 pr-14 text-[11px]"
              placeholder={t("console.searchPlaceholder")}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1 text-muted-foreground/60 hover:text-foreground"
                title={t("console.searchClear")}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {keywords.length > 0 && (
          <Button
            variant={showMatchesOnly ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={() => setShowMatchesOnly((prev) => !prev)}
            title={t("console.toggleMatchesShortcut")}
          >
            <ListMagnifyingGlass size={11} />
            {showMatchesOnly ? t("console.matchOnly") : t("console.showAll")}
          </Button>
        )}

        {errorCount > 0 && selectedCount === 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1 text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-600 dark:hover:text-emerald-400 border-none shadow-none font-medium"
            onClick={handleAppendErrorsToChat}
            title="将控制台报错添加到对话中"
          >
            <Sparkle size={12} weight="fill" />
            添加到对话 · {errorCount}
          </Button>
        )}

        {selectedCount > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-600 dark:hover:text-emerald-400 border-none shadow-none font-medium"
              onClick={handleAppendSelectedToChat}
              title="将选中的日志添加到对话中"
            >
              <Sparkle size={12} weight="fill" />
              添加到对话 · {selectedCount}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={() => void copySelectedEntries()}
              title={t("console.copySelectedShortcut")}
            >
              <Copy size={11} />
              {t("console.copySelected").replace("{count}", String(selectedCount))}
            </Button>
          </div>
        )}

        {!autoScroll && (
          <Button variant="ghost" size="icon-sm" onClick={scrollToBottom}>
            <ArrowDown size={12} />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={clearEntries}>
          <Trash size={12} />
          <span className="sr-only">{t('console.clear')}</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0 font-mono text-[11px] leading-5">
        {visibleEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
            {keywords.length > 0 ? t("console.noMatch") : t("console.empty")}
          </div>
        ) : (
          <Virtuoso
            ref={listRef}
            style={{ height: "100%" }}
            className="overflow-auto"
            totalCount={visibleEntries.length}
            overscan={220}
            atBottomStateChange={setAutoScroll}
            itemContent={(index: number) => {
              const item = visibleEntries[index];
              const { entry, isMatch, highlightRanges } = item;
              const selected = selectedEntryIds.has(entry.id);
              return (
                <div
                  key={entry.id}
                  className={`group flex items-start gap-2 px-3 py-0.5 border-b border-border/10 hover:bg-muted/30 ${LEVEL_BG[entry.level]} ${!showMatchesOnly && keywords.length > 0 && !isMatch ? "opacity-40" : ""}`}
                >
                  <button
                    className={`mt-1 h-3.5 w-3.5 rounded border shrink-0 flex items-center justify-center ${selected ? "border-primary bg-primary/20 text-primary" : "border-border/50 text-transparent hover:text-muted-foreground"}`}
                    onClick={() => toggleSelectEntry(entry.id)}
                    title={t("console.select")}
                  >
                    <Check size={10} />
                  </button>
                  <span className="text-muted-foreground/40 shrink-0 select-none w-[72px]">
                    {formatConsoleTimestamp(entry.timestamp)}
                  </span>
                  <span className={`shrink-0 w-10 ${LEVEL_COLORS[entry.level]}`}>
                    [{entry.level}]
                  </span>
                  <span className={`flex-1 break-all whitespace-pre-wrap ${LEVEL_COLORS[entry.level]}`}>
                    {renderHighlightedMessage(entry.message, highlightRanges)}
                  </span>
                  {entry.source && (
                    <span className="text-muted-foreground/30 shrink-0 text-[10px]">
                      {entry.source}
                    </span>
                  )}
                  <button
                    onClick={() => void copySingleEntry(entry)}
                    className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors ${copiedEntryId === entry.id ? "text-status-success-foreground" : "opacity-0 group-hover:opacity-100"}`}
                    title={t("console.copy")}
                  >
                    {copiedEntryId === entry.id ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
