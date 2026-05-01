'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getToolDisplayName } from '@/lib/tool-display-names';
import type { Message, MessagesResponse, FileAttachment, SessionStreamSnapshot, MentionRef, ProviderModelGroup, ClaudeInitMeta } from '@/types';
import { MessageList } from './MessageList';
import { TerminalReasonChip } from './TerminalReasonChip';
import { RateLimitBanner } from './RateLimitBanner';
import { MessageInput } from './MessageInput';
import { ChatComposerActionBar } from './ChatComposerActionBar';
import { ModeIndicator } from './ModeIndicator';
import { ChatPermissionSelector } from './ChatPermissionSelector';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { RuntimeBadge } from './RuntimeBadge';
import { SessionStatusIndicator } from './SessionStatusIndicator';
import { Button } from '@/components/ui/button';
import { SpinnerGap } from '@/components/ui/icon';
import { usePanel } from '@/hooks/usePanel';
import { usePanelStore } from '@/store/usePanelStore';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';
import { PermissionPrompt } from './PermissionPrompt';
import { FileReviewBar } from './FileReviewBar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BatchExecutionDashboard, BatchContextSync } from './batch-image-gen';
import { ContextWidgetPortal } from './context-widget/ContextWidgetPortal';
import { MemoryPanelPortal } from './context-widget/MemoryPanelPortal';
import { setLastGeneratedImages, loadLastGenerated } from '@/lib/image-ref-store';
import { useChatCommands } from '@/hooks/useChatCommands';
import { useAssistantTrigger } from '@/hooks/useAssistantTrigger';
import { useStreamSubscription } from '@/hooks/useStreamSubscription';
import { consumePendingSessionMessage, peekPendingSessionMessage } from '@/lib/pending-session-message';
import type { PendingSessionMessage } from '@/lib/pending-session-message';
import {
  getPendingFirstTurnStatusText,
  getPendingFirstTurnRemainingDelayMs,
  shouldReleasePendingFirstTurn,
} from '@/lib/first-turn-warmup';
import {
  startStream,
  stopStream,
  getSnapshot,
  getRewindPoints,
  respondToPermission,
  isStreamActive,
} from '@/lib/stream-session-manager';

interface QueuedMessage {
  clientMessageId?: string;
  content: string;
  files?: FileAttachment[];
  systemPromptAppend?: string;
  displayOverride?: string;
  mentions?: MentionRef[];
}

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
  initialHasMore?: boolean;
  modelName?: string;
  providerId?: string;
  warmupState?: 'idle' | 'warming' | 'ready' | 'failed';
  initialPermissionProfile?: 'default' | 'full_access';
  initialMode?: 'code' | 'plan';
  initialHasSummary?: boolean;
  initialSummaryBoundaryRowid?: number;
}

/** Maximum messages kept in React state. Older messages are trimmed and reloaded on scroll. */
const MAX_MESSAGES_IN_MEMORY = 300;
const MESSAGE_RECONCILE_INTERVAL_MS = 10000;

function stripLeadingFileComment(content: string): string {
  return content.replace(/^<!--files:.*?-->/, '');
}

function isOptimisticUserMessage(message: Message): boolean {
  return message.role === 'user' && message.id.startsWith('temp-');
}

function normalizedUserContent(content: string): string {
  return stripLeadingFileComment(content).trim();
}

