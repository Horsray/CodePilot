"use client";

import { useState, useEffect, useMemo } from "react";
import { X } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface GitDiffViewerProps {
  cwd: string;
  filePath: string;
  staged: boolean;
  onClose: () => void;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(raw: string): { lines: DiffLine[]; additions: number; deletions: number } {
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      additions++;
      lines.push({ type: "add", content: line.slice(1), newNum: newLine++ });
    } else if (line.startsWith("-")) {
      deletions++;
      lines.push({ type: "remove", content: line.slice(1), oldNum: oldLine++ });
    } else if (line.startsWith(" ")) {
      lines.push({ type: "context", content: line.slice(1), oldNum: oldLine++, newNum: newLine++ });
    } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      lines.push({ type: "header", content: line });
    }
  }

  return { lines, additions, deletions };
}

export function GitDiffViewer({ cwd, filePath, staged, onClose }: GitDiffViewerProps) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ cwd, file: filePath, staged: String(staged) });
    fetch(`/api/git/diff?${params}`)
      .then((r) => r.json())
      .then((data) => setRaw(data.diff || ""))
      .catch(() => setRaw(""))
      .finally(() => setLoading(false));
  }, [cwd, filePath, staged]);

  const parsed = useMemo(() => (raw ? parseDiff(raw) : null), [raw]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[90vw] max-w-[800px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{filePath}</span>
            {parsed && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                <span className="text-green-500">+{parsed.additions}</span>
                {" / "}
                <span className="text-red-500">-{parsed.deletions}</span>
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto font-mono text-[12px] leading-[1.6]">
          {loading && (
            <div className="p-4 text-muted-foreground text-center">{t("git.aiGenerating")}</div>
          )}
          {!loading && (!parsed || parsed.lines.length === 0) && (
            <div className="p-4 text-muted-foreground text-center">{t("git.noDiff")}</div>
          )}
          {parsed &&
            parsed.lines.map((line, i) => {
              let bg = "";
              let textColor = "text-foreground/80";
              if (line.type === "add") {
                bg = "bg-green-500/10";
                textColor = "text-green-700 dark:text-green-400";
              } else if (line.type === "remove") {
                bg = "bg-red-500/10";
                textColor = "text-red-700 dark:text-red-400";
              } else if (line.type === "header") {
                bg = "bg-blue-500/10";
                textColor = "text-blue-600 dark:text-blue-400";
              }

              return (
                <div key={i} className={`flex ${bg} hover:brightness-95 dark:hover:brightness-110`}>
                  <span className="w-[50px] shrink-0 text-right pr-2 text-muted-foreground/60 select-none border-r border-border/30">
                    {line.oldNum ?? ""}
                  </span>
                  <span className="w-[50px] shrink-0 text-right pr-2 text-muted-foreground/60 select-none border-r border-border/30">
                    {line.newNum ?? ""}
                  </span>
                  <span className="w-[16px] shrink-0 text-center select-none text-muted-foreground/60">
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  <span className={`flex-1 px-2 whitespace-pre ${textColor}`}>{line.content}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
