'use client';

import { useRef, useState, useCallback, useEffect, Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowCounterClockwise, SpinnerGap } from '@phosphor-icons/react';
import type { Message } from '@/types';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { useStickToBottomContext } from "use-stick-to-bottom";
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';
import { CodePilotLogo } from './CodePilotLogo';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, RARITY_BG_GRADIENT, type Species, type Rarity } from '@/lib/buddy';

/**
 * Rewind button shown on user messages that have file checkpoints.
 */
function RewindButton({ sessionId, rewindTargetId }: { sessionId: string; rewindTargetId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'preview' | 'loading' | 'done'>('idle');
  const [preview, setPreview] = useState<{ filesChanged?: string[]; insertions?: number; deletions?: number } | null>(null);

  const handleDryRun = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId: rewindTargetId, dryRun: true }),
      });
      const data = await res.json();
      if (data.canRewind) {
        setPreview(data);
        setState('preview');
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, rewindTargetId]);

  const handleRewind = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId: rewindTargetId }),
      });
      const data = await res.json();
      if (data.canRewind !== false) {
        setState('done');
        setTimeout(() => setState('idle'), 3000);
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, rewindTargetId]);

  if (state === 'done') {
    return (
      <span className="text-[10px] text-status-success-foreground ml-2">
        {t('messageList.rewindDone' as TranslationKey)}
      </span>
    );
  }

  if (state === 'preview' && preview) {
    return (
      <span className="inline-flex items-center gap-1.5 ml-2">
        <span className="text-[10px] text-muted-foreground">
          {preview.filesChanged?.length || 0} files, +{preview.insertions || 0}/-{preview.deletions || 0}
        </span>
        <Button
          variant="link"
          size="xs"
          onClick={handleRewind}
          className="text-[10px] text-primary h-auto p-0"
        >
          {t('messageList.rewindConfirm' as TranslationKey)}
        </Button>
        <Button
          variant="link"
          size="xs"
          onClick={() => setState('idle')}
          className="text-[10px] text-muted-foreground h-auto p-0"
        >
          {t('messageList.rewindCancel' as TranslationKey)}
        </Button>
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleDryRun}
            disabled={state === 'loading'}
            className="ml-2 text-muted-foreground/70 hover:text-foreground"
            aria-label={t('messageList.rewindToHere' as TranslationKey)}
          >
            {state === 'loading' ? <SpinnerGap size={12} className="animate-spin" /> : <ArrowCounterClockwise size={12} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t('messageList.rewindToHere' as TranslationKey)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
  parentAgentId?: string;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  parentAgentId?: string;
}

/** Sub-agent tracking info for nested timeline display */
interface SubAgentInfo {
  id: string;
  name: string;
  displayName: string;
  prompt: string;
  status: 'running' | 'completed' | 'error';
  report?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  progress?: string;
  source?: 'omc_plugin' | 'sdk_agent_tool' | 'native_agent_tool' | 'native_team_runner' | 'unknown';
}

/** Rewind points contain SDK UUIDs (not local message IDs) */
interface RewindPoint {
  userMessageId: string; // SDK UUID
}

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  streamingThinkingContent?: string;
  referencedContexts?: string[];
  statusText?: string;
  statusPayload?: Record<string, any>;
  onForceStop?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** SDK rewind points — only emitted for visible prompt-level user messages (not tool results or auto-triggers), mapped by position */
  rewindPoints?: RewindPoint[];
  sessionId?: string;
  startedAt?: number;
  /** Whether this is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Assistant name for avatar display */
  assistantName?: string;
  hasSummary?: boolean;
  summaryBoundaryRowid?: number;
  isContextCompressing?: boolean;
  // 中文注释：功能名称「子Agent快照数据」，用法是从streamSnapshot传入子Agent数据，
  // 使StreamingMessage在切换会话后能恢复卡片渲染
  subAgents?: any[];
}

function getRewindTargetForMessage(messages: Message[], rewindPoints: RewindPoint[], message: Message): string | undefined {
  if (message.role === 'user') {
    const userMessages = messages.filter((m) => m.role === 'user');
    const userIndex = userMessages.indexOf(message);
    if (userIndex >= 0 && userIndex < rewindPoints.length) {
      return rewindPoints[userIndex].userMessageId;
    }
    return message.id;
  }

  const assistantIndex = messages.indexOf(message);
  if (assistantIndex < 0) return undefined;

  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const previous = messages[i];
    if (previous.role === 'user') {
      return getRewindTargetForMessage(messages, rewindPoints, previous);
    }
  }

  return undefined;
}

/**
 * Helper component to force scroll to bottom when new messages are added.
 * This ensures the user's just-sent message or the AI's first response
 * is immediately visible, even if layout shifts (like input shrinking) occur.
 */
