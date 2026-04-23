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
    // Restore snapshot if stream is already active (e.g., user switched away and back)
    const existing = getSnapshot(sessionId);
    if (existing) {
      setStreamSnapshot(existing);
      if (existing.phase === 'active') {
        setStreamingSessionId(sessionId);
      }
      if (existing.pendingPermission && !existing.permissionResolved) {
        setPendingApprovalSessionId(sessionId);
      }
      // If stream finished while this ChatView was unmounted, consume finalMessageContent now.
      if (existing.phase !== 'active' && existing.finalMessageContent) {
        if (existing.phase === 'completed') {
          // Normal completion — both messages are persisted. Re-fetch from DB
          // to get canonical state and avoid duplicating the temp assistant message.
          fetch(`/api/chat/sessions/${sessionId}/messages?limit=50`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data?.messages) {
                setMessages(data.messages);
              }
            })
            .catch(() => {
              // Fallback: append locally if DB fetch fails
              const assistantMessage: Message = {
                id: 'temp-assistant-' + Date.now(),
                session_id: sessionId,
                role: 'assistant',
                content: existing.finalMessageContent!,
                created_at: new Date().toISOString(),
                token_usage: existing.tokenUsage ? JSON.stringify(existing.tokenUsage) : null,
                referenced_contexts: existing.referencedContexts && existing.referencedContexts.length > 0 ? JSON.stringify(existing.referencedContexts) : undefined,
                // 中文注释：功能名称「工具文件快照恢复」，用法是从快照恢复toolFiles到临时消息
                tool_files: existing.toolFiles && existing.toolFiles.length > 0 ? JSON.stringify(existing.toolFiles) : undefined,
              };
              transferPendingToMessage(assistantMessage.id);
              setMessages((prev) => [...prev, assistantMessage]);
            });
        } else {
          // Error/stopped/idle-timeout — partial output may not be persisted yet.
          // Append locally to preserve the content the user saw before unmount.
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: existing.finalMessageContent!,
            created_at: new Date().toISOString(),
            token_usage: existing.tokenUsage ? JSON.stringify(existing.tokenUsage) : null,
            referenced_contexts: existing.referencedContexts && existing.referencedContexts.length > 0 ? JSON.stringify(existing.referencedContexts) : undefined,
            // 中文注释：功能名称「工具文件快照恢复」，用法是从快照恢复toolFiles到临时消息
            tool_files: existing.toolFiles && existing.toolFiles.length > 0 ? JSON.stringify(existing.toolFiles) : undefined,
          };
          transferPendingToMessage(assistantMessage.id);
          setMessages((prev) => [...prev, assistantMessage]);
        }
        clearSnapshot(sessionId);
      }
    } else {
      setStreamSnapshot(null);
    }

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
        setStreamingSessionId('');
        setPendingApprovalSessionId('');

        // Append the final assistant message to the messages list
        const finalContent = event.snapshot.finalMessageContent;
        if (finalContent) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: finalContent,
            created_at: new Date().toISOString(),
            token_usage: event.snapshot.tokenUsage ? JSON.stringify(event.snapshot.tokenUsage) : null,
            referenced_contexts: event.snapshot.referencedContexts && event.snapshot.referencedContexts.length > 0 ? JSON.stringify(event.snapshot.referencedContexts) : undefined,
            // 中文注释：功能名称「工具文件快照传递」，用法是将streamSnapshot中的toolFiles
            // 传递给临时消息，使上下文统计在流结束后仍能显示文件/网页信息
            tool_files: event.snapshot.toolFiles && event.snapshot.toolFiles.length > 0 ? JSON.stringify(event.snapshot.toolFiles) : undefined,
          };
          // Transfer pending reference images to this message ID
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

    return () => {
      unsubscribe();
      // Do NOT abort — stream continues in the manager
    };
  }, [sessionId, setStreamingSessionId, setPendingApprovalSessionId, setStreamSnapshot, setMessages, onStreamCompleted]);
}
