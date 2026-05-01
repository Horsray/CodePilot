import { query, startup } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage, SDKUserMessage, SDKSystemMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'node:crypto';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// 中文注释：功能名称「会话预热超时」，用法是预热阶段等待 system/init 的最大时间，
// 超时后放弃预热，正常进入对话界面，避免用户无限等待
const WARMUP_TIMEOUT_MS = 15_000;

// 中文注释：功能名称「预热后的空闲超时」，用法是预热完成后 session 保持存活的时间，
// 与 IDLE_TIMEOUT_MS 相同为 30 分钟，确保相近对话不需要重新加载
const WARMUP_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const GLOBAL_KEY = '__persistentClaudeSessions__' as const;
const WARM_QUERY_GLOBAL_KEY = '__warmClaudeQueries__' as const;
const PENDING_WARMUP_GLOBAL_KEY = '__pendingWarmupPromises__' as const;

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

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.items.length > 0) {
          return { value: this.items.shift()!, done: false };
        }
        if (this.closed) {
          return { value: undefined as never, done: true };
        }
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: async (): Promise<IteratorResult<SDKUserMessage>> => {
        this.close();
        return { value: undefined as never, done: true };
      },
      throw: async (e?: any): Promise<IteratorResult<SDKUserMessage>> => {
        this.close();
        throw e;
      }
    };
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
  shadowHandle?: { cleanup: () => void };
  // 中文注释：预热数据缓存，warmup 阶段读取 system/init 后存入，后续 getPersistentClaudeTurn 复用
  warmedUp: boolean;
  warmupPromise?: Promise<PersistentClaudeInitData | null> | null;
  initData?: {
    model: string;
    session_id: string;
    tools?: unknown;
    slash_commands?: unknown;
    skills?: unknown;
    agents?: unknown;
    plugins?: Array<{ name: string; path: string }>;
    mcp_servers?: unknown;
  };
  // 动态引用：用于在预热或后续复用时，将 SDK 内部触发的事件委托给最新一轮的回调函数
  currentOptions?: Options;
}

interface WarmClaudeQueryEntry {
  codepilotSessionId: string;
  signature: string;
  warmQuery: WarmQuery;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
  shadowHandle?: { cleanup: () => void };
}

export interface WarmClaudeQueryHandle {
  warmQuery: WarmQuery;
  cleanup: () => void;
}

export interface PersistentClaudeTurn {
  conversation: AsyncIterable<SDKMessage>;
  query: Query;
  reused: boolean;
}

// 中文注释：导出预热返回的 init 数据类型，供 warmup API 路由使用
export interface PersistentClaudeInitData {
  model: string;
  session_id: string;
  tools?: unknown;
  slash_commands?: unknown;
  skills?: unknown;
  agents?: unknown;
  plugins?: Array<{ name: string; path: string }>;
  mcp_servers?: unknown;
}

export function extractWarmupInitData(message: SDKSystemMessage): PersistentClaudeInitData | null {
  if (!(message.type === 'system' && 'subtype' in message && message.subtype === 'init')) {
    return null;
  }

  return {
    model: (message as Record<string, unknown>).model as string || '',
    session_id: (message as Record<string, unknown>).session_id as string || '',
    tools: (message as Record<string, unknown>).tools,
    slash_commands: (message as Record<string, unknown>).slash_commands,
    skills: (message as Record<string, unknown>).skills,
    agents: (message as Record<string, unknown>).agents,
    plugins: (message as Record<string, unknown>).plugins as PersistentClaudeInitData['plugins'],
    mcp_servers: (message as Record<string, unknown>).mcp_servers,
  };
}

export function isWarmupSkippableSystemMessage(message: SDKSystemMessage): boolean {
  if (!(message.type === 'system' && 'subtype' in message)) {
    return false;
  }

  return message.subtype !== 'init';
}

function getStore(): Map<string, PersistentClaudeEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, PersistentClaudeEntry>();
  }
  return g[GLOBAL_KEY] as Map<string, PersistentClaudeEntry>;
}

function getWarmQueryStore(): Map<string, WarmClaudeQueryEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[WARM_QUERY_GLOBAL_KEY]) {
    g[WARM_QUERY_GLOBAL_KEY] = new Map<string, WarmClaudeQueryEntry>();
  }
  return g[WARM_QUERY_GLOBAL_KEY] as Map<string, WarmClaudeQueryEntry>;
}

