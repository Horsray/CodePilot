'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Message, SSEEvent, SessionResponse, TokenUsage, PermissionRequestEvent, FileAttachment, MentionRef } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { ChatComposerActionBar } from '@/components/chat/ChatComposerActionBar';
import { ModeIndicator } from '@/components/chat/ModeIndicator';
import { ChatPermissionSelector } from '@/components/chat/ChatPermissionSelector';
import { ImageGenToggle } from '@/components/chat/ImageGenToggle';
import { PermissionPrompt } from '@/components/chat/PermissionPrompt';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { OnboardingWizard } from '@/components/assistant/OnboardingWizard';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { maybeShowStatusToast } from '@/hooks/useSSEStream';
import { seedSnapshotPatch } from '@/lib/stream-session-manager';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface ChatPerfEntry {
  name: string;
  atMs: number;
  source: 'frontend' | 'route' | 'native';
  durationMs?: number;
  detail?: Record<string, unknown>;
}

interface ChatPerfTrace {
  id: string;
  createdAt: string;
  entries: ChatPerfEntry[];
  memorySamples: Array<{ atMs: number; usedJSHeapSize: number; totalJSHeapSize: number }>;
  longTasks: Array<{ startMs: number; durationMs: number; name: string }>;
  metadata: Record<string, unknown>;
  finishReason?: string;
}

function getPerfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Number(performance.now().toFixed(2))
    : Date.now();
}