function ScrollToBottomHelper({ messageCount }: { messageCount: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const lastCountRef = useRef(messageCount);

  useEffect(() => {
    if (messageCount > lastCountRef.current) {
      // Small delay to ensure layout has settled (e.g. MessageInput shrunk)
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 50);
      return () => clearTimeout(timer);
    }
    lastCountRef.current = messageCount;
  }, [messageCount, scrollToBottom]);

  return null;
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  streamingThinkingContent,
  referencedContexts,
  statusText,
  statusPayload,
  onForceStop,
  hasMore,
  loadingMore,
  onLoadMore,
  rewindPoints = [],
  sessionId,
  startedAt,
  isAssistantProject,
  assistantName,
  hasSummary,
  summaryBoundaryRowid,
  isContextCompressing,
  subAgents,
}: MessageListProps) {
  const { t } = useTranslation();
  // Scroll anchor: preserve position when older messages are prepended
  const anchorIdRef = useRef<string | null>(null);
  // Before loading more, record the first visible message ID
  const handleLoadMore = () => {
    if (messages.length > 0) {
      anchorIdRef.current = messages[0].id;
    }
    onLoadMore?.();
  };

  // After messages are prepended, scroll the anchor element back into view.
  // Uses the anchor ID (set before loading) rather than a length comparison,
  // because a capped prepend can swap messages without changing total count.
  useEffect(() => {
    if (anchorIdRef.current) {
      const el = document.getElementById(`msg-${anchorIdRef.current}`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
      }
      anchorIdRef.current = null;
    }
  }, [messages]);

  if (messages.length === 0 && !isStreaming) {
    if (isAssistantProject) {
      // Assistant workspace — show buddy or egg welcome
      const buddyInfo = typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>).__codepilot_buddy_info__ as { species?: string; rarity?: string } | undefined
        : undefined;
      const hasBuddy = !!buddyInfo?.species;
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            {hasBuddy ? (
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: RARITY_BG_GRADIENT[buddyInfo!.rarity as Rarity] || '' }}
              >
                <img
                  src={SPECIES_IMAGE_URL[buddyInfo!.species as Species] || ''}
                  alt="" width={64} height={64} className="drop-shadow-md"
                />
              </div>
            ) : (
              <img src={EGG_IMAGE_URL} alt="" width={64} height={64} className="drop-shadow-md" />
            )}
            <div className="space-y-1">
              <h3 className="font-medium text-sm">
                {hasBuddy
                  ? (assistantName || t('messageList.claudeChat'))
                  : t('buddy.adoptPrompt' as TranslationKey)}
              </h3>
              <p className="text-muted-foreground text-sm">
                {hasBuddy
                  ? t('messageList.emptyDescription')
                  : t('buddy.adoptDescription' as TranslationKey)}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title={t('messageList.claudeChat')}
          description={t('messageList.emptyDescription')}
          icon={<CodePilotLogo className="h-16 w-16" />}
        />
      </div>
    );
  }

  return (
    <Conversation>
      <ScrollToBottomHelper messageCount={messages.length + (isStreaming ? 1 : 0)} />
      <ConversationContent className="mx-auto max-w-3xl px-4 py-6 gap-6">
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="text-muted-foreground hover:text-foreground"
            >
              {loadingMore ? t('messageList.loading') : t('messageList.loadEarlier')}
            </Button>
          </div>
        )}
        <ContextCompressionDivider
          messages={messages}
          boundaryRowid={summaryBoundaryRowid || 0}
          hasSummary={!!hasSummary}
          isCompressing={!!isContextCompressing}
        >
          {({ dividerIndex }) => (
            <>
              {messages.map((message, idx) => {
                const rewindTargetId = sessionId ? getRewindTargetForMessage(messages, rewindPoints, message) : undefined;

                return (
                  <Fragment key={message.id}>
                    {idx === dividerIndex && (
                      <DividerRow label={t((isContextCompressing ? 'context.compressing' : 'context.compressed') as TranslationKey)} spinning={!!isContextCompressing} />
                    )}
                    <div id={`msg-${message.id}`} className="group">
                      <MessageItem
                        message={message}
                        sessionId={sessionId}
                        rewindUserMessageId={message.role === 'assistant' ? rewindTargetId : undefined}
                        isAssistantProject={isAssistantProject}
                        assistantName={assistantName}
                      />
                      {message.role === 'user' && rewindTargetId && sessionId && !isStreaming && (
                        <RewindButton sessionId={sessionId} rewindTargetId={rewindTargetId} />
                      )}
                    </div>
                  </Fragment>
                );
              })}
              {dividerIndex === messages.length && (
                <DividerRow label={t((isContextCompressing ? 'context.compressing' : 'context.compressed') as TranslationKey)} spinning={!!isContextCompressing} />
              )}
            </>
          )}
        </ContextCompressionDivider>

        {isStreaming && (
          <StreamingMessage
            content={streamingContent}
            isStreaming={isStreaming}
            sessionId={sessionId}
            rewindUserMessageId={messages.length > 0 ? getRewindTargetForMessage(messages, rewindPoints, messages[messages.length - 1]) : undefined}
            startedAt={startedAt!}
            toolUses={toolUses}
            toolResults={toolResults}
            streamingToolOutput={streamingToolOutput}
            referencedFiles={referencedContexts}
            statusPayload={statusPayload}
            thinkingContent={streamingThinkingContent}
            statusText={statusText}
            onForceStop={onForceStop}
            subAgents={subAgents}
          />
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function DividerRow({ label, spinning }: { label: string; spinning: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border/50" />
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground/70">
        {spinning && <SpinnerGap size={14} className="animate-spin" />}
        <span>{label}</span>
      </div>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  );
}

function ContextCompressionDivider({
  children,
  messages,
  boundaryRowid,
  hasSummary,
  isCompressing,
}: {
  children: (args: { dividerIndex: number }) => ReactNode;
  messages: Message[];
  boundaryRowid: number;
  hasSummary: boolean;
  isCompressing: boolean;
}) {
  const dividerIndex = useMemo(() => {
    if (isCompressing) return 0;
    if (!hasSummary) return -1;
    if (boundaryRowid <= 0) return 0;
    const idx = messages.findIndex((m) => (m._rowid ?? Number.POSITIVE_INFINITY) > boundaryRowid);
    return idx === -1 ? messages.length : idx;
  }, [boundaryRowid, hasSummary, isCompressing, messages]);

  return <>{children({ dividerIndex })}</>;
}
