'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Message, MessagesResponse, ChatSession } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { SpinnerGap } from "@/components/ui/icon";
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { preloadFileTreePanel } from '@/components/layout/panels/fileTreePanelLoader';
import { prefetchRootFileTree } from '@/lib/file-tree-cache';

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

export default function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionProviderId, setSessionProviderId] = useState<string>('');
  const [sessionInfoLoaded, setSessionInfoLoaded] = useState(false);
  const [sessionPermissionProfile, setSessionPermissionProfile] = useState<'default' | 'full_access'>('default');
  const [sessionMode, setSessionMode] = useState<'code' | 'plan'>('code');
  const [sessionHasSummary, setSessionHasSummary] = useState(false);
  const [sessionSummaryBoundaryRowid, setSessionSummaryBoundaryRowid] = useState(0);
  const { workingDirectory, setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setFileTreeOpen, setGitPanelOpen, setDashboardPanelOpen } = usePanel();
  const targetFilePath = searchParams.get('file') || undefined;
  const { t } = useTranslation();
  const defaultPanelAppliedRef = useRef(false);

  // Load session info and set working directory
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Clear stale state immediately so ChatView doesn't inherit previous session's values
    setWorkingDirectory('');
    setSessionModel('');
    setSessionProviderId('');
    setSessionInfoLoaded(false);

    async function loadSession() {
      try {
        const sessionRes = await fetch(`/api/chat/sessions/${id}`, { signal: controller.signal });
        if (cancelled) return;
        if (sessionRes.ok) {
          const data: { session: ChatSession } = await sessionRes.json();
          if (cancelled) return;
          if (data.session.working_directory) {
            setWorkingDirectory(data.session.working_directory);
            localStorage.setItem("codepilot:last-working-directory", data.session.working_directory);
            window.dispatchEvent(new Event('refresh-file-tree'));
          }
          setSessionId(id);
          const title = data.session.title || t('chat.newConversation');
          setPanelSessionTitle(title);

          // Resolve model: session → global default → provider's first → localStorage → 'sonnet'
          const { resolveSessionModel } = await import('@/lib/resolve-session-model');
          if (cancelled) return;
          const resolved = await resolveSessionModel(data.session.model || '', data.session.provider_id || '');
          if (cancelled) return;
          console.log('[page.tsx] resolveSessionModel result:', {
            sessionModel: data.session.model || '',
            sessionProviderId: data.session.provider_id || '',
            resolvedModel: resolved.model,
            resolvedProviderId: resolved.providerId,
          });
          setSessionModel(resolved.model);
          setSessionProviderId(resolved.providerId);
          setSessionPermissionProfile(data.session.permission_profile || 'default');
          setSessionMode((data.session.mode as 'code' | 'plan') || 'code');
          setSessionHasSummary(!!data.session.context_summary);
          setSessionSummaryBoundaryRowid(data.session.context_summary_boundary_rowid || 0);
        }
      } catch {
        // Session info load failed - panel will still work without directory
      } finally {
        if (!cancelled) setSessionInfoLoaded(true);
      }
    }

    loadSession();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, setWorkingDirectory, setSessionId, setPanelSessionTitle, t]);

  useEffect(() => {
    if (!sessionInfoLoaded || !id) return;

    preloadFileTreePanel();
  }, [id, sessionInfoLoaded]);

  useEffect(() => {
    if (!workingDirectory) return;

    const controller = new AbortController();
    void prefetchRootFileTree(workingDirectory, controller.signal);

    return () => {
      controller.abort();
    };
  }, [workingDirectory]);

  useEffect(() => {
    // Reset state when switching sessions
    defaultPanelAppliedRef.current = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setHasMore(false);

    let cancelled = false;
    const controller = new AbortController();

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}/messages?limit=30`, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError('Session not found');
            return;
          }
          throw new Error('Failed to load messages');
        }
        const data: MessagesResponse = await res.json();
        if (cancelled) return;
        setMessages(data.messages);
        setHasMore(data.hasMore ?? false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  // 中文注释：预热统一由 ChatView 管理（useEffect([sessionId, currentModel, currentProviderId])），
  // 不在 page.tsx 重复触发。原因是 page.tsx 的 sessionModel/sessionProviderId 来自 DB，
  // 用户在 ChatView 中切换模型后 DB 值可能未更新，导致 page.tsx 用旧 provider 预热，
  // ChatView 用新 provider 预热，签名不匹配，旧 entry 被丢弃，预热白费。

  // Auto-open file tree when jumping from a file search result
  useEffect(() => {
    if (targetFilePath) {
      setFileTreeOpen(true);
    }
  }, [targetFilePath, setFileTreeOpen]);

  // Auto-open default panel the first time a session is ever opened.
  // Uses sessionStorage to track which sessions have already been initialized,
  // so re-opening an untouched (zero-message) session won't override the layout.
  useEffect(() => {
    if (defaultPanelAppliedRef.current) return;
    defaultPanelAppliedRef.current = true;

    const storageKey = `codepilot:panel-init:${id}`;
    if (typeof window !== 'undefined' && sessionStorage.getItem(storageKey)) return;

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(storageKey, '1');
    }

    (async () => {
      try {
        if (targetFilePath) {
          // Preserve explicit deep-link intent from global search.
          setFileTreeOpen(true);
          return;
        }
        const res = await fetch('/api/settings/app');
        if (!res.ok) return;
        const data = await res.json();
        const panel = data.settings?.default_panel || 'file_tree';
        if (panel === 'none') {
          setFileTreeOpen(false);
          setGitPanelOpen(false);
          setDashboardPanelOpen(false);
        } else {
          setFileTreeOpen(panel === 'file_tree');
          setGitPanelOpen(panel === 'git');
          setDashboardPanelOpen(panel === 'dashboard');
        }
      } catch {
        setFileTreeOpen(true);
      }
    })();
  }, [id, targetFilePath, setFileTreeOpen, setGitPanelOpen, setDashboardPanelOpen]);

  // 中文注释：仅在加载会话信息和消息时显示 loading，warmup 不阻塞 UI
  if (loading || !sessionInfoLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <SpinnerGap size={32} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('chat.loadingMessages')}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">{error}</p>
          <Link href="/chat" className="text-sm text-muted-foreground hover:underline">
            Start a new chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatView key={id} sessionId={id} initialMessages={messages} initialHasMore={hasMore} modelName={sessionModel} providerId={sessionProviderId} initialPermissionProfile={sessionPermissionProfile} initialMode={sessionMode} initialHasSummary={sessionHasSummary} initialSummaryBoundaryRowid={sessionSummaryBoundaryRowid} isLoading={loading} />
    </div>
  );
}
