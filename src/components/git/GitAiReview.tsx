"use client";

import { useState, useCallback } from "react";
import { Sparkle, Copy, Check, ArrowClockwise, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

interface GitAiReviewProps {
  cwd: string;
  dirty: boolean;
  onUseCommitMessage?: (message: string) => void;
}

export function GitAiReview({ cwd, dirty, onUseCommitMessage }: GitAiReviewProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"summary" | "review" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAction = useCallback(async (type: "summary" | "review") => {
    if (!cwd || loading) return;
    setLoading(true);
    setAction(type);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/git/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("git.aiError"));
      }
      const data = await res.json();
      setResult(data.result || "");
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t("git.aiError") });
      setResult(null);
      setAction(null);
    } finally {
      setLoading(false);
    }
  }, [cwd, loading, t]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    showToast({ type: "success", message: t("git.aiCopied") });
    setTimeout(() => setCopied(false), 2000);
  }, [result, t]);

  const handleUseMessage = useCallback(() => {
    if (!result || !onUseCommitMessage) return;
    onUseCommitMessage(result);
    showToast({ type: "success", message: t("git.aiUseMessage") });
  }, [result, onUseCommitMessage, t]);

  return (
    <div className="space-y-2 px-3">
      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => handleAction("summary")}
          disabled={!dirty || loading}
        >
          <Sparkle size={12} />
          {loading && action === "summary" ? t("git.aiGenerating") : t("git.aiSummary")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => handleAction("review")}
          disabled={!dirty || loading}
        >
          <Sparkle size={12} />
          {loading && action === "review" ? t("git.aiGenerating") : t("git.aiReview")}
        </Button>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center justify-center py-3">
          <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Result */}
      {!loading && result !== null && (
        <div className="space-y-1.5">
          <div className="bg-muted/50 rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto border border-border/50">
            {result}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1 px-2"
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? t("git.aiCopied") : "Copy"}
            </Button>
            {action === "summary" && onUseCommitMessage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] gap-1 px-2"
                onClick={handleUseMessage}
              >
                <Check size={12} />
                {t("git.aiUseMessage")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1 px-2"
              onClick={() => handleAction(action!)}
            >
              <ArrowClockwise size={12} />
              {t("git.aiRegenerate")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