export function ChatView({ sessionId, initialMessages = [], initialHasMore = false, modelName, providerId, warmupState = 'idle', initialPermissionProfile, initialMode, initialHasSummary, initialSummaryBoundaryRowid }: ChatViewProps) {
  const { setStreamingSessionId, workingDirectory, setPendingApprovalSessionId, setIsAssistantWorkspace } = usePanel();
  const { t } = useTranslation();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [pendingInitialMessage, setPendingInitialMessage] = useState<PendingSessionMessage | null>(() => peekPendingSessionMessage(sessionId));
  const [pendingInitialReleaseTick, setPendingInitialReleaseTick] = useState(0);
  const [runtimeWarmupState, setRuntimeWarmupState] = useState<'idle' | 'warming' | 'ready' | 'failed'>(warmupState);
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>(initialPermissionProfile || 'default');

  // Whether this session's working directory matches the configured assistant workspace
  const [isAssistantProject, setIsAssistantProject] = useState(false);
  const [assistantName, setAssistantName] = useState('');

  // Workspace mismatch banner state
  const [workspaceMismatchPath, setWorkspaceMismatchPath] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  /** Tracks whether the tail (newest messages) was trimmed during a prepend. */
  const tailTrimmedRef = useRef(false);

  /**
   * Capped message setter for append paths (user send, stream completion, commands).
   *
   * - Normal case: trims head (oldest) when exceeding cap, sets hasMore = true.
   * - If tail was previously trimmed by a prepend (user scrolled far up): re-fetches
   *   the latest messages from DB as a fresh base, then applies the append on top.
   *   This slides the window back to the bottom without losing the new message.
   */
  /**
   * Reconcile the message window with DB after tail was trimmed.
   * Preserves local-only cmd-* messages (/help, /cost) since they're never persisted.
   * Called with a delay to ensure pending persists have completed.
   */
  const reconcileWithDb = useCallback(() => {
    fetch(`/api/chat/sessions/${sessionId}/messages?limit=50`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.messages) return;
        setHasMore(data.hasMore ?? true);
        const dbMessages: Message[] = data.messages;
        setMessages(current => {
          const localCommands = current.filter(m => m.id.startsWith('cmd-'));
          const optimisticUsers = current.filter(isOptimisticUserMessage);
          const realMessages = current.filter(m => !m.id.startsWith('cmd-'));
          const dbUserKeys = new Set(
            dbMessages
              .filter((m) => m.role === 'user')
              .map((m) => normalizedUserContent(m.content))
          );
          const unmatchedOptimisticUsers = optimisticUsers.filter(
            (m) => !dbUserKeys.has(normalizedUserContent(m.content))
          );
          
          if (realMessages.length === 0) {
            const merged = [...dbMessages, ...unmatchedOptimisticUsers, ...localCommands];
            return merged.length > MAX_MESSAGES_IN_MEMORY
              ? merged.slice(-MAX_MESSAGES_IN_MEMORY)
              : merged;
          }

          // Check if we can safely merge by finding where dbMessages starts within current
          const firstDbMessage = dbMessages[0];
          if (firstDbMessage) {
            const overlapIdx = current.findIndex(m => m.id === firstDbMessage.id);
            if (overlapIdx !== -1) {
              // Replace everything from overlapIdx onwards with the fresh dbMessages, 
              // preserving local commands at the very end
              const base = current.slice(0, overlapIdx);
              const merged = [...base, ...dbMessages, ...unmatchedOptimisticUsers, ...localCommands];
              
              // Optimization: Check if the merged array is actually different from current
              // to avoid unnecessary React re-renders
              const isDifferent = merged.length !== current.length || 
                merged.some((m, i) => m.id !== current[i]?.id || m.content !== current[i]?.content);
                
              if (!isDifferent) return current;

              return merged.length > MAX_MESSAGES_IN_MEMORY
                ? merged.slice(-MAX_MESSAGES_IN_MEMORY)
                : merged;
            }
          }

          // If there's a huge gap or no overlap (e.g. tail was trimmed), replace entirely
          const merged = [...dbMessages, ...unmatchedOptimisticUsers, ...localCommands];
          return merged.length > MAX_MESSAGES_IN_MEMORY
            ? merged.slice(-MAX_MESSAGES_IN_MEMORY)
            : merged;
        });
      })
      .catch(() => { /* keep current state as-is */ });
  }, [sessionId, t]);

  const cappedSetMessages: typeof setMessages = useCallback((action) => {
    setMessages((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (next.length > MAX_MESSAGES_IN_MEMORY) {
        setHasMore(true);
        return next.slice(-MAX_MESSAGES_IN_MEMORY);
      }
      return next;
    });
  }, []);
  const [mode, setMode] = useState<'code' | 'plan'>(initialMode || 'code');
  const [currentModel, setCurrentModel] = useState(() => modelName || (typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') : null) || 'sonnet');
  const [currentProviderId, setCurrentProviderId] = useState(() => providerId || (typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') : null) || '');
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>('max');
  const [thinkingMode, setThinkingMode] = useState<string>('enabled'); // Deepseek 默认开启思考
  const [context1m, setContext1m] = useState(false);
  const [hasSummary, setHasSummary] = useState(initialHasSummary || false);
  const [summaryBoundaryRowid, setSummaryBoundaryRowid] = useState(initialSummaryBoundaryRowid || 0);

  // Sync model/provider when session data loads
  useEffect(() => { if (modelName) setCurrentModel(modelName); }, [modelName]);
  useEffect(() => { if (providerId) setCurrentProviderId(providerId); }, [providerId]);
  useEffect(() => { setRuntimeWarmupState(warmupState); }, [warmupState]);
  useEffect(() => { setSummaryBoundaryRowid(initialSummaryBoundaryRowid || 0); }, [initialSummaryBoundaryRowid]);

  // Fetch provider-specific options (with abort to prevent stale responses on fast switch)
  useEffect(() => {
    const pid = currentProviderId || 'env';
    const controller = new AbortController();
    fetch(`/api/providers/options?providerId=${encodeURIComponent(pid)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted) {
          setThinkingMode(data?.options?.thinking_mode || 'adaptive');
          setContext1m(!!data?.options?.context_1m);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [currentProviderId]);

  // Resolve model metadata for the current model/provider. The context
  // indicator uses contextWindow when the provider declares it, and falls
  // back to upstreamModelId for alias disambiguation.
  const [currentModelMeta, setCurrentModelMeta] = useState<{
    upstreamModelId?: string;
    contextWindow?: number;
  }>({});
  useEffect(() => {
    const pid = currentProviderId || 'env';
    const controller = new AbortController();
    fetch('/api/providers/models', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (controller.signal.aborted) return;
        const group = (data?.groups as ProviderModelGroup[] | undefined)?.find(g => g.provider_id === pid);
        const model = group?.models?.find(m => m.value === currentModel);
        setCurrentModelMeta({
          upstreamModelId: model?.upstreamModelId,
          contextWindow: model?.contextWindow,
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [currentProviderId, currentModel]);
  useEffect(() => { if (initialPermissionProfile) setPermissionProfile(initialPermissionProfile); }, [initialPermissionProfile]);

  // Restore session-scoped last-generated images from sessionStorage
  useEffect(() => { loadLastGenerated(sessionId); }, [sessionId]);

  // Stream snapshot from the manager — drives all streaming UI
  const [streamSnapshot, setStreamSnapshot] = useState<SessionStreamSnapshot | null>(
    () => getSnapshot(sessionId)
  );

  // Derive rendering state from snapshot
  const isStreaming = streamSnapshot?.phase === 'active';
  const streamingContent = streamSnapshot?.streamingContent ?? '';
  const toolUses = streamSnapshot?.toolUses ?? [];
  const toolResults = streamSnapshot?.toolResults ?? [];
  const streamingToolOutput = streamSnapshot?.streamingToolOutput ?? '';
  const streamingThinkingContent = streamSnapshot?.streamingThinkingContent ?? '';
  const referencedContexts = streamSnapshot?.referencedContexts;
  const toolFiles = streamSnapshot?.toolFiles ?? [];
  const statusText = streamSnapshot?.statusText;
  const pendingPermission = streamSnapshot?.pendingPermission ?? null;
  const permissionResolved = streamSnapshot?.permissionResolved ?? null;
  const rewindPoints = getRewindPoints(sessionId);
  const subAgents = streamSnapshot?.subAgents ?? [];
  const pendingInitialStatusText = !isStreaming
    ? getPendingFirstTurnStatusText(pendingInitialMessage, runtimeWarmupState)
    : null;

  // 中文注释：预热 effect — 当 sessionId 或 model/provider 变化时触发。
  // ⚠️ 不要把 isStreaming 放进依赖数组！isStreaming 变化会触发 cleanup → abort，
  // 中断正在进行中的 warmup fetch（需要 7-8 秒完成），导致预热永远无法完成。
  // guard 条件中的 isStreaming 检查已经足够：只在非流式状态下启动预热。
  useEffect(() => {
    if (!sessionId || !currentModel || isStreaming || isStreamActive(sessionId)) return;

    let cancelled = false;
    const controller = new AbortController();

    async function warmupRuntime() {
      try {
        setRuntimeWarmupState('warming');
        const res = await fetch('/api/chat/warmup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            model: currentModel,
            provider_id: currentProviderId,
          }),
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          setRuntimeWarmupState('failed');
          return;
        }
        const data = await res.json();
        setRuntimeWarmupState(data?.warmed_up ? 'ready' : 'failed');
      } catch {
        if (!cancelled) {
          setRuntimeWarmupState('failed');
        }
      }
    }

    warmupRuntime();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentModel, currentProviderId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId) {
        showToast({
          type: "success",
          message: `检测到高价值工作流（${detail.step || 0} 步 / ${detail.distinctToolCount || 0} 个工具）`,
          description: (detail.toolNames && detail.toolNames.length > 0)
            ? `包含工具：${detail.toolNames.slice(0, 6).map((n: string) => getToolDisplayName(n)).join('、')}${detail.toolNames.length > 6 ? ` 等 ${detail.toolNames.length} 个` : ''}`
            : "可将本次流程保存为 Skill，后续一键复用",
          action: {
            label: "保存为 Skill",
            onClick: () => sendMessageRef.current?.(t('skillNudge.savePrompt')),
          },
        });
      }
    };
    window.addEventListener('skill-nudge', handler);
    return () => window.removeEventListener('skill-nudge', handler);
  }, [sessionId, t]);

  // ── Message queue — allows sending while AI is responding ──
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const dequeuingRef = useRef(false);

  // Pending image generation notices
  const pendingImageNoticesRef = useRef<string[]>([]);
  const sendMessageRef = useRef<(content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[]) => Promise<void>>(undefined);
  const [sdkInitMeta, setSdkInitMeta] = useState<ClaudeInitMeta | null>(null);
  const initMetaRef = useRef<ClaudeInitMeta | null>(null);

  const handleModeChange = useCallback((newMode: string) => {
    if (newMode === 'ask') return; // Not supported in this view yet
    setMode(newMode as 'code' | 'plan');
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      }).then(() => {
        window.dispatchEvent(new CustomEvent('session-updated'));
      }).catch(() => { /* silent */ });

      fetch('/api/chat/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: newMode }),
      }).catch(() => { /* silent */ });
    }
  }, [sessionId]);

  const handleProviderModelChange = useCallback((newProviderId: string, model: string) => {
    setCurrentProviderId(newProviderId);
    setCurrentModel(model);
    fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider_id: newProviderId }),
    }).catch(() => {});
    // 中文注释：切换模型/provider 后触发预热，让 WarmQuery Store 中的签名与新模型匹配，
    // 避免下一轮消息因签名不匹配走冷启动
    fetch('/api/chat/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        model,
        provider_id: newProviderId,
      }),
    }).catch(() => {});
  }, [sessionId]);

  // ── Extracted hooks ──

  const handleStreamCompleted = useCallback((phase: string) => {
    // Only reconcile on normal completion — both messages are persisted.
    // Error/stopped/idle-timeout paths emit 'completed' before the server
    // has persisted partial output, so reconciliation would race.
    if (tailTrimmedRef.current && phase === 'completed') {
      tailTrimmedRef.current = false;
      reconcileWithDb();
    }

    // Refresh session title — server generates it pre-stream now, so it's
    // already persisted by the time the stream completes. Short delay just
    // covers any last-write latency.
    if (phase === 'completed' && sessionId) {
      setTimeout(() => {
        fetch(`/api/chat/sessions/${sessionId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.session?.title) {
              usePanelStore.getState().setSessionTitle(data.session.title);
              window.dispatchEvent(new CustomEvent('session-updated', {
                detail: { id: sessionId, title: data.session.title }
              }));
            }
          })
          .catch(() => {});
      }, 500);
    }
  }, [reconcileWithDb, sessionId]);

  useStreamSubscription({
    sessionId,
    setStreamSnapshot,
    setStreamingSessionId,
    setPendingApprovalSessionId,
    setMessages: cappedSetMessages,
    onStreamCompleted: handleStreamCompleted,
  });

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initialMessages.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  useEffect(() => { setHasMore(initialHasMore); }, [initialHasMore]);

  // Detect compression from multiple sources:
  // 1. Auto-compression: stream-session-manager dispatches 'context-compressed' event
  // 2. Manual /compact: response message contains the compression marker
  useEffect(() => {
    if (!hasSummary && messages.some(m => m.role === 'assistant' && m.content.includes('上下文已压缩'))) {
      setHasSummary(true);
    }
  }, [messages, hasSummary]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId) {
        setHasSummary(true);
        fetch(`/api/chat/sessions/${sessionId}`)
          .then((res) => res.ok ? res.json() : null)
          .then((data) => {
            const boundary = data?.session?.context_summary_boundary_rowid;
            if (typeof boundary === 'number') setSummaryBoundaryRowid(boundary);
          })
          .catch(() => {});
        // Toast 提示用户上下文已被压缩
        import('@/hooks/useToast').then(({ showToast }) => {
          const { messagesCompressed = 0, tokensSaved = 0 } = detail || {};
          showToast({
            type: 'info',
            message: tokensSaved > 0
              ? `上下文已压缩：${messagesCompressed} 条旧消息已摘要，节省约 ${tokensSaved.toLocaleString()} tokens`
              : `上下文已压缩：${messagesCompressed} 条旧消息已摘要`,
            duration: 6000,
          });
        }).catch(() => { /* toast 系统不可用 */ });
        // Phase 1b: if the user asked for "compress and retry", kick off
        // the retry now that compression actually finished. Stored flag
        // + last user message are consumed once so we can't replay
        // twice. Staleness protection uses (a) the arming-flag gate in
        // the sendMessage wrapper to clear pending state on any
        // subsequent user action, (b) the 45s timeout on the arm, and
        // (c) the session-switch clear — no per-request / compact run
        // id is wired through the SSE contract, so we rely on those
        // three clears rather than a correlation token.
        if (pendingRetryAfterCompactRef.current && pendingRetryMessageRef.current) {
          const msg = pendingRetryMessageRef.current;
          clearPendingRetry();
          // Small delay so compression SSE pipeline flushes before next send.
          setTimeout(() => {
            sendMessageRef.current?.(msg);
          }, 100);
        }
      }
    };
    window.addEventListener('context-compressed', handler);
    return () => window.removeEventListener('context-compressed', handler);
  }, [sessionId]);

  const isContextCompressing = statusText === 'Compressing context...';

  // Phase 1b — TerminalReason action state
  // Refs (not state) so the context-compressed handler above can read the
  // latest value without re-subscribing.
  const pendingRetryAfterCompactRef = useRef(false);
  const pendingRetryMessageRef = useRef<string | null>(null);
  /** Timeout handle so we don't leak a pending retry if /compact never
   *  emits context-compressed (e.g. network error, user cancels). */
  const pendingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True for the synchronous window where compress_and_retry is arming
   *  its own /compact call. Used by the sendMessage wrapper to avoid
   *  clearing the pending state we just set. Resets to false right after
   *  the sendMessageRef call returns (sendMessage runs its synchronous
   *  prefix — including the wrapper's stale-retry check — before the
   *  control returns here). */
  const retryArmingInProgressRef = useRef(false);

  const clearPendingRetry = useCallback(() => {
    pendingRetryAfterCompactRef.current = false;
    pendingRetryMessageRef.current = null;
    if (pendingRetryTimerRef.current) {
      clearTimeout(pendingRetryTimerRef.current);
      pendingRetryTimerRef.current = null;
    }
  }, []);

  // Safety: drop any pending retry state on session switch — stale
  // cross-session replay would be nonsense.
  useEffect(() => {
    clearPendingRetry();
  }, [sessionId, clearPendingRetry]);
  const [pendingTerminalAction, setPendingTerminalAction] = useState<{
    actionId: import('./TerminalReasonChip').TerminalActionId;
    lastUserMessage: string;
  } | null>(null);
  // Phase 2 — user can dismiss the rate-limit banner; keeps it from
  // re-rendering on snapshot updates within the same session. Resets on
  // session switch because the snapshot state itself resets.
  const [rateLimitDismissed, setRateLimitDismissed] = useState(false);
  useEffect(() => { setRateLimitDismissed(false); }, [sessionId]);

  // Find the most recent user message — replay target for retry actions.
  const findLastUserMessage = useCallback((): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return null;
  }, [messages]);

  // Execute an action after confirmation (or immediately for non-destructive ones).
  const runTerminalAction = useCallback((actionId: import('./TerminalReasonChip').TerminalActionId, lastUserMessage: string | null) => {
    switch (actionId) {
      case 'compress_and_retry': {
        if (!lastUserMessage) return;
        // Arm the retry. Safety nets for stale-replay:
        //   - 45s timeout (in case /compact never emits context-compressed)
        //   - session switch clears it (useEffect with clearPendingRetry)
        //   - any subsequent user-initiated sendMessage clears it
        //     (including manual /compact or compress_only — per round-13
        //     Codex review: we can't rely on content equality to
        //     distinguish internal vs manual /compact since a user can
        //     type /compact themselves)
        pendingRetryAfterCompactRef.current = true;
        pendingRetryMessageRef.current = lastUserMessage;
        if (pendingRetryTimerRef.current) clearTimeout(pendingRetryTimerRef.current);
        pendingRetryTimerRef.current = setTimeout(() => {
          console.warn('[chat] compress-and-retry timed out — pending retry cleared');
          clearPendingRetry();
        }, 45_000);
        // Mark the synchronous arming window so the sendMessage wrapper
        // below skips its stale-retry clear on THIS call. The wrapper's
        // check is synchronous (runs before the first await in
        // sendMessage), so resetting the flag right after the call is
        // sufficient — no microtask deferral needed.
        retryArmingInProgressRef.current = true;
        try {
          sendMessageRef.current?.('/compact');
        } finally {
          retryArmingInProgressRef.current = false;
        }
        break;
      }
      case 'compress_only':
        // User chose "just compress, don't replay" — drop any previously
        // armed compress_and_retry so its pendingRetryMessage can't ride
        // on THIS compact's context-compressed event.
        clearPendingRetry();
        sendMessageRef.current?.('/compact');
        break;
      case 'enable_1m_and_retry':
        if (!lastUserMessage) return;
        setContext1m(true);
        // Persist per-provider so future sessions keep 1M until user opts out.
        fetch(`/api/providers/options?providerId=${encodeURIComponent(currentProviderId || 'env')}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options: { context_1m: true } }),
        }).catch(() => {});
        setTimeout(() => sendMessageRef.current?.(lastUserMessage), 50);
        break;
      case 'switch_to_sonnet':
        if (!lastUserMessage) return;
        setCurrentModel('sonnet');
        setTimeout(() => sendMessageRef.current?.(lastUserMessage), 50);
        break;
      case 'continue_max_turns':
        sendMessageRef.current?.('continue');
        break;
      case 'retry_simple':
        if (!lastUserMessage) return;
        sendMessageRef.current?.(lastUserMessage);
        break;
      case 'open_hook_settings':
        router.push('/settings');
        break;
      case 'retry_image_upload':
        // No attachments API exposure here yet — surface a toast nudging
        // the user to re-drag the image. Full wire lands with Phase 2's
        // attachment UX work.
        import('@/hooks/useToast').then(({ showToast }) => {
          showToast({ type: 'info', message: t('terminalAction.retryImageUpload' as TranslationKey), duration: 4000 });
        }).catch(() => {});
        break;
    }
  }, [currentProviderId, router, t]);

  // Entry point from the chip. Destructive actions route through confirm
  // dialog; non-destructive ones run immediately.
  const CONFIRM_REQUIRED = new Set<import('./TerminalReasonChip').TerminalActionId>([
    'compress_and_retry',
    'enable_1m_and_retry',
    'switch_to_sonnet',
    'retry_simple',
  ]);

  const handleTerminalAction = useCallback((actionId: import('./TerminalReasonChip').TerminalActionId) => {
    const lastUserMessage = findLastUserMessage();
    if (CONFIRM_REQUIRED.has(actionId) && lastUserMessage) {
      setPendingTerminalAction({ actionId, lastUserMessage });
    } else {
      runTerminalAction(actionId, lastUserMessage);
    }
  }, [findLastUserMessage, runTerminalAction]);

  // Per-session thinking mode toggle (separate from provider-level thinking_mode option).
  // When null/undefined, falls back to the provider-level thinking_mode from DB.
  const [sessionThinkingMode, setSessionThinkingMode] = useState<'enabled' | 'disabled' | undefined>(undefined);

  // Effective toggle display: per-session override or provider default.
  // For Deepseek, 'adaptive' is not applicable — treated as 'enabled' (per API docs: 默认开启).
  const resolvedThinkingMode = useMemo(() => {
    if (sessionThinkingMode) return sessionThinkingMode;
    if (thinkingMode === 'disabled') return 'disabled';
    return 'enabled'; // adaptive or enabled → toggle ON
  }, [thinkingMode, sessionThinkingMode]);

  const handleToggleThinking = useCallback((mode: 'enabled' | 'disabled') => {
    // When user explicitly toggles, store as per-session override
    setSessionThinkingMode(mode);
  }, []);

  const buildThinkingConfig = useCallback((): { type: string } | undefined => {
    // Per-session toggle overrides provider-level setting
    if (sessionThinkingMode === 'enabled') return { type: 'enabled' };
    if (sessionThinkingMode === 'disabled') return { type: 'disabled' };
    // Fall back to provider-level thinking_mode from DB
    if (!thinkingMode || thinkingMode === 'adaptive') return { type: 'adaptive' };
    if (thinkingMode === 'enabled') return { type: 'enabled' };
    if (thinkingMode === 'disabled') return { type: 'disabled' };
    return undefined;
  }, [thinkingMode, sessionThinkingMode]);

  const checkAssistantTrigger = useAssistantTrigger({
    sessionId,
    workingDirectory,
    isStreaming,
    mode,
    currentModel,
    currentProviderId,
    initialMessages,
    handleModeChange,
    buildThinkingConfig,
    sendMessageRef,
    initMetaRef,
  });

  // Detect workspace mismatch
  useEffect(() => {
    if (!workingDirectory) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/workspace');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.path && workingDirectory !== data.path) {
          setIsAssistantProject(false);
          setIsAssistantWorkspace(false);
          const inspectRes = await fetch(`/api/workspace/inspect?path=${encodeURIComponent(workingDirectory)}`);
          if (!inspectRes.ok || cancelled) return;
          const inspectData = await inspectRes.json();
          if (inspectData.hasAssistantData) {
            setWorkspaceMismatchPath(data.path);
          } else {
            setWorkspaceMismatchPath(null);
          }
        } else {
          // workingDirectory matches assistant workspace path
          const isAssistant = !!data.path;
          setIsAssistantProject(isAssistant);
          setWorkspaceMismatchPath(null);
          setIsAssistantWorkspace(isAssistant);
          // Default panel is now controlled by the user's "Default Side Panel" setting
          // in chat/[id]/page.tsx — no longer force-override for assistant workspaces.
          // Load assistant name for avatar display
          if (data.path) {
            try {
              const summaryRes = await fetch('/api/workspace/summary');
              if (summaryRes.ok && !cancelled) {
                const summary = await summaryRes.json();
                setAssistantName(summary.name || '');
                // Store buddy emoji globally for MessageItem avatar rendering
                // Store buddy info globally for MessageItem avatar rendering
                (globalThis as Record<string, unknown>).__codepilot_buddy_info__ = summary.buddy
                  ? { emoji: summary.buddy.emoji, species: summary.buddy.species, rarity: summary.buddy.rarity }
                  : undefined;
              }
            } catch { /* ignore */ }
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [workingDirectory, setIsAssistantWorkspace]);

  // Listen for workspace-switched events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.newPath && workingDirectory && workingDirectory === detail.oldPath) {
        setWorkspaceMismatchPath(detail.newPath);
      }
    };
    window.addEventListener('assistant-workspace-switched', handler);
    return () => window.removeEventListener('assistant-workspace-switched', handler);
  }, [workingDirectory]);

  const handleOpenNewAssistant = useCallback(async () => {
    try {
      const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
      const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
      const res = await fetch('/api/workspace/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'checkin', model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('session-created'));
        router.push(`/chat/${data.session.id}`);
      }
    } catch (e) {
      console.error('[ChatView] Failed to open assistant session:', e);
    }
  }, [router]);

  const loadEarlierMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const earliest = messages[0];
      const earliestRowId = (earliest as Message & { _rowid?: number })._rowid;
      if (!earliestRowId) return;
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100&before=${earliestRowId}`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      setHasMore(data.hasMore ?? false);
      if (data.messages.length > 0) {
        setMessages(prev => {
          const merged = [...data.messages, ...prev];
          if (merged.length > MAX_MESSAGES_IN_MEMORY) {
            // Trim newest messages off the tail — they'll be restored when
            // the next append triggers cappedSetMessages (re-fetches from DB).
            tailTrimmedRef.current = true;
            return merged.slice(0, MAX_MESSAGES_IN_MEMORY);
          }
          return merged;
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sessionId, messages, hasMore]);

  const stopStreaming = useCallback(() => { stopStream(sessionId); }, [sessionId]);

  const handlePermissionResponse = useCallback(
    async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
      setPendingApprovalSessionId('');
      await respondToPermission(sessionId, decision, updatedInput, denyMessage);
    },
    [sessionId, setPendingApprovalSessionId]
  );

  /** Start an API stream for the given content. Does NOT add a user message to the list. */
  const doStartStream = useCallback(
    (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], clientMessageId?: string) => {
      const notices = pendingImageNoticesRef.current.length > 0
        ? [...pendingImageNoticesRef.current]
        : undefined;
      if (notices) pendingImageNoticesRef.current = [];

      startStream({
        sessionId,
        content,
        clientMessageId,
        mode,
        model: currentModel,
        providerId: currentProviderId,
        files,
        systemPromptAppend,
        pendingImageNotices: notices,
        // 'auto' sentinel means "no explicit effort" — filter it here so
        // the CLI applies its per-model default (Opus 4.7 → xhigh, etc.)
        effort: selectedEffort && selectedEffort !== 'auto' ? selectedEffort : undefined,
        thinking: buildThinkingConfig(),
        context1m,
        displayOverride,
        mentions,
        onModeChanged: (sdkMode) => {
          const uiMode = sdkMode === 'plan' ? 'plan' : 'code';
          handleModeChange(uiMode);
        },
        sendMessageFn: (retryContent: string, retryFiles?: FileAttachment[]) => {
          sendMessageRef.current?.(retryContent, retryFiles);
        },
        onInitMeta: (meta) => {
          initMetaRef.current = meta;
          setSdkInitMeta(meta);
          console.log('[ChatView] SDK init meta received:', meta);
        },
      });
    },
    [sessionId, mode, currentModel, currentProviderId, selectedEffort, context1m, buildThinkingConfig, handleModeChange]
  );

  const sendMessageInternal = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], clientMessageId?: string) => {
      const displayUserContent = displayOverride || content;
      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }

      // Phase 1b safety: if a compress_and_retry is armed, drop it
      // whenever the user sends ANY new content — including a manual
      // /compact typed themselves or a "仅压缩" click. Without this, a
      // retry queued by Action Chip would piggyback on a later
      // user-initiated /compact's context-compressed event and replay
      // the old lastUserMessage out of order.
      //
      // The retryArmingInProgressRef flag excludes the one
      // synchronous call the compress_and_retry action itself makes
      // through this wrapper — that call must NOT clear the state it
      // just set. runTerminalAction flips the flag on before calling
      // sendMessageRef and off again right after.
      if (pendingRetryAfterCompactRef.current && !retryArmingInProgressRef.current) {
        clearPendingRetry();
      }

      // Queue message if currently streaming — hold above input, send after completion
      if (isStreaming) {
        setMessageQueue((prev) => [...prev, { clientMessageId, content, files, systemPromptAppend, displayOverride, mentions }]);
        return;
      }

      const messageId = clientMessageId || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userMessage: Message = {
        id: messageId,
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      cappedSetMessages((prev) => [...prev, userMessage]);
      doStartStream(content, files, systemPromptAppend, displayOverride, mentions, messageId);
    },
    [sessionId, isStreaming, doStartStream, cappedSetMessages]
  );

  const sendMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[]) =>
      sendMessageInternal(content, files, systemPromptAppend, displayOverride, mentions),
    [sendMessageInternal]
  );

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        sessionId?: string;
        clientMessageId?: string;
        serverMessageId?: string;
        createdAt?: string;
      } | undefined;
      if (!detail || detail.sessionId !== sessionId || !detail.clientMessageId || !detail.serverMessageId) return;
      setMessages((prev) => prev.map((message) => {
        if (message.id !== detail.clientMessageId) return message;
        return {
          ...message,
          id: detail.serverMessageId!,
          created_at: detail.createdAt || message.created_at,
        };
      }));
    };
    window.addEventListener('chat:user-message-acked', handler);
    return () => window.removeEventListener('chat:user-message-acked', handler);
  }, [sessionId]);

  useEffect(() => {
    setPendingInitialMessage(peekPendingSessionMessage(sessionId));
    setPendingInitialReleaseTick(0);
  }, [sessionId]);

  useEffect(() => {
    if (!pendingInitialMessage) return;
    setMessages((prev) => {
      if (prev.some((message) => message.id === pendingInitialMessage.clientMessageId)) {
        return prev;
      }
      const displayUserContent = pendingInitialMessage.displayOverride || pendingInitialMessage.content;
      const displayContent = pendingInitialMessage.files && pendingInitialMessage.files.length > 0
        ? `<!--files:${JSON.stringify(
            pendingInitialMessage.files.map((file) => ({ id: file.id, name: file.name, type: file.type, size: file.size, data: file.data })),
          )}-->${displayUserContent}`
        : displayUserContent;
      const optimisticUserMessage: Message = {
        id: pendingInitialMessage.clientMessageId,
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date(pendingInitialMessage.createdAt).toISOString(),
        token_usage: null,
      };
      return [...prev, optimisticUserMessage];
    });
  }, [pendingInitialMessage, sessionId]);

  useEffect(() => {
    if (!pendingInitialMessage || isStreaming) return;
    if (shouldReleasePendingFirstTurn(pendingInitialMessage, runtimeWarmupState)) return;

    const remainingDelayMs = getPendingFirstTurnRemainingDelayMs(
      pendingInitialMessage,
      runtimeWarmupState,
    );

    const timeoutId = window.setTimeout(() => {
      setPendingInitialReleaseTick((current) => current + 1);
    }, Math.max(50, remainingDelayMs));

    return () => window.clearTimeout(timeoutId);
  }, [pendingInitialMessage, runtimeWarmupState, isStreaming]);

  useEffect(() => {
    if (!pendingInitialMessage || isStreaming) return;
    if (!shouldReleasePendingFirstTurn(pendingInitialMessage, runtimeWarmupState)) return;

    const pending = consumePendingSessionMessage(sessionId) || pendingInitialMessage;
    setPendingInitialMessage(null);
    void sendMessageInternal(
      pending.content,
      pending.files,
      pending.systemPromptAppend,
      pending.displayOverride,
      pending.mentions,
      pending.clientMessageId,
    );
  }, [sessionId, pendingInitialMessage, pendingInitialReleaseTick, runtimeWarmupState, isStreaming, sendMessageInternal]);

  // ── Dequeue: when streaming finishes and queue is non-empty, send next ──
  useEffect(() => {
    if (!isStreaming && messageQueue.length > 0 && !dequeuingRef.current) {
      dequeuingRef.current = true;
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      // Add the queued message to the conversation as a normal user message
      const displayUserContent = next.displayOverride || next.content;
      let displayContent = displayUserContent;
      if (next.files && next.files.length > 0) {
        const fileMeta = next.files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }
      const userMessage: Message = {
        id: next.clientMessageId || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      cappedSetMessages((prev) => [...prev, userMessage]);
      doStartStream(next.content, next.files, next.systemPromptAppend, next.displayOverride, next.mentions, next.clientMessageId || userMessage.id);
    }
    if (isStreaming) {
      dequeuingRef.current = false;
    }
  }, [isStreaming, messageQueue, doStartStream, cappedSetMessages, sessionId]);

  // Expose widget drill-down bridge: widgets can call window.__widgetSendMessage(text)
  // to trigger follow-up questions (e.g. clicking a node to get deeper explanation)
  // Hardened: type-checked, length-limited, rate-limited, sanitized.
  useEffect(() => {
    let lastCallTime = 0;
    const RATE_LIMIT_MS = 2000;
    const MAX_LENGTH = 500;

    const bridge = (text: unknown) => {
      if (typeof text !== 'string') return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_LENGTH) return;

      // Rate limit: max one message per 2 seconds
      const now = Date.now();
      if (now - lastCallTime < RATE_LIMIT_MS) return;
      lastCallTime = now;

      sendMessageRef.current?.(trimmed);
    };
    (window as unknown as Record<string, unknown>).__widgetSendMessage = bridge;
    return () => {
      delete (window as unknown as Record<string, unknown>).__widgetSendMessage;
    };
  }, []);

  // Listen for widget pin requests from PinnableWidget buttons.
  // The AI model receives the widget code + instructions and calls the
  // codepilot_dashboard_pin MCP tool to complete the pin operation.
  useEffect(() => {
    const handler = (e: Event) => {
      const { widgetCode, title } = (e as CustomEvent).detail || {};
      if (!widgetCode || !sendMessageRef.current) return;

      const instruction = `请将下面的可视化组件固定到项目看板。\n\n标题建议：${title || 'Untitled'}\n\n组件代码：\n${widgetCode}`;
      sendMessageRef.current(instruction, undefined, undefined, `📌 固定「${title || 'Widget'}」到看板`);
    };
    window.addEventListener('widget-pin-request', handler);
    return () => window.removeEventListener('widget-pin-request', handler);
  }, []);

  // Listen for dashboard widget drilldown (click title → conversation)
  useEffect(() => {
    const handler = (e: Event) => {
      const { title, dataContract } = (e as CustomEvent).detail || {};
      if (!title || !sendMessageRef.current) return;
      sendMessageRef.current(
        `请深入分析看板组件「${title}」的数据。\n数据契约：${dataContract || '无'}`,
        undefined, undefined,
        `🔍 分析「${title}」`,
      );
    };
    window.addEventListener('dashboard-widget-drilldown', handler);
    return () => window.removeEventListener('dashboard-widget-drilldown', handler);
  }, []);

  // Listen for dashboard command input
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent).detail || {};
      if (!text || !sendMessageRef.current) return;
      sendMessageRef.current(text, undefined, undefined, text);
    };
    window.addEventListener('dashboard-command', handler);
    return () => window.removeEventListener('dashboard-command', handler);
  }, []);

  // Listen for chat retry events from timeline or error messages
  useEffect(() => {
    const handler = (_e: Event) => {
      if (!sendMessageRef.current) return;
      // The user wants to retry a failed step or message.
      // We send a simple "继续" prompt to trigger the model to look at the
      // previous context (which contains the tool error) and retry.
      sendMessageRef.current("请根据上面的报错信息，重新尝试执行。", undefined, undefined, "重试");
    };
    window.addEventListener('chat-retry', handler);
    return () => window.removeEventListener('chat-retry', handler);
  }, []);

  const handleCommand = useChatCommands({ sessionId, messages, setMessages: cappedSetMessages, sendMessage });

  // Listen for image generation completion
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const paths = (detail.images || [])
        .map((img: { localPath?: string }) => img.localPath)
        .filter(Boolean);
      const pathInfo = paths.length > 0 ? `\nGenerated image file paths:\n${paths.map((p: string) => `- ${p}`).join('\n')}` : '';
      const notice = `[Image generation completed]\n- Prompt: "${detail.prompt}"\n- Aspect ratio: ${detail.aspectRatio}\n- Resolution: ${detail.resolution}${pathInfo}`;

      if (paths.length > 0) {
        setLastGeneratedImages(sessionId, paths);
      }

      pendingImageNoticesRef.current.push(notice);

      const dbNotice = `[__IMAGE_GEN_NOTICE__ prompt: "${detail.prompt}", aspect ratio: ${detail.aspectRatio}, resolution: ${detail.resolution}${paths.length > 0 ? `, file path: ${paths.join(', ')}` : ''}]`;
      fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, role: 'user', content: dbNotice }),
      }).catch(() => {});
    };
    window.addEventListener('image-gen-completed', handler);
    return () => window.removeEventListener('image-gen-completed', handler);
  }, [sessionId]);

  // ── Mobile Bridge Real-time Polling ──
  // Periodically polls the DB when local streaming is inactive.
  // reconcileWithDb handles smart merging/truncating of new messages.
  useEffect(() => {
    if (isStreaming) return;
    
    const interval = setInterval(() => {
      reconcileWithDb();
    }, MESSAGE_RECONCILE_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [sessionId, isStreaming, reconcileWithDb]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Workspace mismatch banner */}
      {workspaceMismatchPath && (
        <div className="flex items-center justify-between gap-3 border-b border-status-warning/30 bg-status-warning-muted px-4 py-2">
          <span className="text-xs text-status-warning-foreground">
            {t('assistant.switchedBanner', { path: workspaceMismatchPath })}
          </span>
          <Button
            onClick={handleOpenNewAssistant}
            className="shrink-0 rounded-md bg-status-warning px-3 py-1 text-xs font-medium text-white hover:bg-status-warning/80 transition-colors"
          >
            {t('assistant.openNewAssistant')}
          </Button>
        </div>
      )}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        toolUses={toolUses}
        toolResults={toolResults}
        streamingToolOutput={streamingToolOutput}
        streamingThinkingContent={streamingThinkingContent}
        referencedContexts={referencedContexts}
        statusPayload={streamSnapshot?.statusPayload}
        statusText={statusText}
        onForceStop={stopStreaming}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadEarlierMessages}
        rewindPoints={rewindPoints}
        sessionId={sessionId}
        startedAt={streamSnapshot?.startedAt}
        isAssistantProject={isAssistantProject}
        assistantName={assistantName}
        hasSummary={hasSummary}
        summaryBoundaryRowid={summaryBoundaryRowid}
        isContextCompressing={isContextCompressing}
        subAgents={subAgents}
      />
      {/* End-of-turn terminal reason chip (only shown when stream is not active) */}
      {!isStreaming && (
        <TerminalReasonChip
          reason={streamSnapshot?.terminalReason}
          onAction={handleTerminalAction}
        />
      )}
      {/* Permission prompt */}
      <PermissionPrompt
        pendingPermission={pendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
        permissionProfile={permissionProfile}
      />
      {/* Phase 1b — confirmation dialog for destructive chip actions */}
      <AlertDialog
        open={pendingTerminalAction !== null}
        onOpenChange={(open) => { if (!open) setPendingTerminalAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('terminalAction.confirmTitle' as TranslationKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTerminalAction?.actionId === 'compress_and_retry' && t('terminalAction.confirmCompressAndRetry' as TranslationKey)}
              {pendingTerminalAction?.actionId === 'enable_1m_and_retry' && t('terminalAction.confirmEnable1mAndRetry' as TranslationKey)}
              {pendingTerminalAction?.actionId === 'switch_to_sonnet' && t('terminalAction.confirmSwitchToSonnet' as TranslationKey)}
              {pendingTerminalAction?.actionId === 'retry_simple' && t('terminalAction.confirmRetry' as TranslationKey)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('terminalAction.confirmCancel' as TranslationKey)}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingTerminalAction) {
                runTerminalAction(pendingTerminalAction.actionId, pendingTerminalAction.lastUserMessage);
                setPendingTerminalAction(null);
              }
            }}>
              {t('terminalAction.confirmCta' as TranslationKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Batch image generation panels */}
      <BatchExecutionDashboard />
      <BatchContextSync />

      {/* Global File Review Bar */}
      <FileReviewBar sessionId={sessionId} />

      <ContextWidgetPortal
        messages={messages}
        modelName={currentModel}
        context1m={context1m}
        hasSummary={hasSummary}
        contextWindow={currentModelMeta.contextWindow}
        upstreamModelId={currentModelMeta.upstreamModelId}
        toolFiles={toolFiles}
        onCompress={() => {
          sendMessage('/compact', undefined, undefined, '压缩上下文');
          // Add a temporary streaming assistant message to show the indicator immediately
          const compressionMsg: Message = {
            id: 'temp-compact-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: '上下文压缩中...',
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          cappedSetMessages(prev => [...prev, compressionMsg]);
        }}
      />
      {workingDirectory && <MemoryPanelPortal workingDirectory={workingDirectory} />}

      {/* Queued message banner — shown above input when messages are waiting */}
      {messageQueue.length > 0 && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-1">
          {messageQueue.map((qm, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 256 256" className="shrink-0 text-muted-foreground"><path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88Zm64-88a8 8 0 0 1-8 8H128a8 8 0 0 1-8-8V72a8 8 0 0 1 16 0v48h56a8 8 0 0 1 0 16Z"/></svg>
              <span className="flex-1 truncate text-sm text-muted-foreground">
                {(qm.displayOverride || qm.content).length > 80
                  ? (qm.displayOverride || qm.content).slice(0, 77) + '...'
                  : (qm.displayOverride || qm.content)}
              </span>
              <button
                type="button"
                onClick={() => setMessageQueue((prev) => prev.filter((_, idx) => idx !== i))}
                className="shrink-0 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
                aria-label={t('messageQueue.cancel' as TranslationKey)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Phase 2 — subscription rate-limit banner (allowed_warning / rejected) */}
      {!rateLimitDismissed && streamSnapshot?.rateLimitInfo && streamSnapshot.rateLimitInfo.status !== 'allowed' && (
        <RateLimitBanner
          info={streamSnapshot.rateLimitInfo}
          onRequestSwitchToSonnet={() => {
            const lastUserMessage = findLastUserMessage();
            if (lastUserMessage) {
              setPendingTerminalAction({ actionId: 'switch_to_sonnet', lastUserMessage });
            } else {
              setCurrentModel('sonnet');
            }
          }}
          onDismiss={() => setRateLimitDismissed(true)}
        />
      )}
      {pendingInitialStatusText && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <SpinnerGap size={14} className="animate-spin text-primary" />
            <span>{pendingInitialStatusText}</span>
          </div>
        </div>
      )}
      <MessageInput
        key={sessionId}
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        sessionId={sessionId}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={handleProviderModelChange}
        workingDirectory={workingDirectory}
        onAssistantTrigger={checkAssistantTrigger}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        thinkingMode={resolvedThinkingMode}
        onThinkingModeChange={handleToggleThinking}
        sdkInitMeta={sdkInitMeta}
        isAssistantProject={isAssistantProject}
        hasMessages={messages.length > 0}
        toolUses={toolUses}
        toolResults={toolResults}
      />
      <ChatComposerActionBar
        left={
          <ModeIndicator mode={mode} onModeChange={handleModeChange} disabled={isStreaming} />
        }
        center={
          <div className="flex items-center">
            <ChatPermissionSelector
              sessionId={sessionId}
              permissionProfile={permissionProfile}
              onPermissionChange={setPermissionProfile}
            />
          </div>
        }
        right={
          <div className="flex items-center gap-3">
            {/* 会话状态指示器：显示 agent 数量、工具调用数、技能调用数 */}
            <SessionStatusIndicator
              subAgents={subAgents}
              toolUses={toolUses}
              skillCount={toolUses.filter((t: any) => t.name === 'Skill').length}
            />
            <RuntimeBadge providerId={currentProviderId} />
            <ContextUsageIndicator
              messages={messages}
              modelName={currentModel}
              context1m={context1m}
              hasSummary={hasSummary}
              contextWindow={currentModelMeta.contextWindow}
              upstreamModelId={currentModelMeta.upstreamModelId}
              contextUsageSnapshot={streamSnapshot?.contextUsageSnapshot}
            />
          </div>
        }
      />
    </div>
  );
}