// 中文注释：功能名称「预热进行中注册表」，用法是记录正在执行的 startup() 操作，
// 让后续同签名的 warmup 请求可以等待已有预热完成，避免重复 startup()。
function getPendingWarmupStore(): Map<string, Promise<boolean>> {
  const g = globalThis as Record<string, unknown>;
  if (!g[PENDING_WARMUP_GLOBAL_KEY]) {
    g[PENDING_WARMUP_GLOBAL_KEY] = new Map<string, Promise<boolean>>();
  }
  return g[PENDING_WARMUP_GLOBAL_KEY] as Map<string, Promise<boolean>>;
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

function pluginSignature(plugins: Options['plugins']): unknown {
  if (!plugins || plugins.length === 0) return [];
  return [...plugins]
    .map((plugin) => ({
      type: plugin.type,
      path: plugin.path,
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function systemPromptSignature(systemPrompt: Options['systemPrompt']): unknown {
  // ═══════════════════════════════════════════════════════
  // ⚠️ 版本升级提示（修改签名逻辑前必读）⚠️
  // ═══════════════════════════════════════════════════════
  // 当前签名版本：SIG_VERSION = 1
  //
  // 什么时候需要升级 SIG_VERSION？
  //   1. 新增字段到白名单（如 metadata、context 等）
  //   2. 删除已有的签名字段
  //   3. 修改签名计算逻辑（如更换 hash 算法）
  //
  // 如何升级？
  //   1. 将 SIG_VERSION 从当前值 +1（如 1 → 2）
  //   2. 更新下方注释中的"当前白名单"列表
  //   3. 确保所有返回值都包含新的 sigVersion 字段
  //
  // 为什么必须升级？
  //   版本号不同会导致签名不匹配，旧 session 会被自动废弃并重建新 session，
  //   这样可以避免用错误的签名复用到不兼容的旧 session。
  // ═══════════════════════════════════════════════════════
  const SIG_VERSION = 1;

  if (!systemPrompt) return { sigVersion: SIG_VERSION, type: 'null' };
  if (typeof systemPrompt === 'string') {
    // 字符串类型 systemPrompt 直接计算 hash（这种情况很少见）
    return { sigVersion: SIG_VERSION, type: 'string', hash: hashValue(systemPrompt) };
  }
  const prompt = systemPrompt as Record<string, unknown>;
  // 中文注释：签名采用白名单模式，只包含确定会影响 session 身份的字段。
  // 当前白名单：type、preset（不含 append）。
  //
  // 为什么排除 append？
  //   append 包含大量 volatile 内容（Todo 状态、Dashboard、memory hint、
  //   assistant instructions 等），每轮都会变化。如果把 append 纳入签名，
  //   持久化 session 每轮都会重建，完全失去 warmup 复用的意义。
  //   volatile 内容通过每轮的 systemPrompt 参数直接传入，不需要签名匹配。
  //
  // 如何新增字段到白名单？
  //   1. 升级上方的 SIG_VERSION
  //   2. 在下方 return 中添加新字段，如：newField: prompt.newField
  //   3. 更新本注释中的"当前白名单"列表
  return {
    sigVersion: SIG_VERSION,  // 签名版本号，升级时修改上方 SIG_VERSION
    type: prompt.type,         // 系统提示类型（如 'preset'）
    preset: prompt.preset,     // 预设名称（如 'claude_code'）
    // 新增字段示例：newField: prompt.newField,  // 记得先升级 SIG_VERSION
  };
}

export function buildPersistentClaudeSignature(params: {
  providerKey: string;
  options: Options;
}): string {
  const env = params.options.env || {};
  // 中文注释：签名包含 SDK session 身份字段和 system prompt（仅 type/preset，不含 append）。
  // append 内容是 volatile 的（Todo 状态、Dashboard、memory hint 等每轮都变），
  // 纳入签名会导致每轮重建 session，失去 warmup 复用意义。
  // volatile 内容通过每轮 systemPrompt 参数直接传入 SDK。
  //
  // 排除的字段及其原因：
  // - plugins：需要保留，因为插件图会改变 hook、skills、rules 与 OMC 接管行为，
  //   若不纳入签名，可能复用到”未挂插件”的预热进程，造成配置与实际运行不一致
  // - allowedTools / tools / disallowedTools：权限配置，不影响 session 身份
  // - agents / agent：per-message 配置，warmup 不设置
  // - thinking / effort / betas：per-message 配置，warmup 不设置
  // - enableFileCheckpointing / outputFormat：per-message 配置
  // 注意：warmup 和 chat 的 append 内容可能不同，导致签名不匹配，预热 session 被销毁。
  // 这是预期行为，确保模型能看到最新的 volatile 上下文。
  return stableStringify({
    providerKey: params.providerKey,
    cwd: params.options.cwd,
    model: params.options.model,
    settingSources: params.options.settingSources,
    plugins: pluginSignature(params.options.plugins),
    systemPrompt: systemPromptSignature(params.options.systemPrompt),
    mcpServers: mcpSignature(params.options.mcpServers),
    permissionMode: params.options.permissionMode,
    extraArgs: params.options.extraArgs,
    pathToClaudeCodeExecutable: params.options.pathToClaudeCodeExecutable,
    includeHookEvents: params.options.includeHookEvents,
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

function clearWarmQueryIdleTimer(entry: WarmClaudeQueryEntry): void {
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

function closeWarmQueryEntry(entry: WarmClaudeQueryEntry): void {
  clearWarmQueryIdleTimer(entry);
  try { entry.warmQuery.close(); } catch { /* best effort */ }
  if (entry.shadowHandle) {
    entry.shadowHandle.cleanup();
  }
}

function scheduleWarmQueryIdleClose(sessionId: string, entry: WarmClaudeQueryEntry): void {
  clearWarmQueryIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    const current = getWarmQueryStore().get(sessionId);
    if (current === entry && Date.now() - entry.lastUsedAt >= WARMUP_IDLE_TIMEOUT_MS) {
      closeWarmedNativeClaudeQuery(sessionId);
    }
  }, WARMUP_IDLE_TIMEOUT_MS);
}

function closeEntry(entry: PersistentClaudeEntry): void {
  clearIdleTimer(entry);
  entry.input.close();
  try { entry.query.close(); } catch { /* best effort */ }
  if (entry.releaseTurn) {
    entry.releaseTurn();
    entry.releaseTurn = null;
  }
  if (entry.shadowHandle) {
    entry.shadowHandle.cleanup();
  }
}

function createEntry(
  codepilotSessionId: string,
  signature: string,
  options: Options,
  shadowHandle?: { cleanup: () => void }
): PersistentClaudeEntry {
  const input = new AsyncUserMessageQueue();
  
  const entry: Partial<PersistentClaudeEntry> = {
    codepilotSessionId,
    signature,
    input,
    turnLock: Promise.resolve(),
    releaseTurn: null,
    idleTimer: null,
    lastUsedAt: Date.now(),
    shadowHandle,
    warmedUp: false,
    warmupPromise: null,
    currentOptions: options,
  };

  // 使用 Proxy Options 包装，将底层 SDK 的回调委托给当轮最新的 currentOptions
  const proxyOptions: Options = {
    ...options,
    canUseTool: async (toolName, toolInput, opts) => {
      if (entry.currentOptions?.canUseTool) {
        return entry.currentOptions.canUseTool(toolName, toolInput, opts);
      }
      return {
        behavior: 'deny',
        message: 'Permission handler unavailable',
        interrupt: false,
      } as any;
    },
    stderr: (data) => {
      if (entry.currentOptions?.stderr) {
        entry.currentOptions.stderr(data);
      }
    },
    // 其他需要的动态回调如果后续加入也可以在这里拦截代理
  };

  const persistentQuery = query({ prompt: input, options: proxyOptions });
  entry.query = persistentQuery;
  entry.iterator = persistentQuery[Symbol.asyncIterator]();

  return entry as PersistentClaudeEntry;
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
  shadowHandle?: { cleanup: () => void };
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
    entry = createEntry(params.codepilotSessionId, params.signature, params.options, params.shadowHandle);
    store.set(params.codepilotSessionId, entry);
    reused = false;
  } else if (reused) {
    // 中文注释：功能名称「动态回调委托更新」，用法是在复用预热或旧 session 时，
    // 将当前请求最新的 options（包含新的 canUseTool 和 stderr 等回调）赋值给 entry，
    // 使得底层代理能够把事件正确路由到当前的 SSE 连接。
    entry.currentOptions = params.options;
  }

  clearIdleTimer(entry);

  const conversation = (async function* (): AsyncGenerator<SDKMessage> {
    const release = await acquireTurn(entry!);
    try {
      if (entry!.warmupPromise) {
        await entry!.warmupPromise.catch(() => null);
      }
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

// 中文注释：功能名称「官方 WarmQuery 预热缓存」，用法是在会话页提前调用 Claude SDK
// 官方 startup() 预热 CLI 子进程，并在首轮纯文本消息时直接消费这个 WarmQuery，
// 保持 UserPromptSubmit 的原生 string prompt 形态，同时缩短首句冷启动延迟。
// 新增去重逻辑：如果同签名的 startup() 正在进行中，等待它完成而不是重复启动。
export async function warmupNativeClaudeQuery(params: {
  codepilotSessionId: string;
  signature: string;
  options: Options;
  shadowHandle?: { cleanup: () => void };
}): Promise<boolean> {
  const store = getWarmQueryStore();
  const existing = store.get(params.codepilotSessionId);

  if (existing && existing.signature === params.signature) {
    existing.lastUsedAt = Date.now();
    scheduleWarmQueryIdleClose(params.codepilotSessionId, existing);
    return true;
  }

  if (existing) {
    closeWarmQueryEntry(existing);
    store.delete(params.codepilotSessionId);
  }

  // 中文注释：去重检查——如果同签名的 startup() 正在进行中，等待它完成
  const pendingStore = getPendingWarmupStore();
  const pendingKey = params.signature;
  const pendingPromise = pendingStore.get(pendingKey);
  if (pendingPromise) {
    console.log('[warmup] Same-signature startup() in progress, waiting for it to complete...');
    try {
      const result = await pendingPromise;
      if (result) {
        // 中文注释：已有预热完成，尝试 adopt 到当前 sessionId
        adoptWarmedNativeClaudeQueryBySignature(params.signature, params.codepilotSessionId);
        if (hasWarmedNativeClaudeQuery(params.codepilotSessionId, params.signature)) {
          console.log('[warmup] Adopted completed warmup for', params.codepilotSessionId);
          return true;
        }
      }
    } catch (error) {
      // 中文注释：已有预热失败（pendingPromise reject），清理 pendingStore 并继续执行新的 startup()
      console.log('[warmup] Previous warmup failed, starting new startup() for', params.codepilotSessionId);
    }
    // 注意：不在这里删除 pendingKey，因为 finally 块会在 startupPromise 完成后统一清理
  }

  // 中文注释：注册当前 startup() 到 pending store，让后续同签名的请求可以等待
  const startupPromise = (async (): Promise<boolean> => {
    try {
      const warmQuery = await startup({ options: params.options });
      const entry: WarmClaudeQueryEntry = {
        codepilotSessionId: params.codepilotSessionId,
        signature: params.signature,
        warmQuery,
        idleTimer: null,
        lastUsedAt: Date.now(),
        shadowHandle: params.shadowHandle,
      };
      store.set(params.codepilotSessionId, entry);
      scheduleWarmQueryIdleClose(params.codepilotSessionId, entry);
      return true;
    } catch (error) {
      params.shadowHandle?.cleanup();
      throw error;
    } finally {
      pendingStore.delete(pendingKey);
    }
  })();

  pendingStore.set(pendingKey, startupPromise);
  return startupPromise;
}

export function hasWarmedNativeClaudeQuery(sessionId: string, signature: string): boolean {
  return getWarmQueryStore().get(sessionId)?.signature === signature;
}

// 中文注释：功能名称「按 sessionId 查找预热」，用法是只按 sessionId 查找 WarmQuery，
// 不检查签名。签名匹配策略在实践中几乎不可能让 warmup route 和 chat route 产生
// 完全一致的签名（MCP 对象不可序列化、env 差异、settingSources 差异等），
// 导致 WarmQuery 永远无法被消费。改为 sessionId 直接查找，确保预热成果可被消费。
export function hasWarmedNativeClaudeQueryBySessionId(sessionId: string): boolean {
  return getWarmQueryStore().has(sessionId);
}

export function adoptWarmedNativeClaudeQueryBySignature(signature: string, targetSessionId: string): boolean {
  const store = getWarmQueryStore();
  if (store.has(targetSessionId)) {
    return store.get(targetSessionId)?.signature === signature;
  }

  for (const [sessionId, entry] of store.entries()) {
    if (entry.signature !== signature) continue;
    if (sessionId === targetSessionId) return true;
    store.delete(sessionId);
    entry.codepilotSessionId = targetSessionId;
    store.set(targetSessionId, entry);
    return true;
  }

  return false;
}

export function takeWarmedNativeClaudeQuery(params: {
  codepilotSessionId: string;
  signature: string;
}): WarmClaudeQueryHandle | null {
  const store = getWarmQueryStore();
  const entry = store.get(params.codepilotSessionId);
  if (!entry || entry.signature !== params.signature) {
    return null;
  }

  store.delete(params.codepilotSessionId);
  clearWarmQueryIdleTimer(entry);

  return {
    warmQuery: entry.warmQuery,
    cleanup: () => {
      if (entry.shadowHandle) {
        entry.shadowHandle.cleanup();
        entry.shadowHandle = undefined;
      }
    },
  };
}

// 中文注释：功能名称「按 sessionId 取出预热」，用法是只按 sessionId 取出 WarmQuery，
// 不检查签名。与 hasWarmedNativeClaudeQueryBySessionId 配套使用，
// 确保 warmup route 的预热成果能被 chat route 消费。
export function takeWarmedNativeClaudeQueryBySessionId(sessionId: string): WarmClaudeQueryHandle | null {
  const store = getWarmQueryStore();
  const entry = store.get(sessionId);
  if (!entry) {
    return null;
  }

  store.delete(sessionId);
  clearWarmQueryIdleTimer(entry);

  return {
    warmQuery: entry.warmQuery,
    cleanup: () => {
      if (entry.shadowHandle) {
        entry.shadowHandle.cleanup();
        entry.shadowHandle = undefined;
      }
    },
  };
}

// 中文注释：功能名称「会话预热」，用法是在用户进入会话时提前启动 SDK 子进程，
// 读取 system/init 事件后将 init 数据缓存到 entry 上。
// 后续 getPersistentClaudeTurn 复用时，iterator 已越过 init 事件，直接处理用户消息。
// 预热超时或签名不匹配时返回 null，前端正常进入对话界面，不阻塞用户操作。
export async function warmupPersistentClaudeSession(params: {
  codepilotSessionId: string;
  signature: string;
  options: Options;
  shadowHandle?: { cleanup: () => void };
}): Promise<PersistentClaudeInitData | null> {
  const store = getStore();
  let entry = store.get(params.codepilotSessionId);

  // 中文注释：已预热且签名匹配，直接返回缓存的 init 数据
  if (entry && entry.warmedUp && entry.signature === params.signature && entry.initData) {
    return entry.initData;
  }

  if (entry && entry.signature === params.signature && entry.warmupPromise) {
    return entry.warmupPromise;
  }

  // 中文注释：签名不匹配，销毁旧 session 重新预热
  if (entry && entry.signature !== params.signature) {
    closeEntry(entry);
    store.delete(params.codepilotSessionId);
    entry = undefined;
  }

  if (!entry) {
    entry = createEntry(
      params.codepilotSessionId,
      params.signature,
      params.options,
      params.shadowHandle,
    );
    store.set(params.codepilotSessionId, entry);
    entry.warmupPromise = (async () => {
      try {
        // 中文注释：功能名称「预热 init 等待容错」，用法是在开启 hook 事件后，
        // 允许 system/init 之前先收到 hook_started、hook_progress 等系统事件，
        // 继续等待真正的 init，而不是把预热误判为失败。
        const deadline = Date.now() + WARMUP_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const remainingMs = deadline - Date.now();
          const nextPromise = entry.iterator.next();
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Warmup timeout')), remainingMs),
          );

          const next = await Promise.race([nextPromise, timeoutPromise]);

          if (next.done) {
            closePersistentClaudeSession(params.codepilotSessionId);
            return null;
          }

          const msg = next.value as SDKSystemMessage;
          const initData = extractWarmupInitData(msg);
          if (initData) {
          entry.warmedUp = true;
          entry.initData = initData;
          entry.lastUsedAt = Date.now();

          // 中文注释：预热完成后启动空闲超时，30 分钟内无消息则关闭 session
          scheduleWarmupIdleClose(params.codepilotSessionId, entry);

          return initData;
        }

          if (isWarmupSkippableSystemMessage(msg)) {
            continue;
          }

          console.warn('[persistent-claude-session] Warmup: received non-init message before init:', msg.type);
          closePersistentClaudeSession(params.codepilotSessionId);
          return null;
        }

        closePersistentClaudeSession(params.codepilotSessionId);
        return null;
      } catch (error) {
        console.warn('[persistent-claude-session] Warmup failed:', error);
        closePersistentClaudeSession(params.codepilotSessionId);
        return null;
      } finally {
        entry.warmupPromise = null;
      }
    })();

    return entry.warmupPromise;
  }

  return null;
}

// 中文注释：预热后空闲超时调度，与 IDLE_TIMEOUT_MS 相同为 30 分钟
function scheduleWarmupIdleClose(sessionId: string, entry: PersistentClaudeEntry): void {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    const current = getStore().get(sessionId);
    if (current === entry && Date.now() - entry.lastUsedAt >= WARMUP_IDLE_TIMEOUT_MS) {
      closePersistentClaudeSession(sessionId);
    }
  }, WARMUP_IDLE_TIMEOUT_MS);
}

// 中文注释：检查指定 session 是否已完成预热
export function isSessionWarmedUp(sessionId: string): boolean {
  const entry = getStore().get(sessionId);
  return !!(entry?.warmedUp);
}

// 中文注释：获取预热缓存的 init 数据
export function getWarmedUpInitData(sessionId: string): PersistentClaudeInitData | null {
  const entry = getStore().get(sessionId);
  return entry?.initData ?? null;
}

// 中文注释：功能名称「预热 PersistentSession 并发创建」，用法是在 warmup 阶段
// 同时创建 PersistentClaudeEntry 和 WarmQuery，确保首轮快速响应（WarmQuery 已预热）
// 且后续轮次也能复用 PersistentSession，避免 WarmQuery one-shot 消费后没有
// PersistentSession 可用，导致第二轮显示 "Reconnecting to previous conversation..."
// 并必须冷启动新的 CLI 子进程。
export function ensurePersistentClaudeSession(
  codepilotSessionId: string,
  signature: string,
  options: Options,
  shadowHandle?: { cleanup: () => void },
): void {
  const store = getStore();
  const existing = store.get(codepilotSessionId);
  if (existing) {
    if (existing.signature === signature) {
      existing.lastUsedAt = Date.now();
      scheduleIdleClose(codepilotSessionId, existing);
      return;
    }
    closeEntry(existing);
    store.delete(codepilotSessionId);
  }
  const entry = createEntry(codepilotSessionId, signature, options, shadowHandle);
  store.set(codepilotSessionId, entry);
  scheduleIdleClose(codepilotSessionId, entry);
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

export function closeWarmedNativeClaudeQuery(sessionId: string): void {
  const store = getWarmQueryStore();
  const entry = store.get(sessionId);
  if (!entry) return;
  store.delete(sessionId);
  closeWarmQueryEntry(entry);
}

export function closeAllWarmedNativeClaudeQueries(): void {
  const store = getWarmQueryStore();
  for (const entry of store.values()) {
    closeWarmQueryEntry(entry);
  }
  store.clear();
}

export function hasPersistentClaudeSession(sessionId: string): boolean {
  return getStore().has(sessionId);
}

export function canReusePersistentClaudeSession(sessionId: string, signature: string): boolean {
  return getStore().get(sessionId)?.signature === signature;
}

export function adoptPersistentClaudeSessionBySignature(signature: string, targetSessionId: string): boolean {
  const store = getStore();
  if (store.has(targetSessionId)) {
    return store.get(targetSessionId)?.signature === signature;
  }

  for (const [sessionId, entry] of store.entries()) {
    if (entry.signature !== signature) continue;
    if (sessionId === targetSessionId) return true;
    store.delete(sessionId);
    entry.codepilotSessionId = targetSessionId;
    store.set(targetSessionId, entry);
    return true;
  }

  return false;
}

export function getPersistentClaudeSessionCount(): number {
  return getStore().size;
}

// 中文注释：功能名称「WarmQuery 诊断信息」，用法是返回 WarmQuery Store 的摘要信息，
// 用于诊断预热签名不匹配问题，不直接暴露 Store 内部结构
export function getWarmQueryDiagnostics(): { storeSize: number; entries: Array<{ sessionId: string; signaturePrefix: string }> } {
  const store = getWarmQueryStore();
  const entries = Array.from(store.entries()).map(([k, v]) => ({
    sessionId: k,
    signaturePrefix: v.signature?.slice(0, 12) || '(empty)',
  }));
  return { storeSize: store.size, entries };
}
