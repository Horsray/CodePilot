"use client";

import { useState, useCallback, useRef, useEffect, useMemo, type CSSProperties } from "react";
import {
  Trash, ArrowDown, Copy, Check, MagnifyingGlass, X,
  Sparkle, CaretDown, CaretRight, WarningCircle,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import {
  copyTextToClipboard, formatConsoleEntryForCopy, formatConsoleTimestamp,
  getHighlightRanges, isConsoleEntryMatched, parseSearchKeywords, type LogLevel,
} from "@/lib/console-utils";

// ── Types ─────────────────────────────────────────────────────
export interface ConsoleEntry { id: number; level: LogLevel; message: string; timestamp: number; source?: string }
interface GroupedEntry { key: string; level: LogLevel; message: string; firstTimestamp: number; lastTimestamp: number; count: number; source?: string }

// ── Light theme ───────────────────────────────────────────────
const BG = "#ffffff";
const SURFACE = "#f7f7f8";
const BORDER = "#e5e5e5";
const TEXT = "#1a1a1a";
const TEXT_DIM = "#666666";
const TEXT_MUTED = "#999999";
const PRIMARY = "#2563eb";
const PRIMARY_BG = "rgba(37,99,235,0.08)";
const SUCCESS = "#16a34a";
const ERROR_TEXT = "#dc2626";
const ERROR_BG = "rgba(220,38,38,0.05)";
const ERROR_BORDER = "rgba(220,38,38,0.35)";
const WARN_TEXT = "#64748b";
const WARN_BG = "rgba(100,116,139,0.06)";
const WARN_BORDER = "rgba(100,116,139,0.3)";
const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  "title-generator": { bg: "rgba(139,92,246,0.10)", text: "#7c3aed" },
  "chat API": { bg: "rgba(37,99,235,0.08)", text: "#2563eb" },
  "warmup API": { bg: "rgba(6,182,212,0.10)", text: "#0891b2" },
  "claude-client": { bg: "rgba(22,163,74,0.08)", text: "#16a34a" },
  "persistent-claude-session": { bg: "rgba(217,119,6,0.10)", text: "#b45309" },
  "provider-resolver": { bg: "rgba(234,88,12,0.10)", text: "#c2410c" },
  "instrumentation": { bg: "rgba(100,116,139,0.10)", text: "#475569" },
  "stream-session": { bg: "rgba(13,148,136,0.10)", text: "#0f766e" },
  "mcp-loader": { bg: "rgba(219,39,119,0.10)", text: "#be185d" },
};
function tagColor(tag: string): { bg: string; text: string } {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h + tag.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return { bg: `hsla(${hue},50%,40%,0.08)`, text: `hsl(${hue},60%,35%)` };
}
const LEVEL_LABELS: Record<string, string> = { error: "错误", warn: "警告", log: "日志", info: "信息", debug: "调试" };
const PAGE_SIZE = 200;

// ── Styles ────────────────────────────────────────────────────
const s = {
  root: { display: "flex", flexDirection: "column" as const, height: "100%", width: "100%", background: BG, color: TEXT, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, textAlign: "left" as const },
  toolbar: { display: "flex", alignItems: "center" as const, gap: 6, padding: "0 10px", height: 34, borderBottom: `1px solid ${BORDER}`, flexShrink: 0, background: SURFACE },
  mono: { fontFamily: '"SF Mono", Menlo, Consolas, monospace' },
};

// ── Message parsing ───────────────────────────────────────────
interface ParsedLog { tag: string; body: string; kvPairs: Array<{ key: string; value: string }> }
function parseLogMessage(message: string): ParsedLog {
  const m = message.match(/^\[([^\]]+)\]\s*/);
  let tag = "", body = message;
  if (m) { tag = m[1]; body = message.slice(m[0].length); }
  const kv: Array<{ key: string; value: string }> = [];
  const jm = body.match(/^(.*?)(\{[\s\S]*\})\s*$/);
  if (jm) {
    const prefix = jm[1].trim();
    try {
      const obj = JSON.parse(jm[2]);
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        body = prefix || tag || body;
        for (const [k, v] of Object.entries(obj)) {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          if (val.length < 200) kv.push({ key: k, value: val });
        }
        if (kv.length === 0) body = prefix || body;
      }
    } catch {}
  }
  return { tag, body, kvPairs: kv };
}

