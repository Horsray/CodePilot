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
  compressionProgress?: { percentage: number; charsGenerated: number } | null;
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
 * 消息内容指纹 —— 判定"这条消息是否已经出现过"。
 *
 * 中文注释：刻意不用 message.id。一轮对话里同一条消息的节点会重挂载三次 ——
 * 用户消息 temp-* → DB id、流式容器 → 正式助手消息、助手消息 temp-* → DB id
 * （完成后 10s 的 DB 轮询替换）—— id 每次都变，内容一个字没变。按 id 判定会让
 * 同一块内容反复重放入场动画，观感就是"任务完成时界面刷新了一下"。
 * 只取前 80 个非空白字符：流式内容与落地后的正式消息必然以相同字符开头，
 * 因此流式结束的那次替换也会被认作"已见过"，完成瞬间不再整块淡入。
 */
function messageFingerprint(m: { role: string; content?: string | null }): string {
  return `${m.role}:${(m.content || '').replace(/\s+/g, '').slice(0, 80)}`;
}

/**
 * 单条消息行。
 *
 * 中文注释：入场动画只在「该内容首次挂载」时播放。所以用 useState 的惰性初始化器
 * 求值一次 —— 重挂载发生时该指纹已登记在 seen 里，初值即为 false，动画不会重放；
 * 而同一节点因其它原因重渲染时初值不变，动画也不会被打断。
 */
function MessageRow({
  message,
  seen,
  sessionId,
  rewindTargetId,
  isAssistantProject,
  assistantName,
  isStreaming,
}: {
  message: Message;
  seen: Set<string>;
  sessionId?: string;
  rewindTargetId?: string;
  isAssistantProject?: boolean;
  assistantName?: string;
  isStreaming?: boolean;
}) {
  const fp = messageFingerprint(message);
  // 中文注释：只有用户消息播放入场动画 —— 它是"瞬间出现"的，淡入能让它不显突兀。
  // 助手消息一律不播：它是流式逐渐长出来的、本身就有渐进过程，再叠一次整块淡入
  // 就成了用户反馈的"任务完成时界面还会刷新一下"。（历史加载/切会话恢复出来的
  // 消息同理不需要。）判定在挂载那一刻求值一次，重渲染不会打断进行中的动画。
  const [animate] = useState(() => message.role === 'user' && !seen.has(fp));
  useEffect(() => {
    seen.add(fp);
  }, [fp, seen]);

  return (
    <div id={`msg-${message.id}`} className={`group${animate ? ' animate-message-enter' : ''}`}>
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
  );
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
  compressionProgress,
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

  // 消息入场动画的判定 —— 详见 messageFingerprint 的注释。
  // 中文注释：基线取"当前已有消息"的指纹集合，首屏既有消息与向上翻历史加载的
  // 旧消息因此不会重放。是否真正播放由 MessageRow 在挂载那一刻判定。
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) {
    seenRef.current = new Set(messages.map(messageFingerprint));
  }
  const seen = seenRef.current;

  // temp-* → DB id 的替换中反复销毁重建，这正是"完成时界面刷新一下"的物理来源。
  // 指纹重复时（例如连发两条一模一样的消息）追加出现序号，避免 key 冲突。
  const stableKeys = (() => {
    const counts = new Map<string, number>();
    return messages.map((m) => {
      const fp = messageFingerprint(m);
      const n = counts.get(fp) ?? 0;
      counts.set(fp, n + 1);
      return n === 0 ? fp : `${fp}#${n}`;
    });
  })();

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
      {/* 中文注释：消息列 860px 居中；左右留白收紧到 16px，避免窄卡片下正文可用宽度不足 */}
      <ConversationContent className="mx-auto max-w-[860px] px-4 pt-4 pb-8 gap-5">
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
                  <Fragment key={stableKeys[idx]}>
                    {idx === dividerIndex && (
                      <DividerRow label={t((isContextCompressing ? 'context.compressing' : 'context.compressed') as TranslationKey)} spinning={!!isContextCompressing} progress={compressionProgress} />
                    )}
                    <MessageRow
                      message={message}
                      seen={seen}
                      sessionId={sessionId}
                      rewindTargetId={rewindTargetId}
                      isAssistantProject={isAssistantProject}
                      assistantName={assistantName}
                      isStreaming={isStreaming}
                    />
                  </Fragment>
                );
              })}
              {dividerIndex === messages.length && (
                <DividerRow label={t((isContextCompressing ? 'context.compressing' : 'context.compressed') as TranslationKey)} spinning={!!isContextCompressing} />
              )}
            </>
          )}
        </ContextCompressionDivider>

        {/* Compression progress bar — renders at the bottom of the conversation
            so it's visible to the user without scrolling to the top */}
        {isContextCompressing && (
          <DividerRow
            label={t('context.compressing' as TranslationKey)}
            spinning={true}
            progress={compressionProgress}
          />
        )}

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

function DividerRow({ label, spinning, progress }: { label: string; spinning: boolean; progress?: { percentage: number; charsGenerated: number } | null }) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/50" />
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/70">
          {spinning && <SpinnerGap size={14} className="animate-spin" />}
          <span>{label}</span>
          {spinning && (
            <span className="text-[11px] tabular-nums font-medium">{progress?.percentage ?? 0}%</span>
          )}
        </div>
        <div className="h-px flex-1 bg-border/50" />
      </div>
      {spinning && (
        <div className="mt-1.5 mx-auto max-w-md">
          <div className="h-[5px] w-full rounded-full overflow-hidden bg-muted/40">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progress?.percentage ?? 0}%`,
                background: 'linear-gradient(90deg, #8b5cf6, #06b6d4, #8b5cf6)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}
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
    // During active compression, don't render the divider inside the message
    // list — progress is shown at the bottom of the conversation instead.
    if (isCompressing) return -1;
    if (!hasSummary) return -1;
    if (boundaryRowid <= 0) return 0;
    const idx = messages.findIndex((m) => (m._rowid ?? Number.POSITIVE_INFINITY) > boundaryRowid);
    return idx === -1 ? messages.length : idx;
  }, [boundaryRowid, hasSummary, isCompressing, messages]);

  return <>{children({ dividerIndex })}</>;
}
