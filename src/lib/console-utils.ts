export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface SearchableConsoleEntry {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: number;
  source?: string;
}

export function parseSearchKeywords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
      continue;
    }
    merged.push(current);
  }

  return merged;
}

export function getHighlightRanges(text: string, keywords: string[]): Array<[number, number]> {
  if (!text || keywords.length === 0) {
    return [];
  }

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const keyword of keywords) {
    if (!keyword) continue;
    let start = 0;
    while (start < lower.length) {
      const found = lower.indexOf(keyword, start);
      if (found === -1) break;
      ranges.push([found, found + keyword.length]);
      start = found + Math.max(1, keyword.length);
    }
  }

  return mergeRanges(ranges);
}

export function isConsoleEntryMatched(entry: SearchableConsoleEntry, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }

  const searchable = `${entry.level} ${entry.message} ${entry.source || ""}`.toLowerCase();
  return keywords.every((keyword) => searchable.includes(keyword));
}

export function formatConsoleTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function formatConsoleEntryForCopy(entry: SearchableConsoleEntry): string {
  return `${formatConsoleTimestamp(entry.timestamp)} [${entry.level}] ${entry.message}${entry.source ? ` (${entry.source})` : ""}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
