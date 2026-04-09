'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';

const ANNOUNCEMENT_KEY = 'codepilot:announcement:v0.48-agent-engine';

export function FeatureAnnouncementDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem(ANNOUNCEMENT_KEY)) {
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setOpen(false);
    localStorage.setItem(ANNOUNCEMENT_KEY, '1');
  };

  const handleGoToSettings = () => {
    handleDismiss();
    router.push('/settings#cli');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isZh ? '新版本更新' : "What's New"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {isZh
              ? <>本次更新涉及底层架构变更，如遇问题请到 <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a> 反馈。</>
              : <>This update involves architectural changes. Report issues on <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a>.</>
            }
          </div>

          {isZh ? (
            <>
              <p className="font-medium">双引擎可选</p>
              <p className="text-muted-foreground">你可以在两种 Agent 引擎之间切换：<span className="text-foreground">AI SDK</span>（开箱即用，支持多个模型服务商）和 <span className="text-foreground">Claude Code</span>（需安装 CLI，提供完整命令行能力）。</p>
              <p className="font-medium">OpenAI 模型支持</p>
              <p className="text-muted-foreground">ChatGPT Plus/Pro 用户可通过 OAuth 登录后使用 GPT-5.4 等模型。</p>
            </>
          ) : (
            <>
              <p className="font-medium">Dual Engine Support</p>
              <p className="text-muted-foreground">Switch between two Agent engines: <span className="text-foreground">AI SDK</span> (works out of the box, multi-provider) and <span className="text-foreground">Claude Code</span> (requires CLI, full command-line capabilities).</p>
              <p className="font-medium">OpenAI Models</p>
              <p className="text-muted-foreground">ChatGPT Plus/Pro users can sign in via OAuth to use GPT-5.4 and more.</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" size="sm" onClick={handleGoToSettings}>
            {isZh ? '前往设置' : 'Go to Settings'}
          </Button>
          <Button size="sm" onClick={handleDismiss}>
            {isZh ? '知道了' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