function createChatPerfTrace(metadata: Record<string, unknown>) {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `chat-${Date.now()}`;
  const markPrefix = `codepilot-chat-${id}`;
  const trace: ChatPerfTrace = {
    id,
    createdAt: new Date().toISOString(),
    entries: [],
    memorySamples: [],
    longTasks: [],
    metadata,
  };
  const startMarks = new Map<string, number>();
  const perfWithMemory = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
    };
  };
  let memoryTimer: ReturnType<typeof setInterval> | null = null;
  let longTaskObserver: PerformanceObserver | null = null;

  const storeTrace = () => {
    if (typeof window === 'undefined') return;
    const w = window as typeof window & {
      __codepilotChatPerf?: { traces: ChatPerfTrace[] };
    };
    if (!w.__codepilotChatPerf) {
      w.__codepilotChatPerf = { traces: [] };
    }
    w.__codepilotChatPerf.traces.push({
      ...trace,
      entries: [...trace.entries],
      memorySamples: [...trace.memorySamples],
      longTasks: [...trace.longTasks],
    });
    if (w.__codepilotChatPerf.traces.length > 20) {
      w.__codepilotChatPerf.traces.splice(0, w.__codepilotChatPerf.traces.length - 20);
    }
  };

  const record = (
    name: string,
    source: ChatPerfEntry['source'],
    detail?: Record<string, unknown>,
    durationMs?: number,
  ) => {
    trace.entries.push({
      name,
      source,
      atMs: getPerfNow(),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(detail ? { detail } : {}),
    });
  };

  // 中文注释：记录前端阶段起点，并同步写入 Performance Timeline。
  const start = (name: string, detail?: Record<string, unknown>) => {
    startMarks.set(name, getPerfNow());
    performance.mark(`${markPrefix}:${name}:start`);
    record(`${name}:start`, 'frontend', detail);
  };

  // 中文注释：记录前端阶段终点，输出 duration 便于和后端阶段对齐分析。
  const end = (name: string, detail?: Record<string, unknown>) => {
    const startAt = startMarks.get(name);
    if (startAt === undefined) return;
    const durationMs = Number((getPerfNow() - startAt).toFixed(2));
    performance.mark(`${markPrefix}:${name}:end`);
    try {
      performance.measure(`${markPrefix}:${name}`, `${markPrefix}:${name}:start`, `${markPrefix}:${name}:end`);
    } catch { /* ignore duplicate measure errors */ }
    record(name, 'frontend', detail, durationMs);
    startMarks.delete(name);
  };

  // 中文注释：接收服务端 perf 事件，统一收敛到同一条前端链路中。
  const addServerPerf = (source: 'route' | 'native', payload: Record<string, unknown>) => {
    const snapshot = payload.snapshot as {
      totalDurationMs?: number;
      events?: Array<{ name?: string; durationMs?: number; detail?: Record<string, unknown> }>;
      metadata?: Record<string, unknown>;
    } | undefined;

    if (snapshot?.events?.length) {
      for (const event of snapshot.events) {
        record(event.name || `${source}.event`, source, event.detail, event.durationMs);
      }
      return;
    }

    record(String(payload.name || `${source}.event`), source, (payload.detail as Record<string, unknown> | undefined), typeof payload.totalDurationMs === 'number' ? payload.totalDurationMs : undefined);
    if (typeof payload.durationMs === 'number') {
      trace.entries[trace.entries.length - 1].durationMs = payload.durationMs;
    }
  };

  // 中文注释：采样堆内存和长任务，排查前端阻塞与潜在内存泄漏。
  const beginMonitoring = () => {
    if (perfWithMemory.memory) {
      memoryTimer = setInterval(() => {
        if (!perfWithMemory.memory) return;
        trace.memorySamples.push({
          atMs: getPerfNow(),
          usedJSHeapSize: perfWithMemory.memory.usedJSHeapSize,
          totalJSHeapSize: perfWithMemory.memory.totalJSHeapSize,
        });
      }, 500);
    }

    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          trace.longTasks.push({
            startMs: Number(entry.startTime.toFixed(2)),
            durationMs: Number(entry.duration.toFixed(2)),
            name: entry.name,
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    }
  };

  const finish = (finishReason: string, detail?: Record<string, unknown>) => {
    trace.finishReason = finishReason;
    if (memoryTimer) clearInterval(memoryTimer);
    memoryTimer = null;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    record('trace.finish', 'frontend', {
      finishReason,
      ...(detail || {}),
    });
    storeTrace();
    console.groupCollapsed(`[chat-perf] ${trace.id} ${finishReason}`);
    console.table(trace.entries.map((entry) => ({
      source: entry.source,
      name: entry.name,
      durationMs: entry.durationMs ?? '',
      atMs: entry.atMs,
    })));
    if (trace.memorySamples.length > 0) console.table(trace.memorySamples);
    if (trace.longTasks.length > 0) console.table(trace.longTasks);
    console.groupEnd();
  };

  beginMonitoring();

  return {
    id,
    start,
    end,
    record,
    addServerPerf,
    finish,
  };
}

