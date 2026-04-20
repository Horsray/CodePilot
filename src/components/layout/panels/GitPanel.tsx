"use client";

import { useState, useCallback } from "react";
import { X, ArrowClockwise, Plus, ArrowDown, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { GitPanel } from "@/components/git/GitPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GIT_MIN_WIDTH = 280;
const GIT_MAX_WIDTH = 600;
const GIT_DEFAULT_WIDTH = 360;

export function GitPanelContainer() {
  const { setGitPanelOpen, workingDirectory } = usePanel();
  const { t } = useTranslation();
  const [width, setWidth] = useState(GIT_DEFAULT_WIDTH);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);

  const handleResize = useCallback((delta: number) => {
    setWidth((w) => Math.min(GIT_MAX_WIDTH, Math.max(GIT_MIN_WIDTH, w - delta)));
  }, []);

  const handleRefresh = () => {
    window.dispatchEvent(new CustomEvent('git-refresh'));
  };

  const handlePull = useCallback(async () => {
    if (!workingDirectory || pulling) return;
    setPulling(true);
    try {
      const res = await fetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || t('git.pullFailed') });
        return;
      }
      showToast({ type: 'success', message: t('git.pullSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('git.pullFailed') });
    } finally {
      setPulling(false);
    }
  }, [workingDirectory, pulling, t]);

  const handleFetch = useCallback(async () => {
    if (!workingDirectory || fetching) return;
    setFetching(true);
    try {
      const res = await fetch('/api/git/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || t('git.fetchFailed') });
        return;
      }
      showToast({ type: 'success', message: t('git.fetchSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('git.fetchFailed') });
    } finally {
      setFetching(false);
    }
  }, [workingDirectory, fetching, t]);

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('git.title')}
          </span>
          <div className="flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pulling || fetching}
                >
                  {(pulling || fetching) ? <SpinnerGap size={14} className="animate-spin" /> : <Plus size={14} />}
                  <span className="sr-only">操作</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={handlePull} disabled={pulling} className="text-xs">
                  <ArrowDown size={14} className="mr-2" />
                  {pulling ? t('git.pulling') : '拉取到本地'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleFetch} disabled={fetching} className="text-xs">
                  <ArrowDown size={14} className="mr-2" />
                  {fetching ? t('git.fetching') : '获取到本地'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRefresh}
            >
              <ArrowClockwise size={14} />
              <span className="sr-only">{t('git.refresh')}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setGitPanelOpen(false)}
            >
              <X size={14} />
              <span className="sr-only">{t('common.close')}</span>
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <GitPanel />
        </div>
      </div>
    </div>
  );
}
