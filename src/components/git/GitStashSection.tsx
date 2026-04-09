"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash, ArrowClockwise, Plus, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

interface GitStashSectionProps {
  cwd: string;
  onRefresh: () => void;
}

interface StashEntry {
  index: number;
  message: string;
}

export function GitStashSection({ cwd, onRefresh }: GitStashSectionProps) {
  const { t } = useTranslation();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const loadStashes = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/git/stash?cwd=${encodeURIComponent(cwd)}`);
      if (res.ok) {
        const data = await res.json();
        setStashes(data.stashes || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    loadStashes();
  }, [loadStashes]);

  const handleSave = useCallback(async () => {
    if (!cwd || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "save", message: message.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Stash failed");
      }
      showToast({ type: "success", message: t("git.stashSuccess") });
      setMessage("");
      loadStashes();
      onRefresh();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t("git.stashFailed") });
    } finally {
      setSaving(false);
    }
  }, [cwd, message, saving, t, loadStashes, onRefresh]);

  const handlePop = useCallback(async () => {
    try {
      const res = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "pop" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Pop failed");
      }
      showToast({ type: "success", message: t("git.stashPopSuccess") });
      loadStashes();
      onRefresh();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t("git.stashFailed") });
    }
  }, [cwd, t, loadStashes, onRefresh]);

  const handleDrop = useCallback(async (index: number) => {
    try {
      const res = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "drop", index }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Drop failed");
      }
      showToast({ type: "success", message: t("git.stashDropSuccess") });
      loadStashes();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t("git.stashFailed") });
    }
  }, [cwd, t, loadStashes]);

  return (
    <div className="space-y-2">
      {/* Save stash */}
      <div className="flex items-center gap-1.5 px-3">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("git.stashMessage")}
          className="h-7 text-xs flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 shrink-0"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <SpinnerGap size={12} className="animate-spin" /> : <Plus size={12} />}
          {t("git.stashSave")}
        </Button>
      </div>

      {/* Stash list */}
      {loading ? (
        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <SpinnerGap size={12} className="animate-spin" />
        </div>
      ) : stashes.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t("git.stashEmpty")}</div>
      ) : (
        <div className="max-h-[200px] overflow-y-auto">
          {stashes.map((stash) => (
            <div
              key={stash.index}
              className="flex items-center gap-2 px-3 py-1 text-[12px] hover:bg-muted/50 group"
            >
              <span className="text-muted-foreground font-mono shrink-0">#{stash.index}</span>
              <span className="truncate flex-1 text-foreground/80">{stash.message}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {stash.index === 0 && (
                  <button
                    onClick={() => handlePop()}
                    className="p-0.5 hover:bg-muted rounded text-green-600 dark:text-green-400"
                    title={t("git.stashPop")}
                  >
                    <ArrowClockwise size={12} />
                  </button>
                )}
                <button
                  onClick={() => handleDrop(stash.index)}
                  className="p-0.5 hover:bg-muted rounded text-red-500"
                  title={t("git.stashDrop")}
                >
                  <Trash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
