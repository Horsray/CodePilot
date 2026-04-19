import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const GLOBAL_KEY = '__persistentClaudeSessions__' as const;

class AsyncUserMessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private readonly waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  enqueue(message: SDKUserMessage): void {
    if (this.closed) {
      throw new Error('Persistent Claude input queue is closed');
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: message, done: false });
      return;
    }
    this.items.push(message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

interface PersistentClaudeEntry {
  codepilotSessionId: string;
  signature: string;
  input: AsyncUserMessageQueue;
  query: Query;
  iterator: AsyncIterator<SDKMessage>;
  turnLock: Promise<void>;
  releaseTurn: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
}

export interface PersistentClaudeTurn {
  conversation: AsyncIterable<SDKMessage>;
  query: Query;
  reused: boolean;
}

function getStore(): Map<string, PersistentClaudeEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, PersistentClaudeEntry>();
  }
  return g[GLOBAL_KEY] as Map<string, PersistentClaudeEntry>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'function' && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function mcpSignature(mcpServers: Options['mcpServers']): unknown {
  if (!mcpServers) return {};
  const out: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    const s = server as Record<string, unknown>;
    out[name] = {
      type: s.type,
      command: s.command,
      args: s.args,
      url: s.url,
      name: s.name,
    };
  }
  return out;
}

export function buildPersistentClaudeSignature(params: {
  providerKey: string;
  options: Options;
}): string {
  const env = params.options.env || {};
  return stableStringify({
    providerKey: params.providerKey,
    cwd: params.options.cwd,
    model: params.options.model,
    systemPrompt: params.options.systemPrompt,
    settingSources: params.options.settingSources,
    permissionMode: params.options.permissionMode,
    allowedTools: params.options.allowedTools,
    disallowedTools: params.options.disallowedTools,
    tools: params.options.tools,
    mcpServers: mcpSignature(params.options.mcpServers),
    outputFormat: params.options.outputFormat,
    extraArgs: params.options.extraArgs,
    agents: params.options.agents,
    agent: params.options.agent,
    thinking: params.options.thinking,
    effort: params.options.effort,
    betas: params.options.betas,
    enableFileCheckpointing: params.options.enableFileCheckpointing,
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      ANTHROPIC_REASONING_MODEL: env.ANTHROPIC_REASONING_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      authKind: env.ANTHROPIC_AUTH_TOKEN ? 'auth_token' : env.ANTHROPIC_API_KEY ? 'api_key' : 'none',
    },
  });
}

function clearIdleTimer(entry: PersistentClaudeEntry): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function scheduleIdleClose(sessionId: string, entry: PersistentClaudeEntry): void {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    const current = getStore().get(sessionId);
    if (current === entry && Date.now() - entry.lastUsedAt >= IDLE_TIMEOUT_MS) {
      closePersistentClaudeSession(sessionId);
    }
  }, IDLE_TIMEOUT_MS);
}

function closeEntry(entry: PersistentClaudeEntry): void {
  clearIdleTimer(entry);
  entry.input.close();
  try { entry.query.close(); } catch { /* best effort */ }
  if (entry.releaseTurn) {
    entry.releaseTurn();
    entry.releaseTurn = null;
  }
}

function createEntry(
  codepilotSessionId: string,
  signature: string,
  options: Options,
): PersistentClaudeEntry {
  const input = new AsyncUserMessageQueue();
  const persistentQuery = query({ prompt: input, options });
  return {
    codepilotSessionId,
    signature,
    input,
    query: persistentQuery,
    iterator: persistentQuery[Symbol.asyncIterator](),
    turnLock: Promise.resolve(),
    releaseTurn: null,
    idleTimer: null,
    lastUsedAt: Date.now(),
  };
}

async function acquireTurn(entry: PersistentClaudeEntry): Promise<() => void> {
  let release!: () => void;
  const previous = entry.turnLock;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  entry.turnLock = previous.then(() => current);
  await previous;
  entry.releaseTurn = release;
  return () => {
    if (entry.releaseTurn === release) entry.releaseTurn = null;
    release();
  };
}

export function getPersistentClaudeTurn(params: {
  codepilotSessionId: string;
  signature: string;
  options: Options;
  messages: SDKUserMessage[];
}): PersistentClaudeTurn {
  const store = getStore();
  const existing = store.get(params.codepilotSessionId);
  let entry = existing;
  let reused = !!entry && entry.signature === params.signature;

  if (entry && entry.signature !== params.signature) {
    closeEntry(entry);
    store.delete(params.codepilotSessionId);
    entry = undefined;
  }

  if (!entry) {
    entry = createEntry(params.codepilotSessionId, params.signature, params.options);
    store.set(params.codepilotSessionId, entry);
    reused = false;
  }

  clearIdleTimer(entry);

  const conversation = (async function* (): AsyncGenerator<SDKMessage> {
    const release = await acquireTurn(entry!);
    try {
      entry!.lastUsedAt = Date.now();
      for (const message of params.messages) {
        entry!.input.enqueue(message);
      }

      while (true) {
        const next = await entry!.iterator.next();
        if (next.done) {
          closePersistentClaudeSession(params.codepilotSessionId);
          return;
        }
        yield next.value;
        if (next.value.type === 'result') {
          entry!.lastUsedAt = Date.now();
          scheduleIdleClose(params.codepilotSessionId, entry!);
          return;
        }
      }
    } catch (error) {
      closePersistentClaudeSession(params.codepilotSessionId);
      throw error;
    } finally {
      release();
    }
  })();

  return { conversation, query: entry.query, reused };
}

export function closePersistentClaudeSession(sessionId: string): void {
  const store = getStore();
  const entry = store.get(sessionId);
  if (!entry) return;
  store.delete(sessionId);
  closeEntry(entry);
}

export function closeAllPersistentClaudeSessions(): void {
  const store = getStore();
  for (const entry of store.values()) {
    closeEntry(entry);
  }
  store.clear();
}

export function hasPersistentClaudeSession(sessionId: string): boolean {
  return getStore().has(sessionId);
}

export function canReusePersistentClaudeSession(sessionId: string, signature: string): boolean {
  return getStore().get(sessionId)?.signature === signature;
}

export function getPersistentClaudeSessionCount(): number {
  return getStore().size;
}
