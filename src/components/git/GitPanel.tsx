"use client";

import { useState, useCallback } from "react";
import { CaretDown, CaretRight, Plus } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useTranslation } from "@/hooks/useTranslation";
import { GitStatusSection } from "./GitStatusSection";
import { GitBranchSelector } from "./GitBranchSelector";
import { GitHistorySection } from "./GitHistorySection";
import { GitWorktreeSection } from "./GitWorktreeSection";
import { GitStashSection } from "./GitStashSection";
import { GitAiReview } from "./GitAiReview";
import { GitCommitDetailDialog } from "./GitCommitDetailDialog";
import { DeriveWorktreeDialog } from "./DeriveWorktreeDialog";
import { GitConfigDialog } from "./GitConfigDialog";

export function GitPanel() {
  const { workingDirectory, sessionId, setWorkingDirectory } = usePanel();
  const { t } = useTranslation();
  const { status, refresh } = useGitStatus(workingDirectory);

  // Collapsible sections
  const [statusOpen, setStatusOpen] = useState(true);
  const [branchOpen, setBranchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Dialogs
  const [commitDetailSha, setCommitDetailSha] = useState<string | null>(null);
  const [showDeriveDialog, setShowDeriveDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);

  const handleCheckout = useCallback(async (branch: string) => {
    const res = await fetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: workingDirectory, branch }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Checkout failed' }));
      throw new Error(data.error || 'Checkout failed');
    }
    refresh();
  }, [workingDirectory, refresh]);

  const repoName = workingDirectory.split('/').pop() || '';

  if (!status?.isRepo) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-6 space-y-4">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">{t('git.notARepo')}</h3>
          <p className="text-sm text-muted-foreground max-w-[280px]">
            {t('git.notARepoDesc')}
          </p>
        </div>
        <Button
          onClick={() => setShowConfigDialog(true)}
          className="gap-2"
        >
          <Plus size={16} />
          {t('git.configureGit')}
        </Button>
        <GitConfigDialog
          open={showConfigDialog}
          onClose={() => setShowConfigDialog(false)}
          onConfigured={(newPath) => {
            setShowConfigDialog(false);
            if (newPath) {
              setWorkingDirectory(newPath);
            }
            setTimeout(() => {
              refresh();
              window.dispatchEvent(new CustomEvent('git-refresh'));
            }, 500);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Status section */}
      <CollapsibleSection
        title={t('git.statusSection')}
        open={statusOpen}
        onToggle={() => setStatusOpen(!statusOpen)}
      >
        <GitStatusSection status={status} />
      </CollapsibleSection>

      {/* AI Review section */}
      <CollapsibleSection
        title={t('git.aiReview')}
        open={aiOpen}
        onToggle={() => setAiOpen(!aiOpen)}
      >
        <GitAiReview
          cwd={workingDirectory}
          dirty={status.dirty}
        />
      </CollapsibleSection>

      {/* Stash section */}
      <CollapsibleSection
        title={t('git.stashSection')}
        open={stashOpen}
        onToggle={() => setStashOpen(!stashOpen)}
      >
        <GitStashSection cwd={workingDirectory} onRefresh={refresh} />
      </CollapsibleSection>

      {/* Branch section */}
      <CollapsibleSection
        title={t('git.branchSection')}
        open={branchOpen}
        onToggle={() => setBranchOpen(!branchOpen)}
      >
        <GitBranchSelector
          cwd={workingDirectory}
          currentBranch={status.branch}
          dirty={status.dirty}
          onCheckout={handleCheckout}
        />
      </CollapsibleSection>

      {/* History section */}
      <CollapsibleSection
        title={t('git.historySection')}
        open={historyOpen}
        onToggle={() => setHistoryOpen(!historyOpen)}
      >
        <GitHistorySection
          cwd={workingDirectory}
          onSelectCommit={(sha) => setCommitDetailSha(sha)}
        />
      </CollapsibleSection>

      {/* Worktree section */}
      <CollapsibleSection
        title={t('git.worktreeSection')}
        open={worktreeOpen}
        onToggle={() => setWorktreeOpen(!worktreeOpen)}
      >
        <GitWorktreeSection
          cwd={workingDirectory}
          onDeriveWorktree={() => setShowDeriveDialog(true)}
        />
      </CollapsibleSection>

      {/* Dialogs */}
      {commitDetailSha && (
        <GitCommitDetailDialog
          cwd={workingDirectory}
          sha={commitDetailSha}
          onClose={() => setCommitDetailSha(null)}
        />
      )}
      {showDeriveDialog && (
        <DeriveWorktreeDialog
          cwd={workingDirectory}
          repoName={repoName}
          sessionId={sessionId}
          onClose={() => setShowDeriveDialog(false)}
        />
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/40">
      <button
        className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
        onClick={onToggle}
      >
        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        {title}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}
