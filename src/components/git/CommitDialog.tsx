"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, GitCommit } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface CommitDialogProps {
  cwd: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CommitDialog({ cwd, open, onClose, onSuccess }: CommitDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || !cwd || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Commit failed");
      }
      setMessage("");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }, [cwd, message, committing, onClose, onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[420px] rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">{t('git.commitAll')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('git.commitMessage')}
            className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!message.trim() || committing}
            onClick={handleSubmit}
          >
            <GitCommit size={14} className="mr-1.5" />
            {committing ? t('git.loading') : t('git.commitAll')}
          </Button>
        </div>
      </div>
    </div>
  );
}
