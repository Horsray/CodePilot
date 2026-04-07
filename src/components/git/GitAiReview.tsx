"use client";

import { useState, useCallback } from "react";
import { Sparkle, ArrowClockwise, CloudArrowUp, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

interface GitAiReviewProps {
  cwd: string;
  dirty: boolean;
}

export function GitAiReview({ cwd, dirty }: GitAiReviewProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [committing, setCommitting] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!cwd || loading || !dirty) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "summary" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("git.aiError"));
      }
      const data = await res.json();
      setCommitMessage(data.result || "");
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t("git.aiError") });
    } finally {
      setLoading(false);
    }
  }, [cwd, loading, dirty, t]);

  const handleCommitAndPush = useCallback(async () => {
    if (!cwd || !commitMessage.trim() || committing) return;
    setCommitting(true);
    try {
      // Stage all changes
      const stageRes = await fetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, paths: [], all: true }),
      });
      if (!stageRes.ok) {
        const data = await stageRes.json().catch(() => ({}));
        throw new Error(data.error || 'Stage failed');
      }

      // Commit
      const commitRes = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, message: commitMessage.trim() }),
      });
      if (!commitRes.ok) {
        const data = await commitRes.json().catch(() => ({}));
        throw new Error(data.error || 'Commit failed');
      }

      // Push
      const pushRes = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd }),
      });
      if (!pushRes.ok) {
        const data = await pushRes.json().catch(() => ({}));
        throw new Error(data.error || 'Push failed');
      }

      showToast({ type: "success", message: "提交并推送成功" });
      setCommitMessage("");
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : '提交失败' });
    } finally {
      setCommitting(false);
    }
  }, [cwd, commitMessage, committing]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  // 如果没有生成内容，显示大按钮
  if (!commitMessage && !loading) {
    return (
      <div className="px-3 py-2">
        {!dirty && (
          <p className="text-[11px] text-muted-foreground py-1 mb-2">
            {t("git.aiNoChanges")}
          </p>
        )}
        <Button
          size="default"
          className="w-full h-9 text-sm gap-2"
          onClick={handleGenerate}
          disabled={!dirty || loading}
        >
          <Sparkle size={16} />
          总结并提交
        </Button>
      </div>
    );
  }

  // 生成中状态
  if (loading) {
    return (
      <div className="px-3 py-4">
        <div className="flex items-center justify-center py-3">
          <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t("git.aiGenerating")}</span>
        </div>
      </div>
    );
  }

  // 显示生成的提交信息和操作按钮
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">提交信息（可编辑）</label>
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          className="w-full min-h-[80px] max-h-[150px] p-2 text-xs bg-muted/50 rounded-md border border-border/50 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="输入提交信息..."
        />
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleCommitAndPush}
          disabled={!commitMessage.trim() || committing}
        >
          {committing ? (
            <SpinnerGap size={14} className="animate-spin" />
          ) : (
            <CloudArrowUp size={14} />
          )}
          {committing ? "提交中..." : "提交并推送"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={handleRegenerate}
          disabled={loading}
        >
          <ArrowClockwise size={14} />
          重新生成
        </Button>
      </div>
    </div>
  );
}
