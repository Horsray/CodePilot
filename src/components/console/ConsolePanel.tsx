"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Trash, ArrowDown, Funnel, X } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

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

export function ConsolePanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Add a log entry
  const addEntry = useCallback((level: LogLevel, message: string, source?: string) => {
    setEntries((prev) => {
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
      // Keep max 2000 entries
      return next.length > 2000 ? next.slice(-2000) : next;
    });
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

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  const filteredEntries = filter === "all" ? entries : entries.filter((e) => e.level === filter);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border/40 shrink-0">
        {/* Filter buttons */}
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
                  {entries.filter((e) => e.level === level).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Actions */}
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

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto font-mono text-[11px] leading-5"
        onScroll={handleScroll}
      >
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
            {t('console.empty')}
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-2 px-3 py-0.5 border-b border-border/10 hover:bg-muted/30 ${LEVEL_BG[entry.level]}`}
            >
              <span className="text-muted-foreground/40 shrink-0 select-none w-[72px]">
                {formatTime(entry.timestamp)}
              </span>
              <span className={`shrink-0 w-10 ${LEVEL_COLORS[entry.level]}`}>
                [{entry.level}]
              </span>
              <span className={`flex-1 break-all whitespace-pre-wrap ${LEVEL_COLORS[entry.level]}`}>
                {entry.message}
              </span>
              {entry.source && (
                <span className="text-muted-foreground/30 shrink-0 text-[10px]">
                  {entry.source}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