const BRIDGE_KEY = "__codepilot_console_bridge_installed__" as const;
let idCounter = 0;

// ── Highlighted text ──────────────────────────────────────────
function HL({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let c = 0;
  for (const [a, b] of ranges) {
    if (a > c) out.push(text.slice(c, a));
    out.push(<mark key={a} style={{ background: "rgba(37,99,235,0.15)", color: PRIMARY, borderRadius: 2 }}>{text.slice(a, b)}</mark>);
    c = b;
  }
  if (c < text.length) out.push(text.slice(c));
  return <>{out}</>;
}

// ── Deduplicate entries: same level + same message → one row with count ──
function dedupEntries(entries: ConsoleEntry[]): GroupedEntry[] {
  const map = new Map<string, GroupedEntry>();
  for (const e of entries) {
    const key = `${e.level}::${e.message}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.lastTimestamp = Math.max(existing.lastTimestamp, e.timestamp);
    } else {
      map.set(key, { key, level: e.level, message: e.message, firstTimestamp: e.timestamp, lastTimestamp: e.timestamp, count: 1, source: e.source });
    }
  }
  return Array.from(map.values());
}

// ── Main Component ────────────────────────────────────────────
export function ConsolePanel() {
  const { t } = useTranslation();
  const [runtimeEntries, setRuntimeEntries] = useState<ConsoleEntry[]>([]);
  const [eventEntries, setEventEntries] = useState<ConsoleEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── REPL 调试控制台 ────────────────────────────────────────
  const [replInput, setReplInput] = useState("");
  const [replHistory, setReplHistory] = useState<string[]>([]);
  const [replHistoryIdx, setReplHistoryIdx] = useState(-1);
  const replRef = useRef<HTMLInputElement>(null);

  const addEntry = useCallback((level: LogLevel, message: string, source?: string) => {
    setEventEntries(p => { const n = [...p, { id: ++idCounter, level, message, timestamp: Date.now(), source }]; return n.length > 500 ? n.slice(-500) : n; });
  }, []);

  // Browser console bridge — 已禁用，Next.js HMR 日志会导致 CPU 100%
  // 如需恢复可取消下方注释
  // useEffect(() => {
  //   const g = window as Window & { [BRIDGE_KEY]?: boolean };
  //   if (g[BRIDGE_KEY]) return;
  //   const inst = <T extends keyof Console>(lv: T, ev: LogLevel) => {
  //     const orig = console[lv] as (...a: unknown[]) => void;
  //     console[lv] = ((...a: unknown[]) => {
  //       const msg = a.map(x => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ");
  //       window.dispatchEvent(new CustomEvent("console-log", { detail: { level: ev, message: msg, source: "browser" } }));
  //       orig.apply(console, a);
  //     }) as Console[T];
  //   };
  //   inst("log", "log"); inst("info", "info"); inst("warn", "warn"); inst("error", "error"); inst("debug", "debug");
  //   g[BRIDGE_KEY] = true;
  // }, []);

  // Runtime logs polling — append only
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/runtime-logs", { cache: "no-store" });
        if (!r.ok || stop) return;
        const d = await r.json();
        if (stop) return;
        const mapped: ConsoleEntry[] = (d.logs || []).map((e: { level: LogLevel; message: string; timestamp: string }, i: number) => ({
          id: -(new Date(e.timestamp).getTime() + i + 1), level: e.level, message: e.message, timestamp: new Date(e.timestamp).getTime(), source: "runtime",
        }));
        if (mapped.length === 0) return;
        setRuntimeEntries(prev => {
          const seen = new Set(prev.map(e => e.id));
          const fresh = mapped.filter(e => !seen.has(e.id));
          if (fresh.length === 0) return prev;
          const merged = [...prev, ...fresh];
          return merged.length > 500 ? merged.slice(-500) : merged;
        });
      } catch {}
    };
    void load();
    const t = window.setInterval(load, 5000);
    return () => { stop = true; window.clearInterval(t); };
  }, []);

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d) queueMicrotask(() => addEntry(d.level || "log", d.message || "", d.source)); };
    window.addEventListener("console-log", h);
    return () => window.removeEventListener("console-log", h);
  }, [addEntry]);

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.message) queueMicrotask(() => addEntry(d.level || "info", d.message, "build")); };
    window.addEventListener("build-output", h);
    return () => window.removeEventListener("build-output", h);
  }, [addEntry]);

  // Derived — dedup, filter, limit
  const allEntries = useMemo(() => [...runtimeEntries, ...eventEntries].sort((a, b) => a.timestamp - b.timestamp), [runtimeEntries, eventEntries]);
  const counts = useMemo(() => {
    const c = { log: 0, info: 0, warn: 0, error: 0, debug: 0, total: 0 };
    for (const e of allEntries) { c[e.level]++; c.total++; }
    return c;
  }, [allEntries]);
  const keywords = useMemo(() => parseSearchKeywords(searchQuery), [searchQuery]);

  const grouped = useMemo(() => dedupEntries(allEntries), [allEntries]);

  const filtered = useMemo(() => {
    let list = grouped;
    if (levelFilter !== "all") list = list.filter(e => e.level === levelFilter);
    if (keywords.length > 0) {
      list = list.filter(e => {
        const fake: ConsoleEntry = { id: 0, level: e.level, message: e.message, timestamp: 0, source: e.source };
        return isConsoleEntryMatched(fake, keywords);
      });
    }
    return list;
  }, [grouped, levelFilter, keywords]);

  // Show latest N
  const totalFiltered = filtered.length;
  const visible = useMemo(() => filtered.slice(-visibleCount), [filtered, visibleCount]);
  const hasMore = totalFiltered > visibleCount;

  // Actions
  const clear = useCallback(() => {
    setEventEntries([]); setRuntimeEntries([]); setVisibleCount(PAGE_SIZE);
    fetch("/api/runtime-logs", { method: "DELETE" }).catch(() => {});
  }, []);
  const goBottom = useCallback(() => { if (scrollRef.current) { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; setAutoScroll(true); } }, []);
  const showMore = useCallback(() => { setVisibleCount(p => Math.min(p + PAGE_SIZE, totalFiltered)); }, [totalFiltered]);
  const copyEntry = useCallback(async (entry: GroupedEntry) => {
    const fake: ConsoleEntry = { id: 0, level: entry.level, message: entry.message, timestamp: entry.lastTimestamp, source: entry.source };
    if (await copyTextToClipboard(formatConsoleEntryForCopy(fake))) { setCopiedKey(entry.key); setTimeout(() => setCopiedKey(null), 1200); }
  }, []);
  const appendErrors = useCallback(() => {
    const errs = grouped.filter(e => e.level === "error");
    if (errs.length === 0) return;
    const lines = errs.map(e => {
      const ts = formatConsoleTimestamp(e.lastTimestamp);
      const cnt = e.count > 1 ? ` (×${e.count})` : '';
      return `${ts} [${e.level}] ${e.message}${cnt}`;
    });
    window.dispatchEvent(new CustomEvent("append-chat-text", { detail: { text: `我遇到了以下报错：\n\`\`\`log\n${lines.join("\n")}\n\`\`\`\n请帮我分析原因并修复。` } }));
  }, [grouped]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
  }, [visible, autoScroll]);

  // ── REPL 执行 ──────────────────────────────────────────────
  const formatReplResult = useCallback((value: unknown): { text: string; level: LogLevel } => {
    if (value === undefined) return { text: "undefined", level: "log" };
    if (value === null) return { text: "null", level: "log" };
    if (typeof value === "string") return { text: `"${value}"`, level: "log" };
    if (typeof value === "function") return { text: `[Function: ${value.name || "anonymous"}]`, level: "log" };
    if (value instanceof Error) return { text: `${value.name}: ${value.message}`, level: "error" };
    if (typeof value === "object") {
      try {
        return { text: JSON.stringify(value, null, 2), level: "log" };
      } catch {
        return { text: String(value), level: "log" };
      }
    }
    return { text: String(value), level: "log" };
  }, []);

  const executeRepl = useCallback((expr: string) => {
    const trimmed = expr.trim();
    if (!trimmed) return;

    // 记录历史
    setReplHistory(prev => {
      const filtered = prev.filter(h => h !== trimmed);
      return [...filtered, trimmed];
    });
    setReplHistoryIdx(-1);

    // 添加输入行
    addEntry("log", `> ${trimmed}`, "console");

    try {
      // eslint-disable-next-line no-eval
      const result = eval(trimmed);
      // 处理 Promise
      if (result instanceof Promise) {
        result
          .then(resolved => {
            const { text, level } = formatReplResult(resolved);
            addEntry(level, `< ${text}`, "console");
          })
          .catch(err => {
            addEntry("error", `< ${err instanceof Error ? err.message : String(err)}`, "console");
          });
      } else {
        const { text, level } = formatReplResult(result);
        addEntry(level, `< ${text}`, "console");
      }
    } catch (err) {
      addEntry("error", `< ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`, "console");
    }

    setReplInput("");
    setAutoScroll(true);
  }, [addEntry, formatReplResult]);

  const handleReplKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeRepl(replInput);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (replHistory.length === 0) return;
      const newIdx = replHistoryIdx < 0 ? replHistory.length - 1 : Math.max(0, replHistoryIdx - 1);
      setReplHistoryIdx(newIdx);
      setReplInput(replHistory[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (replHistoryIdx < 0) return;
      const newIdx = replHistoryIdx + 1;
      if (newIdx >= replHistory.length) {
        setReplHistoryIdx(-1);
        setReplInput("");
      } else {
        setReplHistoryIdx(newIdx);
        setReplInput(replHistory[newIdx]);
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clear();
    }
  }, [replInput, replHistory, replHistoryIdx, executeRepl, clear]);
  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); replRef.current?.focus(); replRef.current?.select(); }
      if (e.key === "Escape" && searchQuery) { e.preventDefault(); setSearchQuery(""); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [searchQuery]);

  // ── Render single grouped entry ─────────────────────────────
  const renderEntry = (entry: GroupedEntry) => {
    const p = parseLogMessage(entry.message);
    const tc = p.tag ? tagColor(p.tag) : null;
    const hl = keywords.length > 0 ? getHighlightRanges(entry.message, keywords) : [];
    const isErr = entry.level === "error";
    const isWrn = entry.level === "warn";
    const isDup = entry.count > 1;

    return (
      <div key={entry.key} style={{
        display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 12px", textAlign: "left" as const,
        borderLeft: `2px solid ${isErr ? ERROR_BORDER : isWrn ? WARN_BORDER : "transparent"}`,
        background: isErr ? ERROR_BG : isWrn ? WARN_BG : "transparent",
      }}>
        {/* Left: [icon] [count] [tag] [body] */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0 }}>
          {(isErr || isWrn) && (
            <span style={{ flexShrink: 0, display: "flex", paddingTop: 2 }}>
              <WarningCircle size={12} weight="fill" style={{ color: isErr ? ERROR_TEXT : WARN_TEXT }} />
            </span>
          )}
          {isDup && (
            <span style={{
              flexShrink: 0, padding: "0 5px", borderRadius: 8, fontSize: 9, fontWeight: 600, lineHeight: "16px",
              background: isErr ? "rgba(220,38,38,0.12)" : isWrn ? "rgba(100,116,139,0.12)" : "rgba(37,99,235,0.08)",
              color: isErr ? ERROR_TEXT : isWrn ? WARN_TEXT : PRIMARY,
            }}>
              ×{entry.count}
            </span>
          )}
          {p.tag && tc && (
            <span style={{ flexShrink: 0, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, lineHeight: "16px", background: tc.bg, color: tc.text, whiteSpace: "nowrap" }}>
              {p.tag}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: "18px", whiteSpace: "pre-wrap", overflowWrap: "break-word", color: isErr ? ERROR_TEXT : isWrn ? WARN_TEXT : TEXT }}>
            {hl.length > 0 ? <HL text={p.body} ranges={hl} /> : p.body}
          </span>
        </div>

        {/* Right: [copy] [timestamp] */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => void copyEntry(entry)}
            style={{ color: copiedKey === entry.key ? SUCCESS : TEXT_MUTED, background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: copiedKey === entry.key ? 1 : 0, transition: "opacity 0.15s" }}
            onMouseEnter={e => { if (copiedKey !== entry.key) e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={e => { if (copiedKey !== entry.key) e.currentTarget.style.opacity = "0"; }}
          >
            {copiedKey === entry.key ? <Check size={11} /> : <Copy size={11} />}
          </button>
          <span style={{ color: TEXT_MUTED, fontSize: 10, lineHeight: "18px", fontVariantNumeric: "tabular-nums", userSelect: "none", whiteSpace: "nowrap", ...s.mono }}>
            {formatConsoleTimestamp(entry.lastTimestamp)}
          </span>
        </div>
      </div>
    );
  };

  // ── Filter chip ─────────────────────────────────────────────
  const Chip = ({ level, label }: { level: LogLevel | "all"; label: string }) => {
    const count = level === "all" ? counts.total : counts[level] || 0;
    if (level !== "all" && count === 0) return null;
    const active = levelFilter === level;
    return (
      <button onClick={() => setLevelFilter(level)} style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 4, fontSize: 10, border: "none", cursor: "pointer",
        background: active ? PRIMARY_BG : "transparent", color: active ? PRIMARY : TEXT_DIM,
        fontWeight: active ? 600 : 400, transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.5, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      </button>
    );
  };

  // ── Main ────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        <Chip level="all" label="全部" />
        <Chip level="error" label={LEVEL_LABELS.error} />
        <Chip level="warn" label={LEVEL_LABELS.warn} />
        <Chip level="log" label={LEVEL_LABELS.log} />
        <Chip level="info" label={LEVEL_LABELS.info} />
        <Chip level="debug" label={LEVEL_LABELS.debug} />
        <div style={{ width: 1, height: 14, background: BORDER, margin: "0 4px", flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 80, maxWidth: 200, position: "relative" }}>
          <MagnifyingGlass size={11} style={{ position: "absolute", left: 8, top: 7, color: TEXT_MUTED, pointerEvents: "none" }} />
          <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索..."
            style={{ width: "100%", height: 26, padding: "0 24px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#fff", color: TEXT, fontSize: 11, outline: "none", ...s.mono }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} style={{ position: "absolute", right: 6, top: 5, color: TEXT_MUTED, background: "none", border: "none", cursor: "pointer" }}>
              <X size={11} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
          {counts.error > 0 && (
            <button onClick={appendErrors} title="将报错添加到对话" style={{
              display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6,
              border: "none", background: "transparent", cursor: "pointer", color: SUCCESS, fontSize: 11, lineHeight: "20px",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(22,163,74,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <Sparkle size={10} weight="fill" />
              <span>添加到对话</span>
            </button>
          )}
          {!autoScroll && (
            <button onClick={goBottom} title="滚动到底部" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
              borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: TEXT_MUTED,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.06)"; e.currentTarget.style.color = TEXT; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_MUTED; }}
            ><ArrowDown size={12} /></button>
          )}
          <button onClick={clear} title="清除日志" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
            borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: TEXT_MUTED,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.06)"; e.currentTarget.style.color = TEXT; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_MUTED; }}
          ><Trash size={12} /></button>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflow: "auto", textAlign: "left" as const, width: "100%", ...s.mono }}>
        {filtered.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: TEXT_MUTED }}>
            {keywords.length > 0 ? t("console.noMatch") : "暂无日志"}
          </div>
        ) : (
          <>
            {hasMore && (
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <button onClick={showMore} style={{
                  padding: "3px 16px", borderRadius: 6, fontSize: 11, border: `1px solid ${BORDER}`,
                  background: "#fff", cursor: "pointer", color: PRIMARY,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = PRIMARY_BG; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                >
                  显示更多 ({totalFiltered - visibleCount} 条)
                </button>
              </div>
            )}
            {visible.map(entry => renderEntry(entry))}
          </>
        )}
      </div>

      {/* ── REPL 调试输入栏 ──────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 32,
        borderTop: `1px solid ${BORDER}`, flexShrink: 0, background: SURFACE,
      }}>
        <span style={{ color: PRIMARY, fontSize: 12, fontWeight: 600, flexShrink: 0, userSelect: "none", ...s.mono }}>{">"}</span>
        <input
          ref={replRef}
          value={replInput}
          onChange={e => setReplInput(e.target.value)}
          onKeyDown={handleReplKeyDown}
          placeholder="输入 JavaScript 表达式，按 Enter 执行..."
          style={{
            flex: 1, height: 24, padding: "0 4px", border: "none", background: "transparent",
            color: TEXT, fontSize: 12, outline: "none", ...s.mono,
          }}
        />
        {replHistory.length > 0 && (
          <span style={{ color: TEXT_MUTED, fontSize: 9, flexShrink: 0, userSelect: "none" }}>
            {replHistory.length} 条历史
          </span>
        )}
      </div>
    </div>
  );
}
