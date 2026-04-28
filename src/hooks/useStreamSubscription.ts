import { useEffect } from 'react';
import type { Message, SessionStreamSnapshot } from '@/types';
import {
  subscribe,
  getSnapshot,
  clearSnapshot,
} from '@/lib/stream-session-manager';
import { transferPendingToMessage } from '@/lib/image-ref-store';

interface UseStreamSubscriptionOpts {
  sessionId: string;
  setStreamSnapshot: React.Dispatch<React.SetStateAction<SessionStreamSnapshot | null>>;
  setStreamingSessionId: (id: string) => void;
  setPendingApprovalSessionId: (id: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Called after a stream completes. Phase indicates how it ended. */
  onStreamCompleted?: (phase: string) => void;
}

export function useStreamSubscription({
  sessionId,
  setStreamSnapshot,
  setStreamingSessionId,
  setPendingApprovalSessionId,
  setMessages,
  onStreamCompleted,
}: UseStreamSubscriptionOpts): void {
  useEffect(() => {
    // 中文注释：先订阅再读快照，防止 subscribe 前 stream 恰好完成导致 completion 事件在 listener 真空期丢失
    let completedViaEvent = false;

    const unsubscribe = subscribe(sessionId, (event) => {
      setStreamSnapshot(event.snapshot);

      // Sync panel state
      if (event.type === 'phase-changed') {
        if (event.snapshot.phase === 'active') {
          setStreamingSessionId(sessionId);
        } else {
          setStreamingSessionId('');
          setPendingApprovalSessionId('');
        }
      }
      if (event.type === 'permission-request') {
        setPendingApprovalSessionId(sessionId);
      }
      if (event.type === 'completed') {
        completedViaEvent = true;
        setStreamingSessionId('');
        setPendingApprovalSessionId('');

        // Append the final assistant message to the messages list
        const finalContent = event.snapshot.finalMessageContent;
        if (finalContent) {
          const assistantMessage: Message = {
            id: `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            session_id: sessionId,
            role: 'assistant',
            content: finalContent,
            created_at: new Date().toISOString(),
            token_usage: event.snapshot.tokenUsage ? JSON.stringify(event.snapshot.tokenUsage) : null,
            referenced_contexts: event.snapshot.referencedContexts && event.snapshot.referencedContexts.length > 0 ? JSON.stringify(event.snapshot.referencedContexts) : undefined,
            tool_files: event.snapshot.toolFiles && event.snapshot.toolFiles.length > 0 ? JSON.stringify(event.snapshot.toolFiles) : undefined,
          };
          transferPendingToMessage(assistantMessage.id);
          setMessages((prev) => [...prev, assistantMessage]);
        }

        // Clear the snapshot from the manager since we've consumed it
        clearSnapshot(sessionId);

        // Signal stream completion with the final phase so the caller can
        // decide whether DB reconciliation is safe (only on success).
        onStreamCompleted?.(event.snapshot.phase);
      }
    });

    // 中文注释：订阅后再读快照——订阅真空期内完成的 stream 会被此处捕获处理
    const existing = getSnapshot(sessionId);
    if (existing) {
      setStreamSnapshot(existing);
      if (existing.phase === 'active') {
        setStreamingSessionId(sessionId);
      }
      if (existing.pendingPermission && !existing.permissionResolved) {
        setPendingApprovalSessionId(sessionId);
      }
      // If stream finished while this ChatView was unmounted AND we didn't
      // already handle it via the subscription callback, consume now.
      if (!completedViaEvent && existing.phase !== 'active' && existing.finalMessageContent) {
        if (existing.phase === 'completed') {
          fetch(`/api/chat/sessions/${sessionId}/messages?limit=50`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data?.messages) {
                setMessages(data.messages);
              }
            })
            .catch(() => {
              const assistantMessage: Message = {
                id: `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                session_id: sessionId,
                role: 'assistant',
                content: existing.finalMessageContent!,
                created_at: new Date().toISOString(),
                token_usage: existing.tokenUsage ? JSON.stringify(existing.tokenUsage) : null,
                referenced_contexts: existing.referencedContexts && existing.referencedContexts.length > 0 ? JSON.stringify(existing.referencedContexts) : undefined,
                tool_files: existing.toolFiles && existing.toolFiles.length > 0 ? JSON.stringify(existing.toolFiles) : undefined,
              };
              transferPendingToMessage(assistantMessage.id);
              setMessages((prev) => [...prev, assistantMessage]);
            });
        } else {
          const assistantMessage: Message = {
            id: `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            session_id: sessionId,
            role: 'assistant',
            content: existing.finalMessageContent!,
            created_at: new Date().toISOString(),
            token_usage: existing.tokenUsage ? JSON.stringify(existing.tokenUsage) : null,
            referenced_contexts: existing.referencedContexts && existing.referencedContexts.length > 0 ? JSON.stringify(existing.referencedContexts) : undefined,
            tool_files: existing.toolFiles && existing.toolFiles.length > 0 ? JSON.stringify(existing.toolFiles) : undefined,
          };
          transferPendingToMessage(assistantMessage.id);
          setMessages((prev) => [...prev, assistantMessage]);
        }
        clearSnapshot(sessionId);
        onStreamCompleted?.(existing.phase);
      }
    } else {
      setStreamSnapshot(null);
    }

    return () => {
      unsubscribe();
      // Do NOT abort — stream continues in the manager
    };
  }, [sessionId, setStreamingSessionId, setPendingApprovalSessionId, setStreamSnapshot, setMessages, onStreamCompleted]);
}
