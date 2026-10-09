'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { getToolDisplayName } from '@/lib/tool-display-names';
import {
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Question, CheckCircle, PaperPlaneTilt } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { isAlwaysAskTool, isAskUserQuestionTool } from '@/lib/permission-checker';
import type { ToolUIPart } from 'ai';
import type { PermissionRequestEvent } from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface PermissionPromptProps {
  pendingPermission: PermissionRequestEvent | null;
  permissionResolved: 'allow' | 'deny' | null;
  onPermissionResponse: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => void;
  toolUses?: ToolUseInfo[];
  permissionProfile?: 'default' | 'full_access';
}

/** Max lines to show in the tool input area before collapsing */
const MAX_INPUT_LINES = 8;
const MAX_INPUT_CHARS = 500;

/**
 * AskUserQuestion 卡片 — 对齐 cc-haha 桌面版
 * （desktop/src/components/chat/AskUserQuestion.tsx）：
 * 头部图标 + 标题、多问题时的问题标签页（回答打勾 + 活动下划线）、
 * 选项卡式选项卡片（圆形/方形指示器 + 描述行）、自定义回复输入、
 * 底部提交栏；已提交后整卡降透明并显示「已回答: …」。
 */
export function AskUserQuestionUI({
  toolInput,
  onSubmit,
  resolved = false,
  resolvedAnswers,
}: {
  toolInput: Record<string, unknown>;
  onSubmit: (decision: 'allow', updatedInput: Record<string, unknown>) => void;
  resolved?: boolean;
  resolvedAnswers?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const questions = (toolInput.questions || []) as Array<{
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
    header?: string;
  }>;

  const [activeTab, setActiveTab] = useState(0);
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [customTexts, setCustomTexts] = useState<Record<number, string>>({});
  const [localSubmitted, setLocalSubmitted] = useState(false);
  const composingRef = useRef(false);

  if (questions.length === 0) return null;

  const submitted = resolved || localSubmitted;
  const safeTab = Math.min(activeTab, questions.length - 1);
  const activeQuestion = questions[safeTab];

  // 单题答案：自定义回复优先，否则为已选选项（多选以 ', ' 连接）
  const answerOf = (i: number): string => {
    const custom = customTexts[i]?.trim();
    if (custom) return custom;
    return (selections[i] || []).join(', ');
  };

  // 所有问题都作答后才能提交（缺失的问题会变成空答案，模型会误以为访谈已结束）
  const allAnswered = questions.every((_, i) => !!answerOf(i));

  const answeredText = questions
    .map((q, i) => (submitted && resolvedAnswers?.[q.question]) || answerOf(i))
    .filter((a) => !!a)
    .join(', ');

  const toggleOption = (qIdx: number, label: string, multi: boolean) => {
    if (submitted) return;
    setSelections((prev) => {
      const current = prev[qIdx] || [];
      let next: string[];
      if (multi) {
        next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
      } else {
        next = current.includes(label) ? [] : [label];
      }
      return { ...prev, [qIdx]: next };
    });
    // 选择选项即清除该题的自定义回复（两者互斥）
    setCustomTexts((prev) => ({ ...prev, [qIdx]: '' }));
  };

  const handleSubmit = () => {
    if (submitted || !allAnswered) return;
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => { answers[q.question] = answerOf(i); });
    console.log('[AskUserQuestionUI] submit:', {
      questionCount: questions.length,
      answers,
      fullPayload: { questions: toolInput.questions, answers },
    });
    setLocalSubmitted(true);
    onSubmit('allow', { questions: toolInput.questions, answers });
  };

  return (
    <div className={cn(
      "overflow-hidden rounded-[var(--radius-lg)] border transition-colors",
      submitted
        ? "border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-low)] opacity-70"
        : "border-[var(--color-secondary-brand)] bg-[var(--color-surface-container-lowest)]"
    )}>
      {/* 头部：图标 + 标题（+ 已回答徽标） */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-3",
        submitted ? "bg-[var(--color-surface-container-low)]" : "bg-[var(--color-surface-container)]"
      )}>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-secondary-brand)]/10">
          <Question size={18} className="text-[var(--color-secondary-brand)]" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('question.needsInput')}
          </span>
          {submitted && (
            <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {t('question.answered')}
            </span>
          )}
        </div>
      </div>

      {/* 问题标签页（仅多问题时显示） */}
      {questions.length > 1 && (
        <div className="flex overflow-x-auto border-b border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-4">
          {questions.map((q, i) => {
            const isActive = safeTab === i;
            const isAnswered = !!answerOf(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveTab(i)}
                className={cn(
                  "relative flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-xs font-medium transition-colors",
                  isActive
                    ? 'text-[var(--color-secondary-brand)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                )}
              >
                {isAnswered && <CheckCircle size={14} className="text-[var(--color-success)]" />}
                {q.header || `Q${i + 1}`}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t bg-[var(--color-secondary-brand)]" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 当前问题内容 */}
      <div className="px-4 py-3">
        <p className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">{activeQuestion.question}</p>

        {activeQuestion.options.length > 0 && (
          <div className="mb-3 space-y-2">
            {activeQuestion.options.map((opt) => {
              const isSelected = (selections[safeTab] || []).includes(opt.label);
              const multi = !!activeQuestion.multiSelect;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(safeTab, opt.label, multi)}
                  disabled={submitted}
                  className={cn(
                    "w-full rounded-[var(--radius-md)] border px-4 py-3 text-left transition-all duration-150",
                    isSelected
                      ? 'border-[var(--color-secondary-brand)] bg-[var(--color-secondary-brand)]/8 ring-1 ring-[var(--color-secondary-brand)]/30'
                      : 'border-[var(--color-outline-variant)]/40 bg-[var(--surface)] hover:border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container-low)]',
                    submitted ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center border-2 transition-colors",
                      multi ? 'rounded-[4px]' : 'rounded-full',
                      isSelected
                        ? 'border-[var(--color-secondary-brand)] bg-[var(--color-secondary-brand)]'
                        : 'border-[var(--color-outline)]'
                    )}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn(
                        "block text-sm font-medium",
                        isSelected ? 'text-[var(--color-secondary-brand)]' : 'text-[var(--color-text-primary)]'
                      )}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 自定义回复 */}
        {!submitted && (
          <div>
            <label className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">
              {t('question.customResponse')}
            </label>
            <input
              type="text"
              value={customTexts[safeTab] || ''}
              onChange={(e) => {
                const value = e.target.value;
                setCustomTexts((prev) => ({ ...prev, [safeTab]: value }));
                // 输入非空自定义回复时清除该题已选选项（对齐 cc-haha）
                if (value.trim()) setSelections((prev) => ({ ...prev, [safeTab]: [] }));
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(e) => {
                // 中文输入法组合期间的回车不触发提交
                if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && allAnswered) handleSubmit();
              }}
              placeholder={t('question.typePlaceholder')}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-outline-variant)]/40 bg-[var(--surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-secondary-brand)] focus:outline-none focus:ring-1 focus:ring-[var(--color-secondary-brand)]/30"
            />
          </div>
        )}

        {/* 已回答展示 */}
        {submitted && (
          <div className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
            <CheckCircle size={14} className="mt-0.5 flex-shrink-0 text-[var(--color-success)]" />
            <span>
              {t('question.answeredPrefix')}
              <strong className="text-[var(--color-text-primary)]">{answeredText}</strong>
            </span>
          </div>
        )}
      </div>

      {/* 提交栏 */}
      {!submitted && (
        <div className="flex items-center gap-2 border-t border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-4 py-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[image:var(--gradient-btn-primary)] px-2 py-1 text-xs font-medium text-[var(--primary-foreground)] shadow-[var(--shadow-button-primary)] transition-colors duration-150 hover:bg-[image:var(--gradient-btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PaperPlaneTilt size={14} />
            {t('question.submit')}
          </button>
        </div>
      )}
    </div>
  );
}

function extractPlanFilePath(toolUses: ToolUseInfo[]): string | null {
  for (let i = toolUses.length - 1; i >= 0; i--) {
    const tool = toolUses[i];
    const input = tool.input as Record<string, unknown>;
    if ((tool.name === 'Write' || tool.name === 'Edit') && typeof input.file_path === 'string') {
      const fp = input.file_path;
      if (fp.endsWith('.md') && (fp.includes('plans/') || fp.includes('plans\\'))) {
        return fp;
      }
    }
  }
  return null;
}

function ExitPlanModeUI({
  toolInput,
  toolUses,
  onApprove,
  onDeny,
  onDenyWithMessage,
}: {
  toolInput: Record<string, unknown>;
  toolUses: ToolUseInfo[];
  onApprove: () => void;
  onDeny: () => void;
  onDenyWithMessage: (message: string) => void;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const planFilePath = extractPlanFilePath(toolUses);
  const allowedPrompts = (toolInput.allowedPrompts || []) as Array<{
    tool: string;
    prompt: string;
  }>;

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span className="text-sm font-medium">Plan complete — ready to execute</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Requested permissions:</p>
          <ul className="space-y-0.5">
            {allowedPrompts.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p.tool}</span>
                <span>{p.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onDeny}
          className="text-xs"
        >
          Reject
        </Button>
        {planFilePath && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setPlanLoading(true);
              try {
                const res = await fetch(`/api/files/preview?path=${encodeURIComponent(planFilePath)}&maxLines=1000`);
                if (res.ok) {
                  const data = await res.json();
                  setPlanContent(data.preview?.content || 'Failed to load plan');
                } else {
                  setPlanContent('Failed to load plan file');
                }
              } catch {
                setPlanContent('Failed to load plan file');
              }
              setPlanLoading(false);
              setPlanOpen(true);
            }}
            disabled={planLoading}
            className="border-primary/30 text-xs text-primary hover:bg-primary/10"
          >
            {planLoading ? 'Loading...' : 'View Plan'}
          </Button>
        )}
        <Button
          size="sm"
          onClick={onApprove}
          className="text-xs"
        >
          Approve & Execute
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Provide feedback on the plan..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && feedback.trim()) {
              onDenyWithMessage(feedback.trim());
            }
          }}
          className="flex-1 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (feedback.trim()) onDenyWithMessage(feedback.trim());
          }}
          disabled={!feedback.trim()}
          className="text-xs"
        >
          Do this instead
        </Button>
      </div>

      {planOpen && planContent && (
        <Dialog open={planOpen} onOpenChange={setPlanOpen}>
          <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Plan</DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 min-h-0">
              <MessageResponse>{planContent}</MessageResponse>
            </div>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Collapsible tool input display with truncation for long content.
 */
function ToolInputDisplay({ input }: { input: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const formatToolInput = (inp: Record<string, unknown>): string => {
    // For Bash, show command prominently
    if (inp.command) {
      let cmd = String(inp.command);
      // 去除 AI SDK 自动添加的工作目录 cd 前缀
      cmd = cmd.replace(/^cd\s+(?:'[^']+'|"[^"]+"|[^&]+)\s*&&\s*/, '');
      
      // If there are other keys besides command/description, show full JSON
      const extraKeys = Object.keys(inp).filter(k => k !== 'command' && k !== 'description');
      if (extraKeys.length > 0) {
        return JSON.stringify({ ...inp, command: cmd }, null, 2);
      }
      return cmd;
    }
    // For Write/Edit, show the full input so content/old_string/new_string are visible
    if (inp.file_path) {
      const keys = Object.keys(inp);
      if (keys.length === 1) return String(inp.file_path);
      return JSON.stringify(inp, null, 2);
    }
    if (inp.path) {
      const keys = Object.keys(inp);
      if (keys.length === 1) return String(inp.path);
      return JSON.stringify(inp, null, 2);
    }
    return JSON.stringify(inp, null, 2);
  };

  const formatted = formatToolInput(input);
  const lineCount = formatted.split('\n').length;
  const isTruncated = lineCount > MAX_INPUT_LINES || formatted.length > MAX_INPUT_CHARS;

  const displayText = !expanded && isTruncated
    ? formatted.slice(0, MAX_INPUT_CHARS).split('\n').slice(0, MAX_INPUT_LINES).join('\n') + '\n…'
    : formatted;

  return (
    <div className="mt-1 overflow-hidden rounded bg-muted/50">
      <pre className={cn(
        "overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs",
        !expanded && "max-h-[10rem]"
      )}>
        {displayText}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full border-t border-border/30 px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          {expanded ? '▲ Collapse' : '▼ Show more'}
        </button>
      )}
    </div>
  );
}

export function PermissionPrompt({
  pendingPermission,
  permissionResolved,
  onPermissionResponse,
  toolUses = [],
  permissionProfile,
}: PermissionPromptProps) {
  const { t } = useTranslation();
  // 已提交的问答答案 — 用于提交后短暂展示「已回答: …」（对齐 cc-haha 卡片）
  const [lastAnswers, setLastAnswers] = useState<Record<string, string> | null>(null);

  // Tools that require user interaction even in full_access mode.
  // AskUserQuestion's entire purpose is to get user input — auto-approving
  // would return empty answers, defeating the purpose.
  // Auto-approve when full_access is active — except for interactive tools
  const autoApprovedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      permissionProfile === 'full_access' &&
      pendingPermission &&
      !permissionResolved &&
      autoApprovedRef.current !== pendingPermission.permissionRequestId &&
      !isAlwaysAskTool(pendingPermission.toolName)
    ) {
      autoApprovedRef.current = pendingPermission.permissionRequestId;
      onPermissionResponse('allow');
    }
  }, [permissionProfile, pendingPermission, permissionResolved, onPermissionResponse]);

  // Don't render permission UI when full_access — EXCEPT for interactive tools
  if (
    permissionProfile === 'full_access' &&
    (!pendingPermission || !isAlwaysAskTool(pendingPermission.toolName))
  ) {
    return null;
  }

  // Nothing to show
  if (!pendingPermission && !permissionResolved) return null;

  // Only show the resolved status text (not the full UI) when already resolved.
  // This prevents stacking — once resolved, we show a minimal status line that
  // auto-hides quickly (the stream-session-manager clears it after 1s).
  const isResolved = !!permissionResolved;

  // AskUserQuestion 使用独立的 cc-haha 卡片结构（头部/底部通栏），
  // 不再套通用权限卡的外层容器，避免卡片套卡片。
  if (pendingPermission && isAskUserQuestionTool(pendingPermission.toolName)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-3">
        <AskUserQuestionUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          resolved={isResolved}
          resolvedAnswers={lastAnswers ?? undefined}
          onSubmit={(decision, updatedInput) => {
            const answers = (updatedInput as { answers?: Record<string, string> }).answers;
            if (answers) setLastAnswers(answers);
            onPermissionResponse(decision, updatedInput);
          }}
        />
      </div>
    );
  }

  const getConfirmationState = (): ToolUIPart['state'] => {
    if (permissionResolved) return 'approval-responded';
    if (pendingPermission) return 'approval-requested';
    return 'input-available';
  };

  const getApproval = () => {
    if (!pendingPermission && !permissionResolved) return undefined;
    if (permissionResolved === 'allow') {
      return { id: pendingPermission?.permissionRequestId || '', approved: true as const };
    }
    if (permissionResolved === 'deny') {
      return { id: pendingPermission?.permissionRequestId || '', approved: false as const };
    }
    return { id: pendingPermission?.permissionRequestId || '' };
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-3">
      <div className="rounded-2xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-xl shadow-black/10 p-4 space-y-4">
      {/* ExitPlanMode */}
      {pendingPermission?.toolName === 'ExitPlanMode' && !isResolved && (
        <ExitPlanModeUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          toolUses={toolUses}
          onApprove={() => onPermissionResponse('allow')}
          onDeny={() => onPermissionResponse('deny')}
          onDenyWithMessage={(msg) => onPermissionResponse('deny', undefined, msg)}
        />
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'allow' && (
        <p className="py-1 text-xs text-status-success-foreground">Plan approved — executing</p>
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'deny' && (
        <p className="py-1 text-xs text-status-error-foreground">Plan rejected</p>
      )}

      {/* Generic confirmation for other tools — only show when not yet resolved */}
      {pendingPermission?.toolName !== 'ExitPlanMode' && pendingPermission && !isResolved && (
        <Confirmation
          approval={getApproval()}
          state={getConfirmationState()}
        >
          <ConfirmationTitle>
            <span className="font-medium">{getToolDisplayName(pendingPermission.toolName)}</span>
            {pendingPermission.decisionReason && (
              <span className="text-muted-foreground ml-2">
                — {pendingPermission.decisionReason}
              </span>
            )}
          </ConfirmationTitle>

          <ToolInputDisplay input={pendingPermission.toolInput} />

          <ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                onClick={() => onPermissionResponse('deny')}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                onClick={() => onPermissionResponse('allow')}
              >
                Allow Once
              </ConfirmationAction>
              {pendingPermission.suggestions && pendingPermission.suggestions.length > 0 && (
                <ConfirmationAction
                  variant="default"
                  onClick={() => onPermissionResponse('allow_session')}
                >
                  {t('streaming.allowForSession')}
                </ConfirmationAction>
              )}
            </ConfirmationActions>
          </ConfirmationRequest>

          <ConfirmationAccepted>
            <p className="text-xs text-status-success-foreground">{t('streaming.allowed')}</p>
          </ConfirmationAccepted>

          <ConfirmationRejected>
            <p className="text-xs text-status-error-foreground">{t('streaming.denied')}</p>
          </ConfirmationRejected>
        </Confirmation>
      )}

      {/* Resolved status for generic tools — minimal one-liner */}
      {pendingPermission?.toolName !== 'ExitPlanMode' && isResolved && (
        <p className={cn(
          "py-1 text-xs",
          permissionResolved === 'allow' ? 'text-status-success-foreground' : 'text-status-error-foreground'
        )}>
          {permissionResolved === 'allow' ? t('streaming.allowed') : t('streaming.denied')}
        </p>
      )}
      </div>
    </div>
  );
}