export default function NewChatPage() {
  const router = useRouter();
  // Read prefill from URL once on mount — avoids useSearchParams which requires Suspense boundary
  const prefillText = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('prefill') || '';
  }, []);
  const { setPendingApprovalSessionId } = usePanel();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinkingContent, setStreamingThinkingContent] = useState('');
  const [referencedContexts, setReferencedContexts] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{ message: string; description?: string } | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [hasProvider, setHasProvider] = useState(true); // assume true until checked
  const [showWizard, setShowWizard] = useState(false);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [assistantWorkspacePath, setAssistantWorkspacePath] = useState('');
  const [mode, setMode] = useState('code');
  // Model/provider start empty — populated by the async global-default fetch.
  // This prevents the race where a user sends before the fetch completes and
  // gets the stale localStorage model instead of the configured default.
  const [modelReady, setModelReady] = useState(false);
  const [currentModel, setCurrentModel] = useState(() => {
    if (typeof window === 'undefined') return '';
    // One-time migration: clear stale model/provider from pre-0.38 installs
    if (!localStorage.getItem('codepilot:migration-038')) {
      localStorage.removeItem('codepilot:last-model');
      localStorage.removeItem('codepilot:last-provider-id');
      localStorage.setItem('codepilot:migration-038', '1');
    }
    return '';
  });
  const [currentProviderId, setCurrentProviderId] = useState(() => {
    if (typeof window === 'undefined') return '';
    if (!localStorage.getItem('codepilot:migration-038')) {
      return '';
    }
    return '';
  });
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>('default');
  const [createdSessionId, setCreatedSessionId] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  // Effort level — lifted here so the first message includes it
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined);
  // Provider options (thinking mode + 1M context)
  const [thinkingMode, setThinkingMode] = useState<string>('adaptive');
  const [context1m, setContext1m] = useState(false);

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

  // Validate restored model/provider against actual available providers/models.
  // For NEW conversations, the global default model takes priority
  // over localStorage's last-model (which is a cross-session global memory).
  useEffect(() => {
    let cancelled = false;

    // Fetch models and global default in parallel
    const modelsP = fetch('/api/providers/models').then(r => r.ok ? r.json() : null);
    const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

    Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
      if (cancelled || !modelsData?.groups || modelsData.groups.length === 0) {
        // No provider data — fall back to localStorage best-effort
        const savedModel = localStorage.getItem('codepilot:last-model') || 'sonnet';
        const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
        setCurrentModel(savedModel);
        setCurrentProviderId(savedProvider);
        setModelReady(true);
        return;
      }
      const groups = modelsData.groups as Array<{ provider_id: string; models: Array<{ value: string }> }>;
      const globalDefaultModel = globalData?.options?.default_model || '';
      const globalDefaultProvider = globalData?.options?.default_model_provider || '';

      // Apply global default for new conversations
      // Case 1: both provider and model are set and valid
      if (globalDefaultModel && globalDefaultProvider) {
        const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
        const modelValid = targetGroup?.models.some(m => m.value === globalDefaultModel);
        if (modelValid) {
          setCurrentModel(globalDefaultModel);
          setCurrentProviderId(globalDefaultProvider);
          setModelReady(true);
          return;
        }
      }
      // Case 2: provider is set but model was cleared (e.g. after doctor repair / provider delete)
      // → use that provider's first available model
      if (globalDefaultProvider && !globalDefaultModel) {
        const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
        if (targetGroup?.models?.length) {
          setCurrentModel(targetGroup.models[0].value);
          setCurrentProviderId(globalDefaultProvider);
          setModelReady(true);
          return;
        }
      }

      // No global default — use localStorage, validate against provider's list
      const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
      const savedModel = localStorage.getItem('codepilot:last-model') || '';
      const validProvider = groups.find(g => g.provider_id === savedProvider);
      const resolvedGroup = validProvider || groups[0];
      const resolvedPid = resolvedGroup?.provider_id || '';

      if (validProvider) {
        setCurrentProviderId(savedProvider);
      } else {
        setCurrentProviderId(resolvedPid);
      }

      if (resolvedGroup?.models && resolvedGroup.models.length > 0) {
        const validModel = savedModel && resolvedGroup.models.some(m => m.value === savedModel);
        if (validModel) {
          setCurrentModel(savedModel);
        } else {
          setCurrentModel(resolvedGroup.models[0].value);
        }
      } else {
        setCurrentModel(savedModel || 'sonnet');
      }
      setModelReady(true);
    }).catch(() => {
      // Fetch failed — fall back to localStorage best-effort
      const savedModel = localStorage.getItem('codepilot:last-model') || 'sonnet';
      const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
      setCurrentModel(savedModel);
      setCurrentProviderId(savedProvider);
      setModelReady(true);
    });

    return () => { cancelled = true; };
   
  }, []); // Run once on mount to validate initial values

  // Initialize workingDir from localStorage (or setup default), validating the path exists
  useEffect(() => {
    let cancelled = false;

    const validateDir = async (path: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/files/browse?dir=${encodeURIComponent(path)}`);
        return res.ok;
      } catch {
        return false;
      }
    };

    const tryFallbackToDefault = async () => {
      try {
        const res = await fetch('/api/setup');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.defaultProject) return;
        if (await validateDir(data.defaultProject) && !cancelled) {
          setWorkingDir(data.defaultProject);
          localStorage.setItem('codepilot:last-working-directory', data.defaultProject);
        }
      } catch { /* ignore */ }
    };

    const init = async () => {
      const saved = localStorage.getItem('codepilot:last-working-directory');
      if (saved) {
        if (await validateDir(saved) && !cancelled) {
          setWorkingDir(saved);
        } else if (!cancelled) {
          // Stale — clear and try setup default
          localStorage.removeItem('codepilot:last-working-directory');
          await tryFallbackToDefault();
        }
      } else {
        await tryFallbackToDefault();
      }
    };

    init();

    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setWorkingDir(path);
    };
    window.addEventListener('project-directory-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('project-directory-changed', handler);
    };
  }, []);

  // Load recent projects for empty state
  useEffect(() => {
    fetch('/api/setup/recent-projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setRecentProjects(data.projects || []))
      .catch(() => {});
  }, []);

  // Detect assistant workspace status
  useEffect(() => {
    fetch('/api/settings/workspace')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.path && data?.valid !== false) {
          setAssistantWorkspacePath(data.path);
          setAssistantConfigured(!!data.state?.onboardingComplete);
        }
      })
      .catch(() => {});
  }, []);

  // Check provider availability — only 'completed' counts, 'skipped' means user deferred but has no real credentials
  useEffect(() => {
    const checkProvider = () => {
      // Lock sending while we re-resolve the model/provider
      setModelReady(false);
      fetch('/api/setup')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setHasProvider(data.provider === 'completed');
          }
        })
        .catch(() => {});
      // Sync provider/model, applying global default model for new conversations.
      const savedProviderId = localStorage.getItem('codepilot:last-provider-id');

      // Fetch models + global default in parallel
      const modelsP = fetch('/api/providers/models').then(r => r.ok ? r.json() : null);
      const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

      Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
        if (!modelsData?.groups || modelsData.groups.length === 0) {
          setModelReady(true);
          return;
        }
        const groups = modelsData.groups as Array<{ provider_id: string; models: Array<{ value: string }> }>;
        const globalDefaultModel = globalData?.options?.default_model || '';
        const globalDefaultProvider = globalData?.options?.default_model_provider || '';

        // Validate and apply provider
        if (savedProviderId !== null) {
          const validProvider = groups.find(g => g.provider_id === savedProviderId);
          if (validProvider) {
            setCurrentProviderId(savedProviderId);
          } else {
            setCurrentProviderId('');
            localStorage.removeItem('codepilot:last-provider-id');
          }
        }

        // Apply global default for new conversations
        // Case 1: both provider and model are set and valid
        if (globalDefaultModel && globalDefaultProvider) {
          const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
          const modelValid = targetGroup?.models.some(m => m.value === globalDefaultModel);
          if (modelValid) {
            setCurrentModel(globalDefaultModel);
            setCurrentProviderId(globalDefaultProvider);
            setModelReady(true);
            return;
          }
        }
        // Case 2: provider is set but model was cleared (e.g. after doctor repair / provider delete)
        // → use that provider's first available model
        if (globalDefaultProvider && !globalDefaultModel) {
          const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
          if (targetGroup?.models?.length) {
            setCurrentModel(targetGroup.models[0].value);
            setCurrentProviderId(globalDefaultProvider);
            setModelReady(true);
            return;
          }
        }

        // No global default — validate current model
        const resolvedPid = savedProviderId && groups.find(g => g.provider_id === savedProviderId)
          ? savedProviderId
          : groups[0]?.provider_id || '';
        const resolvedGroup = groups.find(g => g.provider_id === resolvedPid) || groups[0];
        setCurrentProviderId(resolvedPid);
        if (resolvedGroup?.models?.length > 0) {
          const savedModel = localStorage.getItem('codepilot:last-model');
          const validModel = savedModel && resolvedGroup.models.some(
            (m: { value: string }) => m.value === savedModel
          );
          if (validModel) {
            setCurrentModel(savedModel);
          } else {
            const fallback = resolvedGroup.models[0].value;
            setCurrentModel(fallback);
            localStorage.setItem('codepilot:last-model', fallback);
          }
        }
        setModelReady(true);
      }).catch(() => {
        // On fetch failure, still apply localStorage values as-is (best effort)
        if (savedProviderId !== null) setCurrentProviderId(savedProviderId);
        const savedModel = localStorage.getItem('codepilot:last-model');
        if (savedModel) setCurrentModel(savedModel);
        setModelReady(true);
      });
    };
    checkProvider();

    window.addEventListener('provider-changed', checkProvider);
    return () => window.removeEventListener('provider-changed', checkProvider);
  }, []);

  const handleSelectFolder = useCallback(async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t('folderPicker.title') });
      if (path) {
        setWorkingDir(path);
        localStorage.setItem('codepilot:last-working-directory', path);
      }
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t]);

  const handleFolderPickerSelect = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
    setFolderPickerOpen(false);
  }, []);

  const handleSelectProject = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
  }, []);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: denyMessage || 'User denied permission' }
        : {
            behavior: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
          },
    };

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort
    }

    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[]) => {
      if (isStreaming) return;

      // Wait for model/provider to be resolved from the global default before allowing send
      if (!modelReady) return;

      // Require a project directory before sending
      if (!workingDir.trim()) {
        setErrorBanner({ message: t('chat.empty.noDirectory') });
        return;
      }

      // Require a provider before sending
      if (!hasProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return;
      }

      setIsStreaming(true);
      setStreamingContent('');
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const perfTrace = createChatPerfTrace({
        mode,
        workingDir: workingDir.trim(),
        model: currentModel,
        providerId: currentProviderId,
        contentLength: content.length,
      });

      let sessionId = '';

      try {
        // Create a new session with working directory + model/provider
        const createBody: Record<string, string> = {
          title: content.slice(0, 50),
          mode,
          working_directory: workingDir.trim(),
          permission_profile: permissionProfile,
          model: currentModel,
          provider_id: currentProviderId,
        };

        perfTrace.start('session.create.fetch');
        const createRes = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        perfTrace.end('session.create.fetch', { status: createRes.status });

        if (!createRes.ok) {
          const errBody = await createRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to create session (${createRes.status})`);
        }

        const { session }: SessionResponse = await createRes.json();
        sessionId = session.id;
        setCreatedSessionId(sessionId);

        // Notify ChatListPanel to refresh immediately
        window.dispatchEvent(new CustomEvent('session-created'));

        // Add user message to UI — use displayOverride for chat bubble if provided
        const displayUserContent = displayOverride || content;
        const contentWithFileMeta = files && files.length > 0
          ? `<!--files:${JSON.stringify(files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size })))}-->${displayUserContent}`
          : displayUserContent;
        const userMessage: Message = {
          id: 'temp-' + Date.now(),
          session_id: session.id,
          role: 'user',
          content: contentWithFileMeta,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages([userMessage]);

        // Build thinking config from settings
        const thinkingConfig = thinkingMode && thinkingMode !== 'adaptive'
          ? { type: thinkingMode }
          : thinkingMode === 'adaptive' ? { type: 'adaptive' } : undefined;

        // Send the message via streaming API
        perfTrace.start('chat.fetch.headers');
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-codepilot-trace-id': perfTrace.id,
          },
          body: JSON.stringify({
            session_id: session.id,
            content,
            mode,
            model: currentModel,
            provider_id: currentProviderId,
            ...(files && files.length > 0 ? { files } : {}),
            ...(mentions && mentions.length > 0 ? { mentions } : {}),
            ...(systemPromptAppend ? { systemPromptAppend } : {}),
            // 'auto' sentinel means "no explicit effort" — omit so Claude
            // Code CLI applies its per-model default (Opus 4.7 → xhigh).
            ...(selectedEffort && selectedEffort !== 'auto' ? { effort: selectedEffort } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            ...(context1m ? { context_1m: true } : {}),
            ...(displayOverride ? { displayOverride } : {}),
          }),
          signal: controller.signal,
        });
        perfTrace.end('chat.fetch.headers', {
          status: response.status,
          traceId: response.headers.get('x-codepilot-trace-id') || perfTrace.id,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (err?.code === 'NEEDS_PROVIDER_SETUP' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('open-setup-center', {
              detail: { initialCard: err.initialCard ?? 'provider' },
            }));
          }
          throw new Error(err?.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let accumulated = '';
        let tokenUsage: TokenUsage | null = null;
        let buffer = '';
        let firstChunkSeen = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            perfTrace.record('chat.stream.first_chunk', 'frontend');
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const event: SSEEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'text': {
                  accumulated += event.data;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'thinking': {
                  setStreamingThinkingContent((prev) => prev + event.data);
                  break;
                }
                case 'referenced_contexts': {
                  try {
                    const data = JSON.parse(event.data);
                    if (data.files) {
                      setReferencedContexts(data.files);
                    }
                  } catch (e) {
                    console.error('Failed to parse referenced_contexts:', e);
                  }
                  break;
                }
                case 'tool_use': {
                  try {
                    const toolData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolUses((prev) => {
                      if (prev.some((t) => t.id === toolData.id)) return prev;
                      return [...prev, { id: toolData.id, name: toolData.name, input: toolData.input }];
                    });
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolResults((prev) => [...prev, { tool_use_id: resultData.tool_use_id, content: resultData.content }]);
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_output': {
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed._progress) {
                      setStatusText(`Running ${parsed.tool_name}... (${Math.round(parsed.elapsed_time_seconds)}s)`);
                      break;
                    }
                  } catch {
                    // Not JSON — raw stderr output
                  }
                  setStreamingToolOutput((prev) => {
                    const next = prev + (prev ? '\n' : '') + event.data;
                    return next.length > 5000 ? next.slice(-5000) : next;
                  });
                  break;
                }
                case 'status': {
                  try {
                    const statusData = JSON.parse(event.data);
                    if (statusData.subtype === 'perf') {
                      const source = statusData.source === 'route' ? 'route' : 'native';
                      perfTrace.addServerPerf(source, statusData as Record<string, unknown>);
                    } else if (statusData.subtype === 'step_complete') {
                      // silently ignore internal step_complete payloads
                    } else if (statusData.subtype === 'ui_action' && statusData.action) {
                      if (statusData.action === 'open_browser' && typeof statusData.url === 'string') {
                        window.dispatchEvent(new CustomEvent('browser-navigate', {
                          detail: {
                            url: statusData.url,
                            newTab: statusData.newTab !== false,
                          },
                        }));
                      }
                      if (statusData.action === 'open_terminal') {
                        window.dispatchEvent(new CustomEvent('terminal-ensure-visible', {
                          detail: {
                            tab: statusData.tab || 'terminal',
                            terminalId: statusData.terminalId,
                          },
                        }));
                      }
                    } else if (statusData.session_id) {
                      setStatusText(`Connected (${statusData.model || 'claude'})`);
                      setTimeout(() => setStatusText(undefined), 2000);
                    } else if (statusData.notification) {
                      // Shared toast routing so code-driven notifications
                      // (e.g. RUNTIME_EFFORT_IGNORED) survive the next
                      // status-text update on both the first-message flow
                      // (this page) and the ongoing session flow
                      // (useSSEStream via stream-session-manager).
                      maybeShowStatusToast(statusData);
                      setStatusText(statusData.message || statusData.title || undefined);
                    } else {
                      setStatusText(event.data || undefined);
                    }
                  } catch {
                    setStatusText(event.data || undefined);
                  }
                  break;
                }
                case 'result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.usage) tokenUsage = resultData.usage;
                    // Phase 1: seed terminal_reason into the snapshot the
                    // redirected ChatView will read so first-turn
                    // prompt_too_long / blocking_limit / max_turns /
                    // hook_stopped can still surface the chip + action
                    // buttons in the post-redirect view.
                    if (resultData.terminal_reason && session?.id) {
                      seedSnapshotPatch(session.id, {
                        terminalReason: resultData.terminal_reason as string,
                      });
                    }
                  } catch { /* skip */ }
                  setStatusText(undefined);
                  break;
                }
                case 'rate_limit': {
                  // Phase 2: subscription rate-limit telemetry. Seed the
                  // snapshot so RateLimitBanner renders after redirect.
                  try {
                    const info = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { rateLimitInfo: info });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'context_usage': {
                  // Phase 5 extension-point; no producer currently (see
                  // b65c6ac). Seed the snapshot for forward compatibility.
                  try {
                    const snap = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { contextUsageSnapshot: snap });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'thinking': {
                  // Opus 4.7 with display: 'summarized' streams reasoning
                  // as thinking deltas. Accumulate them into the same
                  // streamingThinkingContent surface that ChatView's
                  // MessageList already renders, so the first-turn UI
                  // shows the reasoning block as it streams in. Backend
                  // /api/chat/route.ts separately persists thinking as a
                  // content-block JSON on the assistant message, so the
                  // redirected ChatView gets a fully-formed message from
                  // DB — this branch is for the pre-redirect live view.
                  setStreamingThinkingContent((prev) => prev + event.data);
                  break;
                }
                case 'permission_request': {
                  try {
                    const permData: PermissionRequestEvent = JSON.parse(event.data);
                    setPendingPermission(permData);
                    setPermissionResolved(null);
                    setPendingApprovalSessionId(sessionId);
                  } catch {
                    // skip malformed permission_request data
                  }
                  break;
                }
                case 'error': {
                  // Try to parse structured error JSON from classifier
                  let errorDisplay: string;
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.category && parsed.userMessage) {
                      errorDisplay = parsed.userMessage;
                      if (parsed.actionHint) errorDisplay += `\n\n**What to do:** ${parsed.actionHint}`;
                      if (parsed.details) errorDisplay += `\n\nDetails: ${parsed.details}`;
                      // Add diagnostic guidance for provider/auth related errors
                      const diagCategories = new Set([
                        'AUTH_REJECTED', 'AUTH_FORBIDDEN', 'AUTH_STYLE_MISMATCH',
                        'NO_CREDENTIALS', 'PROVIDER_NOT_APPLIED', 'MODEL_NOT_AVAILABLE',
                        'NETWORK_UNREACHABLE', 'ENDPOINT_NOT_FOUND', 'PROCESS_CRASH',
                        'CLI_NOT_FOUND', 'UNSUPPORTED_FEATURE',
                      ]);
                      if (diagCategories.has(parsed.category)) {
                        errorDisplay += '\n\n💡 [Run Provider Diagnostics](/settings#providers) to troubleshoot, or check the [Provider Setup Guide](https://www.codepilot.sh/docs/providers).';
                      }
                    } else {
                      errorDisplay = event.data;
                    }
                  } catch {
                    errorDisplay = event.data;
                  }
                  accumulated += '\n\n**Error:** ' + errorDisplay;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'done':
                  break;
              }
            } catch {
              // skip
            }
          }
        }
        perfTrace.record('chat.stream.completed', 'frontend');

        // Add the completed assistant message
        if (accumulated.trim()) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: session.id,
            role: 'assistant',
            content: accumulated.trim(),
            created_at: new Date().toISOString(),
            token_usage: tokenUsage ? JSON.stringify(tokenUsage) : null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        // Navigate to the session page after response is complete
        perfTrace.finish('completed', {
          sessionId: session.id,
          outputLength: accumulated.length,
        });
        router.push(`/chat/${session.id}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          perfTrace.finish('aborted', { sessionId });
          // User stopped - navigate to session if we have one
          if (sessionId) {
            router.push(`/chat/${sessionId}`);
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          perfTrace.finish('failed', { sessionId, message: errMsg });
          setErrorBanner({ message: t('error.sessionCreateFailed'), description: errMsg });
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingThinkingContent('');
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
      }
    },
    [isStreaming, router, workingDir, mode, currentModel, currentProviderId, permissionProfile, selectedEffort, thinkingMode, context1m, setPendingApprovalSessionId, t, hasProvider, modelReady]
  );

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Available Commands\n\n- **/help** - Show this help message\n- **/clear** - Clear conversation history\n- **/compact** - Compress conversation context\n- **/cost** - Show token usage statistics\n- **/doctor** - Check system health\n- **/init** - Initialize CLAUDE.md\n- **/review** - Start code review\n- **/terminal-setup** - Configure terminal\n\n**Tips:**\n- Type \`@\` to mention files\n- Use Shift+Enter for new line\n- Select a project folder to enable file operations`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        break;
      case '/cost': {
        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Token Usage\n\nToken usage tracking is available after sending messages. Check the token count displayed at the bottom of each assistant response.`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        sendFirstMessage(command);
    }
  }, [sendFirstMessage]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length === 0 && !isStreaming && (!workingDir.trim() || !hasProvider) ? (
        <ChatEmptyState
          hasDirectory={!!workingDir.trim()}
          hasProvider={hasProvider}
          onSelectFolder={handleSelectFolder}
          recentProjects={recentProjects}
          onSelectProject={handleSelectProject}
          assistantConfigured={assistantConfigured}
          onOpenAssistant={() => {
            if (assistantConfigured) {
              // Navigate to the latest assistant session
              fetch(`/api/workspace/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'checkin' }),
              })
                .then(r => r.json())
                .then(data => router.push(`/chat/${data.session.id}`))
                .catch(() => {});
            } else if (assistantWorkspacePath) {
              setShowWizard(true);
            } else {
              router.push('/settings#assistant');
            }
          }}
        />
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          streamingThinkingContent={streamingThinkingContent}
          isStreaming={isStreaming}
          sessionId={createdSessionId}
          toolUses={toolUses}
          toolResults={toolResults}
          streamingToolOutput={streamingToolOutput}
          statusText={statusText}
        />
      )}
      {errorBanner && (
        <ErrorBanner
          message={errorBanner.message}
          description={errorBanner.description}
          className="mx-4 mb-2"
          onDismiss={() => setErrorBanner(null)}
          actions={[
            { label: t('error.retry'), onClick: () => setErrorBanner(null) },
          ]}
        />
      )}
      <PermissionPrompt
        pendingPermission={pendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
      />
      <MessageInput
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={!modelReady}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={(pid, model) => {
          setCurrentProviderId(pid);
          setCurrentModel(model);
          localStorage.setItem('codepilot:last-provider-id', pid);
          localStorage.setItem('codepilot:last-model', model);
        }}
        workingDirectory={workingDir}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        initialValue={prefillText}
      />
      <ChatComposerActionBar
        left={<><ModeIndicator mode={mode} onModeChange={setMode} disabled={isStreaming} /><ImageGenToggle /></>}
        center={
          <ChatPermissionSelector
            permissionProfile={permissionProfile}
            onPermissionChange={setPermissionProfile}
          />
        }
      />
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderPickerSelect}
      />
      {showWizard && assistantWorkspacePath && (
        <OnboardingWizard
          workspacePath={assistantWorkspacePath}
          onComplete={(session) => {
            setShowWizard(false);
            setAssistantConfigured(true);
            router.push(`/chat/${session.id}`);
          }}
        />
      )}
    </div>
  );
}
