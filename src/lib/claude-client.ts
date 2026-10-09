import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  SDKMessage,
  Options,
  Query,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, SSEEvent, TokenUsage, MCPServerConfig, PermissionRequestEvent, FileAttachment, MediaBlock } from '@/types';
import { isImageFile } from '@/types';
import { registerPendingPermission, registerPendingPermissionThenNotify } from './permission-registry';
import { isAlwaysAskTool } from './permission-checker';
import { registerConversation, unregisterConversation } from './conversation-registry';
import { captureCapabilities, isCacheFresh, setCachedPlugins } from './agent-sdk-capabilities';
import { normalizeMessageContent, microCompactMessage } from './message-normalizer';
import { roughTokenEstimate } from './context-estimator';
import { getSetting, updateSdkSessionId, createPermissionRequest } from './db';
import { resolveForClaudeCode } from './provider-resolver';
import { sanitizeClaudeModelOptions } from './claude-model-options';
import { findClaudeBinary, invalidateClaudePathCache } from './platform';
import { notifyPermissionRequest, notifyGeneric } from './telegram-bot';
import { classifyError, formatClassifiedError } from './error-classifier';
import { recordFileModification } from './file-checkpoint';
import { resolveWorkingDirectory } from './working-directory';
import { wrapController } from './safe-stream';
import { type ShadowHome } from './claude-home-shadow';
import { prepareSdkSubprocessEnv } from './sdk-subprocess-env';
import { decideNudge, buildSkillNudgeStatusEvent, buildLearningExtractionPrompt, buildCrystallizationPrompt } from './skill-nudge';
import {
  adoptPersistentClaudeSessionBySignature,
  buildPersistentClaudeSignature,
  canReusePersistentClaudeSession,
  closePersistentClaudeSession,
  getPersistentClaudeTurn,
  hasPersistentSessionBySessionId,
  hasWarmedNativeClaudeQuery,
  hasWarmedNativeClaudeQueryBySessionId,
  isSignatureCompatible,
  takeWarmedNativeClaudeQuery,
  takeWarmedNativeClaudeQueryBySessionId,
} from './persistent-claude-session';
// Static imports for resolveRuntime/detectTransport — used to be lazy
// `require('./runtime')` / `require('./provider-transport')`, but Turbopack's
// CJS↔ESM interop returns `{ default: ... }` shape that broke destructuring
// at runtime ("resolveRuntime is not a function" etc).
//
// IMPORTANT: import from `./runtime/registry` NOT from `./runtime` (== index).
// runtime/index.ts imports native-runtime AND sdk-runtime at top-level and
// registers them. sdk-runtime in turn imports FROM this file (claude-client).
// Importing `./runtime` here closes the cycle
// claude-client → runtime/index → sdk-runtime → claude-client
// and during evaluation of sdk-runtime's `export const sdkRuntime = {...}`,
// runtime/index's own `registerRuntime(sdkRuntime)` line hits the TDZ and
// throws "Cannot access 'sdkRuntime' before initialization" (caught by
// sdk-availability.test.ts under certain module load orders).
// registry.ts only imports types/db/claude-settings — no cycle. The actual
// runtime registration still happens elsewhere (runtime/index is imported
// via its own entry points at app startup).
import { resolveRuntime } from './runtime/registry';
import os from 'os';
import fs from 'fs';
import path from 'path';

/**
 * Sanitize a string for use as an environment variable value.
 * Removes null bytes and control characters that cause spawn EINVAL.
 */
function sanitizeEnvValue(value: string): string {
   
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize all values in an env record so child_process.spawn won't
 * throw EINVAL due to invalid characters or non-string values.
 * On Windows, spawn is strict: every env value MUST be a string.
 * Spreading process.env can include undefined values which cause EINVAL.
 */
export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = sanitizeEnvValue(value);
    }
  }
  return clean;
}

type SyntheticSubagentSource = 'omc_plugin' | 'sdk_agent_tool';

type SyntheticSubagentInfo = {
  id: string;
  name: string;
  displayName: string;
  prompt: string;
  model?: string;
  source: SyntheticSubagentSource;
  runInBackground?: boolean;
  taskId?: string;
};

// A background Task completion is not itself a terminal SDK event.  Give the
// SDK a short window to start its injected parent-summary turn, then end the
// stale query instead of leaving the chat stream active until its watchdog.
const BACKGROUND_FINALIZATION_GRACE_MS = 30_000;

function isTodoWriteToolName(name: string): boolean {
  return name === 'TodoWrite' || name === 'mcp__codepilot-todo__TodoWrite' || name === 'mcp__codepilot-todo__codepilot_todo_write';
}

/** Names emitted by built-in SDK tools and CodePilot's in-process MCP servers. */
export function isSyntheticSubagentToolName(name: string): boolean {
  return name === 'Agent'
    || name === 'Team'
    || name === 'Task'
    || name === 'mcp__codepilot-agent__Agent'
    || name === 'mcp__codepilot-team__Team';
}

function getSyntheticSubagentInfo(params: {
  input: unknown;
  omcPluginEnabled: boolean;
}): SyntheticSubagentInfo | null {
  const toolInput = (params.input || {}) as {
    agentId?: string;
    agent_id?: string;
    agent?: string;
    subagent_type?: string;
    task_type?: string;
    id?: string;
    prompt?: string;
    task?: string;
    description?: string;
    displayName?: string;
    display_name?: string;
    model?: string;
    name?: string;
    run_in_background?: boolean;
  };

  const agentId = toolInput.agentId
    || toolInput.agent_id
    || toolInput.agent
    || toolInput.subagent_type
    || toolInput.task_type
    || 'general';
  const agentPrompt = toolInput.prompt || toolInput.task || toolInput.description || '';
  const agentDisplayName = toolInput.displayName || toolInput.display_name || toolInput.name || agentId;
  if (!agentPrompt.trim()) {
    return null;
  }

  const source: SyntheticSubagentSource = params.omcPluginEnabled ? 'omc_plugin' : 'sdk_agent_tool';
  return {
    id: `subagent-${agentId}-${Date.now()}`,
    name: agentId,
    displayName: agentDisplayName,
    prompt: agentPrompt.length > 200 ? agentPrompt.slice(0, 197) + '...' : agentPrompt,
    model: toolInput.model,
    source,
    runInBackground: toolInput.run_in_background === true,
  };
}

export function selectOnDemandMcpServerNames(
  prompt: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  projectCwd?: string,
): Set<string> {
  const recentHistory = conversationHistory
    ?.slice(-6)
    .map(m => m.content)
    .join('\n') || '';
  const text = `${recentHistory}\n${prompt}`;
  const selected = new Set<string>();
  const add = (...names: string[]) => {
    for (const name of names) selected.add(name);
  };

  // Auto-detect any configured custom MCP server mentioned in the text
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadAllMcpServers } = require('@/lib/mcp-loader');
    const allServers = loadAllMcpServers(projectCwd);
    if (allServers) {
      const lowerText = text.toLowerCase();
      for (const name of Object.keys(allServers)) {
        if (lowerText.includes(name.toLowerCase())) {
          add(name);
        }
      }
    }
  } catch (e) {
    // Ignore dynamic load errors
  }

  if (/\bhttps?:\/\/|\burl\b|fetch|web\s*fetch|读取.*网页|打开.*网页|网页内容|网址/i.test(text)) {
    add('fetch');
  }
  if (/github|\bgh\b|pull\s*request|\bpr\b|issue|repository|repo\b|远程仓库/i.test(text)) {
    add('github');
  }
  if (/playwright|browser\s*automation|e2e|端到端|浏览器自动化/i.test(text)) {
    add('playwright');
  }
  if (/chrome[-\s]?devtools|devtools|console|控制台|页面截图|截图|inspect|调试页面|localhost:\d+|http:\/\/localhost/i.test(text)) {
    add('chrome-devtools');
  }
  // 中文注释：功能名称「联网研究意图扩展识别」，用法是覆盖“官方文档、版本兼容、
  // 上游实现、SDK/API 变化、最佳实践”等自然表述；用户不一定会明确说“帮我搜索”，
  // 但这类问题本质上已经依赖外部资料，应提前把 WebSearch/fetch 暴露给 CLI 主路径。
  const needsExternalResearch = /web\s*search|websearch|联网搜索|网页搜索|搜索网页|查一下|查找.*网页|最新信息|latest|官方文档|官方说明|文档|docs?\b|documentation|release\s*notes?|changelog|breaking\s*change|migration|compatib(?:le|ility)|版本|依赖变化|第三方|upstream|上游|仓库实现|开源仓库|源码实现|最佳实践|community|sdk\b|api\b|package\b|library\b|framework\b/i.test(text);
  const likelyExternalTopic = /终端版|claude\s*code|oh[-\s]?my[-\s]?claudecode|omc|hook|插件|provider|settings\.json|cc\s*switch|mcp|skill/i.test(text);
  if (needsExternalResearch || (likelyExternalTopic && /怎么实现|如何实现|原理|差异|为什么|支持情况|兼容/i.test(text))) {
    add('WebSearch', 'bailian-web-search', 'fetch');
  }
  if (/web\s*search|websearch|联网搜索|网页搜索|搜索网页|查一下|查找.*网页|最新信息|latest/i.test(text)) {
    add('WebSearch', 'bailian-web-search', 'fetch');
  }
  if (/minimax|图像识别|图片识别|ocr|分析图片/i.test(text)) {
    add('minimax_vision', 'minimax');
  }
  if (/memory|记忆|回忆/i.test(text)) {
    add('memory');
  }
  if (/\brag\b|知识库|向量检索|语义检索/i.test(text)) {
    add('rag');
  }
  if (/sequential[-\s]?thinking|逐步思考/i.test(text)) {
    add('sequential-thinking');
  }
  if (/filesystem|文件系统.*mcp/i.test(text)) {
    add('filesystem');
  }
  if (/(搜索|查找|检索|找一下|搜一下|grep|glob|ripgrep|rg)\b/i.test(text) || /\/src\/|src\/|\.tsx?\b|\.jsx?\b|\*\*\/\*|\*\.\w{1,6}\b/.test(text)) {
    add('filesystem');
  }

  return selected;
}

/**
 * On Windows, npm installs CLI tools as .cmd wrappers that can't be
 * spawned without shell:true. Parse the wrapper to extract the real
 * .js script path so we can pass it to the SDK directly.
 */
function resolveScriptFromCmd(cmdPath: string): string | undefined {
  try {
    const content = fs.readFileSync(cmdPath, 'utf-8');
    const cmdDir = path.dirname(cmdPath);

    // npm .cmd wrappers typically contain a line like:
    //   "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %*
    // Match paths containing claude-code or claude-agent and ending in .js
    const patterns = [
      // Quoted: "%~dp0\...\cli.js"
      /"%~dp0\\([^"]*claude[^"]*\.js)"/i,
      // Unquoted: %~dp0\...\cli.js
      /%~dp0\\(\S*claude\S*\.js)/i,
      // Quoted with %dp0%: "%dp0%\...\cli.js"
      /"%dp0%\\([^"]*claude[^"]*\.js)"/i,
    ];

    for (const re of patterns) {
      const m = content.match(re);
      if (m) {
        const resolved = path.normalize(path.join(cmdDir, m[1]));
        if (fs.existsSync(resolved)) return resolved;
      }
    }
  } catch {
    // ignore read errors
  }
  return undefined;
}

let cachedClaudePath: string | null | undefined;

function findClaudePath(): string | undefined {
  if (cachedClaudePath !== undefined) return cachedClaudePath || undefined;
  const found = findClaudeBinary();
  cachedClaudePath = found ?? null;
  return found;
}

/**
 * Invalidate the cached Claude binary path in this module AND in platform.ts.
 * Must be called after installation so the next SDK call picks up the new binary.
 */
export function invalidateClaudeClientCache(): void {
  cachedClaudePath = undefined; // reset to "not yet looked up"
  invalidateClaudePathCache();  // also reset the 60s TTL cache in platform.ts
}

/**
 * Convert our MCPServerConfig to the SDK's McpServerConfig format.
 * Supports stdio, sse, and http transport types.
 */
export function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';

    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }
        const sseConfig: McpSSEServerConfig = {
          type: 'sse',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }
        result[name] = sseConfig;
        break;
      }

      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const httpConfig: McpHttpServerConfig = {
          type: 'http',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }
        result[name] = httpConfig;
        break;
      }

      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
        break;
      }
    }
  }
  return result;
}

/**
 * 中文注释：功能名称「SDK 内部注入轮次识别」，用法是识别 Claude Code SDK 自己追加到会话里的
 * 合成 user 消息（目前已知 `<task-notification>`：后台 Bash 任务结束时由 SDK 注入）。
 *
 * 关键点：这类消息不是用户真实输入，但 SDK 会在**同一条 query** 上继续跑一轮模型，
 * 并把这一轮的 assistant 输出发到同一个消息流里。由于持久会话的流会一直挂着不结束，
 * 下游（chat route / bridge conversation-engine）会把这一轮的文本并进「仍然打开」的
 * 用户回复缓冲区，最终被当成用户上一个问题的答案——表现为「答非所问」，
 * 在 Bridge 场景下还会被直接推送到 IM。
 *
 * 所以这里把它识别出来，向上游标记出内部轮次的起止，让下游丢弃这一轮的可见输出。
 */
export function detectSdkInjectedUserTurn(content: unknown): { source: string; summary: string } | null {
  if (typeof content !== 'string') return null;
  const text = content.trimStart();
  if (!text.startsWith('<task-notification>')) return null;

  const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] || '').trim().replace(/\s+/g, ' ');
  const status = (/<status>([\s\S]*?)<\/status>/.exec(text)?.[1] || '').trim();
  const taskId = (/<task-id>([\s\S]*?)<\/task-id>/.exec(text)?.[1] || '').trim();

  return {
    source: 'task-notification',
    summary: [status, summary, taskId ? `task ${taskId}` : '']
      .filter(Boolean)
      .join(' · ')
      .slice(0, 300) || 'background task finished',
  };
}

/**
 * 中文注释：功能名称「SDK 内部轮次状态机」，用法是承载 SDK 注入轮次的抑制状态，
 * 让 streamClaude 的消息循环只做「问它该不该丢弃」，而不用自己维护散落的布尔量。
 *
 * 状态迁移：
 *   用户本轮答完（onResult）之前收到注入消息 → 先挂起（pending），不抑制，
 *     以免把用户自己的回答和 result 一起吞掉；
 *   之后本该轮 result 到达（onResult）→ 进入抑制态，吞掉随后那一轮模型输出；
 *   注入轮自己的 result 到达（onResult）→ 退出抑制态，恢复正常转发。
 */
export class SdkInjectedTurnTracker {
  private internalTurn = false;
  private turnCompleted = false;
  private pendingInternalTurn = false;
  // 中文注释：本轮流里是否已出现任何 assistant 输出。用于区分两类场景——
  // 注入消息出现在任何输出之前 = 上一轮残留的通知轮次 → 立即抑制；
  // 注入消息出现在用户轮进行中 = 通知排队到本轮 result 之后 → 挂起等待。
  private seenAssistantOutput = false;
  // 中文注释：所有后台子 Agent 都已回报时置位。此时接下来那一个注入轮
  // 是模型的最终汇总轮（统一回复），需要放行而不是抑制。
  forwardFinalTurn = false;
  // 中文注释：最终汇总轮必须实际产生父 Agent 的 assistant 帧，才可结束主轮次。
  // 仅收到 task_notification 后紧跟的空 result，代表子任务通知轮结束，不能把它
  // 误标为父任务完成。
  private finalSummaryTurn = false;
  private finalSummaryHasAssistantOutput = false;

  /** A background child has completed, but its injected parent summary is still pending. */
  get hasPendingFinalSummary(): boolean {
    return this.forwardFinalTurn || this.finalSummaryTurn;
  }

  /** 收到字符串型 user 消息时调用；返回识别结果，未识别返回 null。 */
  markUserMessage(content: unknown): { source: string; summary: string } | null {
    const injected = detectSdkInjectedUserTurn(content);
    if (!injected) return null;
    if (this.forwardFinalTurn) {
      // 最终汇总轮：放行其输出，作为「全部完成后的统一回复」
      this.forwardFinalTurn = false;
      this.finalSummaryTurn = true;
      this.finalSummaryHasAssistantOutput = false;
      console.log('[claude-client] Final summary turn after all subagents — forwarding output');
      return injected;
    }
    if (this.turnCompleted) {
      this.internalTurn = true;
    } else if (this.seenAssistantOutput) {
      // 用户轮进行中收到通知：SDK 会在本轮 result 之后再跑注入轮 → 挂起
      this.pendingInternalTurn = true;
    } else {
      // 本轮尚无任何输出就出现注入消息 = 上一轮残留的轮次 → 立即抑制，
      // 避免旧回复泄漏（残留轮结束时会经 internal_end 解除）
      console.log('[claude-client] Leftover injected turn at stream start — suppressing immediately');
      this.internalTurn = true;
    }
    return injected;
  }

  /** 收到 assistant 消息时调用（含被抑制轮次之前的正常轮次）。 */
  markAssistantMessage(): void {
    this.seenAssistantOutput = true;
    if (this.finalSummaryTurn) {
      this.finalSummaryHasAssistantOutput = true;
    }
  }

  /**
   * 是否要丢弃这条 SDK 消息的可见输出。system / result 始终放行：
   * system 用于维持任务与模式状态，result 是轮次结束信号（用来关闭标记）。
   */
  shouldSuppress(messageType: string): boolean {
    return this.internalTurn && messageType !== 'system' && messageType !== 'result';
  }

  /** 该消息是否属于（或即将属于）注入轮次，用于抑制 rewind_point 锚点。 */
  get isInjectedTurn(): boolean {
    return this.internalTurn || this.pendingInternalTurn;
  }

  /**
   * 收到 result 时调用。
   * @returns 'internal_end'    注入轮次结束，恢复正常转发
   *          'suppressed_start' 用户本轮答完，且此前有挂起的注入消息，现在起进入抑制态
   *          'turn_completed'   普通用户轮次结束
   */
  onResult(): 'internal_end' | 'suppressed_start' | 'turn_completed' {
    if (this.finalSummaryTurn) {
      const hasAssistantOutput = this.finalSummaryHasAssistantOutput;
      this.finalSummaryTurn = false;
      this.finalSummaryHasAssistantOutput = false;
      if (!hasAssistantOutput) {
        console.warn('[claude-client] Background task notification ended without a parent summary; keeping the main turn open');
        return 'internal_end';
      }
      this.turnCompleted = true;
      return 'turn_completed';
    }
    if (this.internalTurn) {
      this.internalTurn = false;
      return 'internal_end';
    }
    this.turnCompleted = true;
    if (this.pendingInternalTurn) {
      this.pendingInternalTurn = false;
      this.internalTurn = true;
      return 'suppressed_start';
    }
    return 'turn_completed';
  }
}

/**
 * A result is the end of the user-visible turn only when no background
 * sub-agent is still expected to inject its completion/final-summary turn.
 * Keeping this decision explicit prevents a persistent SDK iterator that
 * remains open after a valid result from later tripping the stall watchdog.
 */
export function isFinalUserTurnResult(
  transition: ReturnType<SdkInjectedTurnTracker['onResult']>,
  pendingBackgroundAgents: number,
  hasPendingFinalSummary = false,
): boolean {
  return transition === 'turn_completed'
    && pendingBackgroundAgents === 0
    && !hasPendingFinalSummary;
}

/** A missing parent summary is only benign after every child succeeded. */
export function shouldGracefullyFinalizeBackgroundTask(
  taskStatus: string,
  pendingBackgroundAgents: number,
): boolean {
  return taskStatus === 'completed' && pendingBackgroundAgents === 0;
}

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/** The `message.usage` shape of the last assistant frame, used to size the live context. */
type AssistantRequestUsage = {
  input_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Extract token usage from an SDK result message.
 *
 * `lastAssistantUsage` is the `message.usage` of the final main-thread
 * assistant frame — i.e. the usage of the LAST API request, whose input
 * side (input + cache_read + cache_creation) is exactly how many tokens
 * currently sit in the model's context window.
 *
 * The result message's own `usage` is CUMULATIVE across every turn of the
 * query, so deriving the context size from it (e.g. dividing by
 * num_turns) yields a per-turn *average*: for a conversation growing from
 * 10K to 200K over 20 turns that reports ~105K, and the under-report gets
 * worse the longer the session runs — agent loops with many tool turns
 * inflate num_turns and shrink the number further. That is why the
 * indicator used to stay near zero on long conversations.
 */
function extractTokenUsage(
  msg: SDKResultMessage,
  durationMs?: number,
  lastAssistantUsage?: AssistantRequestUsage | null,
): TokenUsage | null {
  if (!msg.usage && !durationMs) return null;
  const usage = msg.usage || {};

  const input_tokens = usage.input_tokens || 0;
  const cache_read_input_tokens = usage.cache_read_input_tokens ?? 0;
  const cache_creation_input_tokens = usage.cache_creation_input_tokens ?? 0;

  const totalCumulativeInput = input_tokens + cache_read_input_tokens + cache_creation_input_tokens;

  // Prefer the last request's real input size. Only fall back to the
  // cumulative/turns average when the stream produced no assistant usage
  // frame at all (e.g. an aborted query).
  let context_input_tokens: number;
  if (lastAssistantUsage) {
    context_input_tokens =
      (lastAssistantUsage.input_tokens || 0) +
      (lastAssistantUsage.cache_read_input_tokens || 0) +
      (lastAssistantUsage.cache_creation_input_tokens || 0);
  } else {
    const turns = 'num_turns' in msg && typeof msg.num_turns === 'number' ? Math.max(1, msg.num_turns) : 1;
    context_input_tokens = Math.round(totalCumulativeInput / turns);
  }

  // SDK-authoritative context window. modelUsage is keyed by upstream model
  // id and may also carry auxiliary models (e.g. haiku for background
  // tasks), so pick the entry that actually carried the conversation.
  const modelUsage = 'modelUsage' in msg ? msg.modelUsage : undefined;
  let context_window: number | undefined;
  if (modelUsage) {
    let bestTokens = -1;
    for (const entry of Object.values(modelUsage)) {
      if (!entry || !(entry.contextWindow > 0)) continue;
      const tokens = entry.inputTokens + entry.cacheReadInputTokens + entry.cacheCreationInputTokens;
      if (tokens > bestTokens) {
        bestTokens = tokens;
        context_window = entry.contextWindow;
      }
    }
  }

  return {
    input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens,
    cache_creation_input_tokens,
    context_input_tokens, // Plumbed to UI so it knows the live context size
    // 中文注释：单次请求的 cache 读写量，仅供 UI 展示——与 context_input_tokens
    // 同一量级，避免把累计的 4.4M 摆在 200K 上下文旁边造成误读。
    // 累计值（cache_read_input_tokens / cache_creation_input_tokens）保持不变，
    // 因为 DB 成本统计依赖它们。
    ...(lastAssistantUsage
      ? {
          context_cache_read_tokens: lastAssistantUsage.cache_read_input_tokens || 0,
          context_cache_creation_tokens: lastAssistantUsage.cache_creation_input_tokens || 0,
        }
      : {}),
    ...(context_window ? { context_window } : {}),
    cost_usd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
    ...(durationMs ? { duration_sec: Math.round(durationMs / 1000) } : {}),
  };
}

/**
 * Stream Claude responses using the Agent SDK.
 * Returns a ReadableStream of SSE-formatted strings.
 */
/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to .codepilot-uploads/.
 */
function getUploadedFilePaths(files: FileAttachment[], workDir: string): string[] {
  const paths: string[] = [];
  let uploadDir: string | undefined;
  for (const file of files) {
    if (file.filePath) {
      paths.push(file.filePath);
    } else {
      // Fallback: write file to disk (should not happen in normal flow)
      if (!uploadDir) {
        uploadDir = path.join(workDir, '.codepilot-uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
      }
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
      const buffer = Buffer.from(file.data, 'base64');
      fs.writeFileSync(filePath, buffer);
      paths.push(filePath);
    }
  }
  return paths;
}

// Message normalization is in message-normalizer.ts (shared with context-compressor.ts).
// Imported dynamically in buildFallbackContext to avoid circular deps at module level.

/**
 * Build fallback context from conversation history with token-budget awareness.
 *
 * Instead of a fixed message count, walks backward from the newest message
 * and includes as many as fit within the token budget. Optionally prepends
 * a session summary as a context skeleton for the full conversation.
 */
function buildFallbackContext(params: {
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  sessionSummary?: string;
  tokenBudget?: number;
}): string {
  const { prompt, history, sessionSummary, tokenBudget } = params;
  if (!history || history.length === 0) {
    if (sessionSummary) {
      return `<session-summary>\n${sessionSummary}\n</session-summary>\n\n${prompt}`;
    }
    return prompt;
  }

  // Normalize + microcompact: strip metadata, summarize tool blocks, truncate old messages
  const normalized = history.map((msg, i) => ({
    role: msg.role,
    content: microCompactMessage(
      msg.role,
      normalizeMessageContent(msg.role, msg.content),
      history.length - 1 - i, // ageFromEnd: 0 = newest
    ),
  }));

  // Select messages within token budget (walk backward from newest).
  // Floor at 10K tokens so even extreme sessions keep some recent context.
  const effectiveBudget = tokenBudget != null ? Math.max(tokenBudget, 10000) : undefined;
  let selected: typeof normalized;
  if (effectiveBudget) {
    selected = [];
    let accumulated = 0;
    for (let i = normalized.length - 1; i >= 0; i--) {
      const msgTokens = roughTokenEstimate(normalized[i].content) + 10; // role label overhead
      if (accumulated + msgTokens > effectiveBudget) break;
      selected.unshift(normalized[i]);
      accumulated += msgTokens;
    }
  } else {
    selected = normalized;
  }

  // Build the output
  const lines: string[] = [];

  if (sessionSummary) {
    lines.push('<session-summary>');
    lines.push(sessionSummary);
    lines.push('</session-summary>');
    lines.push('');
  }

  lines.push('<conversation_history>');
  lines.push('(This is a summary of earlier conversation turns for context. <prior-tool-call .../> and <prior-reasoning>...</prior-reasoning> are metadata markers describing what already happened — they are NOT assistant output format. Do not reproduce these tags. To call a tool, emit a real tool_use block; do not write tool calls as prose or as these markers.)');
  for (const msg of selected) {
    lines.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`);
  }
  lines.push('</conversation_history>');
  lines.push('');
  lines.push(prompt);
  return lines.join('\n');
}

/**
 * Lightweight text generation via the Claude Code SDK subprocess.
 * Uses the same provider/env resolution as streamClaude but without sessions,
 * MCP, permissions, or conversation history. Suitable for simple tasks like
 * generating tool descriptions.
 */
export async function generateTextViaSdk(params: {
  providerId?: string;
  model?: string;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  mcpServers?: Record<string, McpServerConfig>;
  sessionId?: string;
  /** Working directory for the SDK subprocess. Defaults to process.cwd(). */
  cwd?: string;
}): Promise<string> {
  const resolved = resolveForClaudeCode(undefined, {
    providerId: params.providerId,
  });

  // Same provider-owned auth isolation as the main streaming path: when an
  // explicit DB provider is selected, this auxiliary call must NOT pick up
  // cc-switch credentials from ~/.claude/settings.json or ~/.claude.json.
  // See src/lib/sdk-subprocess-env.ts.
  const setup = prepareSdkSubprocessEnv(resolved);
  const sdkEnv = setup.env;

  const abortController = new AbortController();
  if (params.abortSignal) {
    params.abortSignal.addEventListener('abort', () => abortController.abort());
  }

  // Auto-timeout after 60s to prevent indefinite hangs
  const timeoutId = setTimeout(() => abortController.abort(), 60_000);

  const queryOptions: Options = {
    cwd: params.cwd || process.cwd(),
    abortController,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    env: sanitizeEnv(sdkEnv),
    settingSources: resolved.settingSources as Options['settingSources'],
    systemPrompt: params.system,
    maxTurns: 1,
  };

  if (params.model) {
    queryOptions.model = params.model;
  }

  if (params.mcpServers && Object.keys(params.mcpServers).length > 0) {
    queryOptions.mcpServers = params.mcpServers;
  }

  const claudePath = findClaudePath();
  if (claudePath) {
    const ext = path.extname(claudePath).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      const scriptPath = resolveScriptFromCmd(claudePath);
      if (scriptPath) queryOptions.pathToClaudeCodeExecutable = scriptPath;
    } else {
      queryOptions.pathToClaudeCodeExecutable = claudePath;
    }
  }

  let resultText = '';
  let errorMsg = '';
  try {
    const conversation = query({
      prompt: params.prompt,
      options: queryOptions,
    });

    // Iterate through all messages; the last one with type 'result' has the answer
    for await (const msg of conversation) {
      if (msg.type === 'result') {
        if ('result' in msg && !('is_error' in msg && msg.is_error)) {
          resultText = (msg as SDKResultSuccess).result || '';
        } else if ('is_error' in msg && msg.is_error) {
          // Capture error details from SDKResultError
          const err = msg as { subtype?: string; errors?: string[]; is_error?: boolean };
          const details = err.errors?.length ? err.errors.join('; ') : err.subtype || 'unknown error';
          errorMsg = `SDK query failed (${details})`;
        }
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    setup.shadow.cleanup();
    if (abortController.signal.aborted && !(params.abortSignal?.aborted)) {
      throw new Error('SDK query timed out after 60s');
    }
    throw err;
  }

  clearTimeout(timeoutId);
  setup.shadow.cleanup();

  if (errorMsg) {
    throw new Error(errorMsg);
  }

  if (!resultText) {
    throw new Error('SDK query returned no result — model may not be available for this provider');
  }

  return resultText;
}

/**
 * Main entry point for streaming chat. Dispatches to the resolved AgentRuntime.
 *
 * All callers (chat route, bridge, onboarding) call this function.
 * It converts ClaudeStreamOptions → RuntimeStreamOptions, resolves
 * the appropriate runtime, and delegates.
 */
export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  // 中文注释：功能名称「Claude Code 单主路径调度」，用法是聊天流始终只走
  // Claude Code CLI runtime；若 CLI 不可用，直接在 resolveRuntime 中报错，
  // 不再根据 provider 或设置切回 Native / AI SDK 分支。
  const runtime = resolveRuntime();
  console.log(`[streamClaude] Using runtime: ${runtime.id}`);

  return runtime.stream({
    // Universal fields
    prompt: options.prompt,
    sessionId: options.sessionId,
    model: options.model,
    systemPrompt: options.systemPrompt,
    referencedContexts: options.referencedContexts,
    workingDirectory: options.workingDirectory,
    abortController: options.abortController,
    autoTrigger: options.autoTrigger,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    thinking: options.thinking,
    effort: options.effort,
    context1m: options.context1m,
    mcpServers: options.mcpServers,
    permissionMode: options.permissionMode,
    bypassPermissions: options.bypassPermissions,
    onRuntimeStatusChange: options.onRuntimeStatusChange,

    // Runtime-specific fields (SDK Runtime reads these from runtimeOptions)
    runtimeOptions: {
      sdkSessionId: options.sdkSessionId,
      files: options.files,
      conversationHistory: options.conversationHistory,
      sessionSummary: options.sessionSummary,
      fallbackTokenBudget: options.fallbackTokenBudget,
      sessionSummaryBoundaryRowid: options.sessionSummaryBoundaryRowid,
      imageAgentMode: options.imageAgentMode,
      toolTimeoutSeconds: options.toolTimeoutSeconds,
      outputFormat: options.outputFormat,
      agents: options.agents,
      agent: options.agent,
      enableFileCheckpointing: options.enableFileCheckpointing,
      generativeUI: options.generativeUI,
      provider: options.provider,
    },
  });
}

/**
 * SDK path — used by SdkRuntime. Contains the original Claude Code SDK query() logic.
 * Exported so sdk-runtime.ts can call it without circular dependency issues.
 */
export function streamClaudeSdk(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    referencedContexts,
    workingDirectory,
    mcpServers,
    abortController,
    permissionMode,
    files,
    toolTimeoutSeconds = 0,
    conversationHistory,
    onRuntimeStatusChange,
    imageAgentMode,
    bypassPermissions: sessionBypassPermissions,
    thinking,
    effort,
    outputFormat,
    agents,
    agent,
    enableFileCheckpointing,
    autoTrigger,
    context1m,
    generativeUI,
    instructionSources,
  } = options;

  // Kept outside the underlying-source callbacks so `cancel()` can only tear
  // down the Query that this particular HTTP stream actually acquired.
  let persistentQueryForStream: Query | null = null;

  return new ReadableStream<string>({
    async start(controllerRaw) {
      // Wrap controller so async callbacks (keep-alive timer, late tool-result
      // handlers, post-abort message processing) can call enqueue() without
      // crashing when the consumer aborts. See src/lib/safe-stream.ts.
      const controller = wrapController(controllerRaw, (kind) => {
        console.warn(`[claude-client] late ${kind} after stream close — silently dropped`);
      });

      // 中文注释：SDK 路径独立保活心跳 —— 客户端有 330s 空闲看门狗，而 CLI 在长时间
      // 静默（无进度上报 / 慢 provider 首字）时可能不发任何消息，造成误判「连接断开」。
      // 每 15s 发一次 keep_alive，与 Native 运行时（agent-loop）保持一致。
      const sdkKeepAliveTimer = setInterval(() => {
        controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
      }, 15_000);

      // 中文注释：等待人工输入的挂起计数。AskUserQuestion / 退出计划审批本质是
      // 「等用户操作」，期间 SDK 侧不会产出任何消息。若不暂停看门狗，
      // toolTimeoutSeconds（默认 600s）后就会 abort(stalled)，
      // 把用户还没作答的卡片连同这一轮一起掐断 —— 表现为「切走一会儿回来卡片没了」。
      let waitingPermissionDepth = 0;

      // 中文注释：工具「无进度」看门狗 —— 取代原墙钟超时。原逻辑只看工具运行总时长，
      // 长构建 / 长测试跑到阈值就被误杀（任务静默提前结束）；现在改为记录每个工具
      // 最近一次进度上报的时间，只有连续 toolTimeoutSeconds 秒没有任何进度更新才判卡死中止。
      const toolProgressAt = new Map<string, { name: string; at: number }>();
      let toolWatchdogFired = false;
      const toolWatchdogTimer: ReturnType<typeof setInterval> | null = toolTimeoutSeconds > 0 ? setInterval(() => {
        if (toolWatchdogFired) return;
        if (waitingPermissionDepth > 0) return; // 等待人工输入中，不算工具卡死
        const now = Date.now();
        for (const [toolUseId, info] of toolProgressAt) {
          if (now - info.at >= toolTimeoutSeconds * 1000) {
            toolWatchdogFired = true;
            toolProgressAt.delete(toolUseId);
            const stallSecs = Math.round((now - info.at) / 1000);
            console.warn(`[claude-client] Tool watchdog: ${info.name} no progress for ${stallSecs}s — aborting turn`);
            // 中文注释：先给用户一条可见的状态说明，再中止 —— 避免"任务突然消失、毫无提示"。
            controller.enqueue(formatSSE({
              type: 'status',
              data: `工具「${info.name}」已 ${stallSecs} 秒无响应，判定卡死，本轮任务已中止`,
            }));
            controller.enqueue(formatSSE({
              type: 'tool_timeout',
              data: JSON.stringify({ tool_name: info.name, elapsed_seconds: stallSecs }),
            }));
            abortController?.abort();
            if (toolWatchdogTimer) clearInterval(toolWatchdogTimer);
            break;
          }
        }
      }, 10_000) : null;

      // 中文注释：全流「无进度」看门狗 —— 工具看门狗只覆盖「有进度上报的工具阶段」；
      // 模型阶段（上游请求挂起、SDK 完全没有消息）此前无人看守：代理层对上游的超时长达
      // 30 分钟，期间客户端只会收到 keep_alive 心跳、永远不会触发空闲超时，表现为
      // "任务突然不动、无任何完成/失败提示"。这里用 lastStreamActivityAt 记录最近一次
      // 收到 SDK 消息的时间（主消费循环 + 重试循环里刷新），静默超过 toolTimeoutSeconds
      // 即发可见状态 + aborted(reason=stalled) 并中止，保证任何卡死都有终态与原因。
      let lastStreamActivityAt = Date.now();
      let streamWatchdogFired = false;
      const streamWatchdogTimer: ReturnType<typeof setInterval> | null = toolTimeoutSeconds > 0 ? setInterval(() => {
        if (streamWatchdogFired) return;
        if (waitingPermissionDepth > 0) {
          // 中文注释：等待人工输入期间不算「上游静默」。把活动时间持续推前，
          // 用户作答后重新开始计时，避免刚恢复就因积压时长被误判 stalled。
          lastStreamActivityAt = Date.now();
          return;
        }
        const silentMs = Date.now() - lastStreamActivityAt;
        if (silentMs < toolTimeoutSeconds * 1000) return;
        streamWatchdogFired = true;
        const silentSecs = Math.round(silentMs / 1000);
        console.warn(`[claude-client] Stream watchdog: no SDK activity for ${silentSecs}s — aborting turn`);
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({ notification: true, message: `模型上游 ${silentSecs} 秒无任何响应，已中止本轮（可直接重新发送消息重试）` }),
        }));
        controller.enqueue(formatSSE({
          type: 'aborted',
          data: JSON.stringify({ reason: 'stalled', message: `模型上游 ${silentSecs} 秒无响应` }),
        }));
        // 卡死的 SDK 会话不可继续复用 —— 清掉，让下一轮用本地历史 + 摘要重建会话
        if (sessionId) {
          try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
        }
        abortController?.abort();
        if (streamWatchdogTimer) clearInterval(streamWatchdogTimer);
      }, 15_000) : null;

      // Emit referenced contexts if available
      if (referencedContexts && referencedContexts.length > 0) {
        controller.enqueue(formatSSE({
          type: 'referenced_contexts',
          data: JSON.stringify({ files: referencedContexts }),
        }));
      }

      // Flag to prevent infinite PTL retry loops (at most one retry per request)
      let ptlRetryAttempted = false;
      // Distinguish an explicit user cancellation from watchdog-triggered
      // aborts.  The SDK reports both by rejecting/ending its iterator, but
      // only the former must never be classified as a model/task error.
      let backgroundFinalizationExpired = false;
      // Per-request shadow ~/.claude/ for DB-provider isolation. Built lazily
      // below once we know whether we have an explicit DB provider; cleaned up
      // in the outer finally block. See src/lib/claude-home-shadow.ts.
      let shadowHome: ShadowHome | null = null;
      let usingPersistentSession = false;
      let shadowHandleOwnedByPersistentSession = false;
      let warmedQueryCleanup: (() => void) | null = null;
      // Only an SDK result event proves that this request consumed a complete
      // turn.  The outer finally uses this to reject unsafe session reuse.
      let receivedTerminalResult = false;
      let assistantErrorMessage = '';

      // Resolve provider via the unified resolver. The caller may pass an explicit
      // provider (from resolveProvider().provider), or undefined when 'env' mode is
      // intended. We do NOT fall back to getActiveProvider() here — that's handled
      // inside resolveForClaudeCode() only when no resolution was attempted at all.
      const resolved = resolveForClaudeCode(options.provider, {
        providerId: options.providerId,
        sessionProviderId: options.sessionProviderId,
      });

      // 中文注释：等待后台子 Agent 期间的保活心跳（在 try 外声明，供成功/失败两条路径清理）
      let agentWaitKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let backgroundFinalizationTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        const resolvedWorkingDirectory = resolveWorkingDirectory([
          { path: workingDirectory, source: 'requested' },
        ]);

        if (workingDirectory && resolvedWorkingDirectory.source !== 'requested') {
          console.warn(
            `[claude-client] Working directory "${workingDirectory}" is unavailable, falling back to "${resolvedWorkingDirectory.path}"`,
          );
        }

        // Build env for the Claude Code subprocess via the shared helper —
        // every SDK entry point (this stream, generateTextViaSdk, provider
        // doctor live probe) goes through `prepareSdkSubprocessEnv` so the
        // provider-group ownership rule is applied uniformly. See
        // src/lib/sdk-subprocess-env.ts.
        const setup = prepareSdkSubprocessEnv(resolved);
        const sdkEnv = setup.env;
        shadowHome = setup.shadow;

        // Warn if no credentials found at all
        if (!resolved.hasCredentials && !sdkEnv.ANTHROPIC_API_KEY && !sdkEnv.ANTHROPIC_AUTH_TOKEN) {
          console.warn('[claude-client] No API key found: no active provider, no legacy settings, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
        }


        // Check if dangerously_skip_permissions is enabled globally or per-session
        const globalSkip = getSetting('dangerously_skip_permissions') === 'true';
        const skipPermissions = globalSkip || !!sessionBypassPermissions;

        let enabledPlugins: Array<{ type: 'local'; path: string }> = [];
        let omcPluginEnabled = false;
        try {
          const { getEnabledPluginConfigs, hasEnabledOmcPlugin } = await import('@/lib/plugin-discovery');
          enabledPlugins = getEnabledPluginConfigs(resolvedWorkingDirectory.path);
          omcPluginEnabled = hasEnabledOmcPlugin(enabledPlugins);
        } catch (error) {
          console.warn('[claude-client] Failed to resolve enabled plugins for SDK session:', error);
        }
        const queryOptions: Options = {
          cwd: resolvedWorkingDirectory.path,
          abortController,
          includePartialMessages: true,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          env: sanitizeEnv(sdkEnv),
          settingSources: resolved.settingSources as Options['settingSources'],
          // 中文注释：严格 MCP 模式 —— 只用我们显式传入的服务器（常用白名单 + 按需补载），
          // 忽略 ~/.claude.json 等其它 MCP 配置的原生发现。否则 26 个服务器会全部被拉起，
          // 冷启动/预热显著变慢，低频服务器白名单筛选也形同虚设。
          extraArgs: { 'strict-mcp-config': null },
          // 中文注释：功能名称「Claude Full Capabilities 固定开启」，用法是在单一
          // Claude Code CLI 主路径下始终保持 FULL capabilities，不再保留 FAST/--bare
          // 降级分支，避免 hooks、skills、OMC、联网工具被请求侧裁掉。
          ...(console.log(
            `[claude-client] SDK mode: FULL (--bare off, settingSources=${resolved.settingSources?.join(',') || '[]'}, plugins=${enabledPlugins.length})`,
          ), {}),
          // Auto-allow all CodePilot built-in MCPs. These are host-defined
          // in-process servers (createSdkMcpServer in claude-client.ts below)
          // that ship with CodePilot — they're not third-party plugins and
          // don't need per-tool user approval. Without this list, SDK's
          // default 'acceptEdits' mode prompts the user for each mcp__codepilot-*
          // invocation, which is the regression users reported after we
          // stopped silently allowing everything via project-level settings.
          allowedTools: [
            'mcp__codepilot-memory-search',
            'mcp__codepilot-notify',
            'mcp__codepilot-widget',
            'mcp__codepilot-widget-guidelines',
            'mcp__codepilot-media',
            // imageAgentMode 时禁止调用 image-gen 工具，强制模型输出 image-gen-request 代码块
            ...(imageAgentMode ? [] : ['mcp__codepilot-image-gen']),
            'mcp__codepilot-cli-tools',
            'mcp__codepilot-dashboard',
            'mcp__codepilot-todo',
            // codepilot_cli_tools specific
            'codepilot_cli_tools_list',
            'codepilot_cli_tools_add',
            'codepilot_cli_tools_remove',
            'codepilot_cli_tools_check_updates',
            'codepilot_cli_tools_update',
            'codepilot_cli_tools_install',
            'codepilot_mcp_activate',
            'mcp__codepilot-todo__codepilot_mcp_activate',
            // Builtin tools
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob',
            'Grep',
            'Skill',
            'Agent',
            'Task',
            'TodoWrite',
            'mcp__codepilot-todo__TodoWrite',
            'AskUserQuestion',
            'mcp__codepilot-ask-user__AskUserQuestion',
            'WebSearch',
            'WebFetch',
            'webfetch__fetch_fetch_readable',
            'webfetch__fetch_fetch_markdown',
            'context7_resolve-library-id',
            'context7_query-docs',
            // MCP filesystem tools - commonly used
            'mcp__filesystem__read_file',
            'mcp__filesystem__read_text_file',
            'mcp__filesystem__read_media_file',
            'mcp__filesystem__read_multiple_files',
            'mcp__filesystem__write_file',
            'mcp__filesystem__edit_file',
            'mcp__filesystem__get_file_info',
            'mcp__filesystem__list_directory',
            'mcp__filesystem__search_files',
            'mcp__filesystem__directory_tree',
            // MCP fetch tools
            'mcp__fetch__fetch_html',
            'mcp__fetch__fetch_markdown',
            'mcp__fetch__fetch_txt',
            'mcp__fetch__fetch_json',
            'mcp__fetch__fetch_readable',
            // MCP github tools
            'mcp__github__get_file_contents',
            'mcp__github__search_repositories',
          ],
        };

        if (skipPermissions) {
          queryOptions.allowDangerouslySkipPermissions = true;
          console.log('[claude-client] Bypassing all permissions');
        }

// Find claude binary for packaged app where PATH is limited.
// On Windows, npm installs Claude Code CLI as a .cmd wrapper which cannot
// be spawned directly without shell:true. Parse the wrapper to
// extract the real .js script path and pass that to the SDK instead.
const claudePath = findClaudePath();
if (claudePath) {
  console.log('[claude-client] Found Claude Code at:', claudePath);
} else {
  console.log('[claude-client] Claude Code not found, using SDK-only mode');
}
if (claudePath) {
          const ext = path.extname(claudePath).toLowerCase();
          if (ext === '.cmd' || ext === '.bat') {
            const scriptPath = resolveScriptFromCmd(claudePath);
            if (scriptPath) {
              queryOptions.pathToClaudeCodeExecutable = scriptPath;
            } else {
              console.warn('[claude-client] Could not resolve .js path from .cmd wrapper, falling back to SDK resolution:', claudePath);
            }
          } else {
            queryOptions.pathToClaudeCodeExecutable = claudePath;
          }
        }

        if (model) {
          queryOptions.model = model;
        }

        if (systemPrompt) {
          // Use preset append mode to keep Claude Code's default system prompt
          // (which includes Claude Code native behavior, plugin discovery,
          // rules loading, and working directory awareness).
          // 中文注释：功能名称「原生系统提示优先」，用法是这里只追加 CodePilot 的宿主补充，
          // 不再额外注入 OMC 优先前缀，避免和原生 `CLAUDE.md` / hooks / plugins 重复打架。
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: systemPrompt,
          };
        }

        // 中文注释：功能名称「CLI 主路径全量 MCP 透传」，用法是聊天入口已经按当前
        // 工作区解析好全部有效 MCP，这里直接透传给 Claude Code，会话内不再依赖
        // 关键词补载来“碰运气”暴露联网或其他外部工具。
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
        }

        // 中文注释：预载现在只包含常用 MCP 白名单（见 mcp-loader.COMMON_MCP_SERVERS），
        // 因此这里始终运行按需选择器：把「本次请求关键词命中」的低频服务器补进来，
        // 已预载的同名服务器从集合里剔除，避免重复。
        const preloadedNames = new Set(mcpServers ? Object.keys(mcpServers) : []);
        const onDemandMcpNames = selectOnDemandMcpServerNames(prompt, conversationHistory, resolvedWorkingDirectory.path);
        for (const name of preloadedNames) onDemandMcpNames.delete(name);
        if (onDemandMcpNames.size > 0) {
          const { loadOnDemandMcpServers } = await import('@/lib/mcp-loader');
          const onDemandMcps = loadOnDemandMcpServers(resolvedWorkingDirectory.path, onDemandMcpNames);
          if (onDemandMcps) {
            console.log('[claude-client] Loading on-demand MCP servers:', Object.keys(onDemandMcps).join(', '));
            queryOptions.mcpServers = {
              ...toSdkMcpConfig(onDemandMcps),
              ...(queryOptions.mcpServers || {}),
            };
          }
        }

        // MCP discovery prompt: REMOVED — with settingSources including 'user',
        // Claude Code natively discovers and loads MCP servers from settings.json.
        // The on-demand keyword-gated loading above still handles project-level MCPs.

        // Memory MCP: always registered in assistant mode for memory search/retrieval.
        // Unlike other MCPs which are keyword-gated, memory search is a core assistant capability.
        {
          const assistantWorkspacePath = getSetting('assistant_workspace_path');
          if (assistantWorkspacePath && resolvedWorkingDirectory.path === assistantWorkspacePath) {
            const { createMemorySearchMcpServer, MEMORY_SEARCH_SYSTEM_PROMPT } = await import('@/lib/memory-search-mcp');
            queryOptions.mcpServers = {
              ...(queryOptions.mcpServers || {}),
              'codepilot-memory-search': createMemorySearchMcpServer(assistantWorkspacePath),
            };
            if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
              queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + MEMORY_SEARCH_SYSTEM_PROMPT;
            }
          }
        }

        // Notification + Schedule MCP: globally available in all contexts
        {
          const { createNotificationMcpServer, NOTIFICATION_MCP_SYSTEM_PROMPT } =
            await import('@/lib/notification-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-notify': createNotificationMcpServer(),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + NOTIFICATION_MCP_SYSTEM_PROMPT;
          }
        }

        // TodoWrite MCP: globally available in all contexts
        {
          const { createTodoMcpServer, TODO_MCP_SYSTEM_PROMPT } = await import('@/lib/todo-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-todo': createTodoMcpServer(resolvedWorkingDirectory.path),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + TODO_MCP_SYSTEM_PROMPT;
          }
        }

        // Session history search: REMOVED — OMC provides session_search via
        // mcp__plugin_oh-my-claudecode_t__session_search which covers this.

        // Agent and Team: handled natively by Claude Code SDK and OMC plugin.
        // CodePilot no longer provides codepilot-agent or codepilot-team MCP servers.

        // Widget guidelines: progressive loading strategy.
        // The system prompt always includes WIDGET_SYSTEM_PROMPT with format rules.
        // The MCP server (detailed design specs) is only registered when the
        // conversation likely involves widget generation — detected by keywords in
        // the user's prompt or existing show-widget output in conversation history.
        // This avoids SDK tool discovery overhead (~1s) on plain text conversations.
        // Browser MCP: globally available in all contexts
        {
          const { createBrowserMcpServer, BROWSER_SYSTEM_PROMPT } = await import('@/lib/builtin-tools/browser');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-browser': createBrowserMcpServer(),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + BROWSER_SYSTEM_PROMPT;
          }
        }

        // Email MCP: globally available in all contexts
        {
          const { createEmailMcpServer, EMAIL_MCP_SYSTEM_PROMPT } = await import('@/lib/email-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-email': createEmailMcpServer(),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + EMAIL_MCP_SYSTEM_PROMPT;
          }
        }

        // AskUserQuestion: re-registered as MCP with a custom handler that bypasses
        // the SDK's permission system. In bypassPermissions mode, canUseTool is never
        // called, so we drive the interactive UI directly from the tool's execute
        // handler via SSE events and the permission-registry.
        {
          const { createAskUserQuestionMcpServer, ASK_USER_QUESTION_MCP_SYSTEM_PROMPT } = await import('@/lib/ask-user-question-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-ask-user': createAskUserQuestionMcpServer(
              async (toolName, input, toolUseId) => {
                const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const permEvent: PermissionRequestEvent = {
                  permissionRequestId,
                  toolName,
                  toolInput: input,
                  toolUseId: toolUseId || '',
                };
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
                try {
                  createPermissionRequest({
                    id: permissionRequestId,
                    sessionId,
                    sdkSessionId: sdkSessionId || '',
                    toolName,
                    toolInput: JSON.stringify(input),
                    decisionReason: '',
                    expiresAt,
                  });
                } catch (e) {
                  console.warn('[claude-client] Failed to persist AskUserQuestion permission to DB:', e);
                }
                onRuntimeStatusChange?.('waiting_permission');
                console.log('[AskUserQuestion handler] waiting for permission:', { permissionRequestId, toolName });
                // 中文注释：交互式提问按「等人工」处理 —— 不设 5 分钟自动拒绝，
                // 等待时长交给用户；仅当流真正终止（用户停止 / 会话被替换 /
                // 连接断开）时由 signal 释放，避免悬挂的内存等待泄漏。
                waitingPermissionDepth++;
                let result: Awaited<ReturnType<typeof registerPendingPermission>>;
                try {
                  result = await registerPendingPermissionThenNotify(
                    permissionRequestId,
                    input,
                    { interactive: true, signal: abortController?.signal },
                    () => {
                      // The waiter must exist before this reaches the browser:
                      // a fast POST response otherwise races the registry.
                      controller.enqueue(formatSSE({
                        type: 'permission_request',
                        data: JSON.stringify(permEvent),
                      }));
                      if (!autoTrigger) {
                        notifyPermissionRequest(toolName, input as Record<string, unknown>, telegramOpts).catch(() => {});
                      }
                    },
                  );
                } finally {
                  waitingPermissionDepth--;
                }
                console.log('[AskUserQuestion handler] permission resolved:', {
                  permissionRequestId, toolName, behavior: result.behavior,
                  hasUpdatedInput: !!result.updatedInput,
                });
                onRuntimeStatusChange?.('running');
                if (result.behavior === 'deny') {
                  return { behavior: 'deny' as const };
                }
                return { behavior: 'allow' as const, updatedInput: (result.updatedInput || {}) as Record<string, unknown> };
              }
            ),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + ASK_USER_QUESTION_MCP_SYSTEM_PROMPT;
          }
        }

        // 中文注释：功能名称「全量 MCP 常驻加载 - Widget」，用法是每轮对话都加载 Widget MCP，
        // 与 warmup route 保持一致，确保 mcpSignature 匹配。
        // ⚠️ 不能用 generativeUI 条件门控，否则当 generativeUI=false 时 Widget MCP 缺失，
        // warmup 和 chat 的 mcpSignature 不匹配，预热永远无法被消费。
        {
          const { createWidgetMcpServer } = await import('@/lib/widget-guidelines');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-widget': createWidgetMcpServer(),
          };
        }

        // 中文注释：功能名称「全量 MCP 常驻加载 - Media」，用法是每轮对话都加载 Media/ImageGen MCP，
        // 与 warmup route 保持一致，确保 mcpSignature 匹配。
        {
          const { createMediaImportMcpServer, MEDIA_MCP_SYSTEM_PROMPT } = await import('@/lib/media-import-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-media': createMediaImportMcpServer(sessionId, resolvedWorkingDirectory.path),
          };
          // 中文注释：imageAgentMode=true 时不注册 codepilot-image-gen MCP server。
          // 这样模型完全看不到该工具，只能按 IMAGE_AGENT_SYSTEM_PROMPT 输出 image-gen-request 代码块。
          // 签名不匹配会导致无法复用 warmup session，但这正是期望行为。
          if (!imageAgentMode) {
            const { createImageGenMcpServer } = await import('@/lib/image-gen-mcp');
            queryOptions.mcpServers['codepilot-image-gen'] = createImageGenMcpServer(sessionId, resolvedWorkingDirectory.path);
          }
          if (!imageAgentMode && queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + MEDIA_MCP_SYSTEM_PROMPT;
          }
        }

        // 中文注释：功能名称「CLI 工具 MCP 常驻挂载」，用法是每轮 Claude Code 会话都显式
        // 注入 CodePilot 的 CLI 工具管理 MCP，避免前端能看到 CLI 能力但会话里因为关键词门控
        // 没注册，导致 AI "知道有功能却调不到"。
        const { createCliToolsMcpServer, CLI_TOOLS_MCP_SYSTEM_PROMPT } = await import('@/lib/cli-tools-mcp');
        queryOptions.mcpServers = {
          ...(queryOptions.mcpServers || {}),
          'codepilot-cli-tools': createCliToolsMcpServer(),
        };
        if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
          queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + CLI_TOOLS_MCP_SYSTEM_PROMPT;
        }

        // 中文注释：功能名称「全量 MCP 常驻加载 - Dashboard」，用法是每轮对话都加载 Dashboard MCP，
        // 与 warmup route 保持一致，确保 mcpSignature 匹配。
        {
          const { createDashboardMcpServer, DASHBOARD_MCP_SYSTEM_PROMPT } = await import('@/lib/dashboard-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-dashboard': createDashboardMcpServer(sessionId, resolvedWorkingDirectory.path),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + DASHBOARD_MCP_SYSTEM_PROMPT;
          }
        }

        // Pass through SDK-specific options from ClaudeStreamOptions.
        // Shared sanitizer runs the same Opus 4.7 migration guards as the
        // native agent-loop path — manual extended thinking becomes
        // adaptive, and the context-1m beta header is dropped since 4.7
        // ships 1M by default.
        const sanitized = sanitizeClaudeModelOptions({
          model,
          thinking,
          effort,
          context1m,
        });

        if (sanitized.thinking) {
          queryOptions.thinking = sanitized.thinking;
        }
        // SDK-runtime effort policy: when the UI doesn't explicitly pick a
        // level, leave `effort` unset so Claude Code CLI applies its
        // per-model default (e.g. Opus 4.7 defaults to xhigh, Sonnet to
        // high). Writing 'medium' unconditionally would override that and
        // regress the 4.7 out-of-box experience.
        //
        // The previous concern about settings.json injecting 'high' is
        // mitigated by CLI defaults: they're applied with lower precedence
        // than both queryOptions.effort and settingSources, so an explicit
        // UI choice still wins and a missing one doesn't silently escalate
        // to 'high'.
        if (sanitized.effort) {
          queryOptions.effort = sanitized.effort as Options['effort'];
        }
        if (outputFormat) {
          queryOptions.outputFormat = outputFormat;
        }
        if (agents) {
          queryOptions.agents = agents as Options['agents'];
        }
        if (agent) {
          queryOptions.agent = agent;
        }
        if (enableFileCheckpointing) {
          queryOptions.enableFileCheckpointing = true;
        }
        if (sanitized.applyContext1mBeta) {
          queryOptions.betas = [
            ...(queryOptions.betas || []),
            'context-1m-2025-08-07',
          ];
        }

        if (enabledPlugins.length > 0) {
          queryOptions.plugins = enabledPlugins as Options['plugins'];
          console.log('[claude-client] Injecting enabled plugins:', enabledPlugins.map(p => path.basename(p.path)).join(', '));

          // 中文注释：--strict-mcp-config 会连带跳过「插件自带的 MCP」（实测 omc 插件的
          // bridge 工具集被排除）。这里显式读取启用插件的 .mcp.json 并入注入列表，
          // 命名与 CLI 原生命名保持一致（plugin:<name>:<server>），避免误伤插件工具。
          try {
            const pluginMcpEntries: Record<string, MCPServerConfig> = {};
            for (const plugin of enabledPlugins) {
              const manifestPath = path.join(plugin.path, '.claude-plugin', 'plugin.json');
              if (!fs.existsSync(manifestPath)) continue;
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { mcpServers?: string };
              if (typeof manifest.mcpServers !== 'string') continue;
              const mcpPath = path.resolve(plugin.path, manifest.mcpServers);
              if (!fs.existsSync(mcpPath)) continue;
              const mcpJson = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) as { mcpServers?: Record<string, MCPServerConfig> };
              const pluginName = path.basename(plugin.path);
              for (const [serverName, rawCfg] of Object.entries(mcpJson.mcpServers || {})) {
                if (!rawCfg) continue;
                const resolveRoot = (v: string) => v.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, plugin.path);
                pluginMcpEntries[`plugin:${pluginName}:${serverName}`] = {
                  ...rawCfg,
                  args: (rawCfg.args || []).map(resolveRoot),
                  env: rawCfg.env
                    ? Object.fromEntries(Object.entries(rawCfg.env).map(([k, v]) => [k, resolveRoot(String(v))]))
                    : undefined,
                };
              }
            }
            if (Object.keys(pluginMcpEntries).length > 0) {
              queryOptions.mcpServers = {
                ...(queryOptions.mcpServers || {}),
                ...toSdkMcpConfig(pluginMcpEntries),
              };
              console.log('[claude-client] Injected plugin MCP servers:', Object.keys(pluginMcpEntries).join(', '));
            }
          } catch (pluginMcpErr) {
            console.warn('[claude-client] Failed to inject plugin MCP servers:', pluginMcpErr);
          }
        }

        // 中文注释：功能名称「Hook 生命周期固定开启」，用法是在唯一的 Claude Code CLI
        // 主路径下始终观察 hook 事件，让 OMC/插件生命周期对桌面端保持可见。
        // ⚠️ 必须在 buildPersistentClaudeSignature 之前设置，否则 warmup 路由
        // 的签名包含 includeHookEvents=true，而 chat 路由签名中为 undefined，
        // 导致签名永远不匹配，预热永远无法被消费，首轮始终冷启动。
        queryOptions.includeHookEvents = true;
        // The CLI performs automatic compaction internally. Observe both
        // lifecycle hooks so the desktop timeline remains continuous even
        // though no fabricated percentage can be provided by the SDK.
        queryOptions.hooks = {
          ...(queryOptions.hooks || {}),
          PreCompact: [{
            hooks: [async (input) => {
              const compact = input as { trigger?: 'manual' | 'auto' };
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  subtype: 'context_compressing',
                  source: 'cli',
                  trigger: compact.trigger || 'auto',
                  message: 'CLI 正在整理上下文，当前会话不会中断',
                }),
              }));
              return { continue: true };
            }],
          }],
          PostCompact: [{
            hooks: [async (input) => {
              const compact = input as { trigger?: 'manual' | 'auto' };
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  subtype: 'context_compressed',
                  source: 'cli',
                  trigger: compact.trigger || 'auto',
                  message: 'CLI 已完成上下文整理，当前会话继续执行',
                  stats: { messagesCompressed: 0, tokensSaved: 0 },
                }),
              }));
              return { continue: true };
            }],
          }],
        };

        // Resume session if we have an SDK session ID from a previous conversation turn.
        // Pre-check: verify working_directory exists before attempting resume.
        // Resume depends on session context (cwd/project scope), so if the
        // original working_directory no longer exists, resume will fail.
        let shouldResume = !!sdkSessionId;
        if (shouldResume && workingDirectory && resolvedWorkingDirectory.source !== 'requested') {
          console.warn(
            `[claude-client] Working directory "${workingDirectory}" does not exist, skipping resume`,
          );
          shouldResume = false;
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              _internal: true,
              resumeFallback: true,
              title: 'Session fallback',
              message: 'Original working directory no longer exists. Starting fresh conversation.',
            }),
          }));
        }
        const providerKey = resolved.provider?.id || options.providerId || options.sessionProviderId || 'env';
        const persistentSignature = buildPersistentClaudeSignature({
          providerKey,
          options: queryOptions,
        });
        console.log('[claude-client] Signature computed:', {
          sessionId,
          persistentSignature,
          providerKey,
          model: queryOptions.model,
          cwd: queryOptions.cwd,
          settingSources: queryOptions.settingSources,
          mcpServerNames: queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers) : [],
          envAnthropicBaseUrl: queryOptions.env?.ANTHROPIC_BASE_URL || '(none)',
          envAuthKind: queryOptions.env?.ANTHROPIC_AUTH_TOKEN ? 'auth_token' : queryOptions.env?.ANTHROPIC_API_KEY ? 'api_key' : 'none',
          resolvedProviderId: resolved.provider?.id || '(none)',
          resolvedHasCredentials: resolved.hasCredentials,
          optionsProviderId: options.providerId,
          optionsSessionProviderId: options.sessionProviderId,
        });
        // 中文注释：功能名称「OMC 会话复用保活」，用法是在 OMC 启用时也继续允许
        // CodePilot 的持久会话池与预热结果复用，解决每轮对话都重新连接 Claude Code
        // 进程、首轮和后续轮次都明显变慢的问题。
        // 中文注释：功能名称「OMC 会话复用保活」，用法是在 OMC 启用时也继续允许
        // CodePilot 的持久会话池与预热结果复用，解决每轮对话都重新连接 Claude Code
        // 进程、首轮和后续轮次都明显变慢的问题。
        const shouldBypassPersistentSession = false;

        // 中文注释：功能名称「预热接力」，用法是尝试将 warmup 创建的 persistent session
        // 接管到当前 sessionId。warmup route 可能用 warmup:provider:model:cwd 作为 key，
        // chat route 用真实 sessionId。通过签名匹配找到 warmup 的 entry 并 adopt。
        if (!shouldBypassPersistentSession && sessionId && !sdkSessionId) {
          // 先检查是否已有完全匹配的 session
          const canReuseDirectly = canReusePersistentClaudeSession(sessionId, persistentSignature);
          console.log('[claude-client] Pre-adoption check:', {
            sessionId,
            canReuseDirectly,
            hasSession: hasPersistentSessionBySessionId(sessionId),
            sdkSessionId: sdkSessionId || '(none)',
            chatModel: queryOptions.model,
            chatCwd: queryOptions.cwd,
            chatPermMode: queryOptions.permissionMode,
          });
          if (!canReuseDirectly) {
            // 尝试按签名查找并 adopt（可能从 warmup:xxx 过来）
            const adopted = adoptPersistentClaudeSessionBySignature(persistentSignature, sessionId);
            console.log('[claude-client] Adoption result:', { adopted, sessionId });
          }
        }

        // 中文注释：功能名称「预热复用门控」，用法是检查 WarmQuery Store 中是否存在
        // 当前 sessionId 的预热句柄。之前用签名匹配（hasWarmedNativeClaudeQuery），
        // 但签名几乎不可能在 warmup route 和 chat route 之间完全一致，
        // 导致 WarmQuery 永远无法被消费。改为按 sessionId 直接查找。
        const canReuseWarmup = sessionId
          ? hasWarmedNativeClaudeQueryBySessionId(sessionId)
          : false;

        if (sessionId) {
          const { getWarmQueryDiagnostics } = await import('./persistent-claude-session');
          const diag = getWarmQueryDiagnostics();
          console.log('[claude-client] WarmQuery reuse check:', {
            canReuseWarmup,
            shouldBypassPersistentSession,
            sessionId,
            chatSignature: persistentSignature?.slice(0, 12) + '...',
            storeSize: diag.storeSize,
            storeEntries: diag.entries,
          });
        }

        // 中文注释：使用模糊签名匹配代替精确匹配，解决 warmup route 和 chat route
        // 签名不一致导致预热 session 永远无法复用的问题。
        // 模糊匹配只检查关键字段（provider/model/cwd），允许非关键字段有差异。
        const canReuseExact = canReusePersistentClaudeSession(sessionId, persistentSignature);
        const hasBySessionId = hasPersistentSessionBySessionId(sessionId);
        const willReusePersistentSession = !shouldBypassPersistentSession && (canReuseExact || hasBySessionId);
        console.log('[claude-client] Reuse decision:', {
          sessionId,
          canReuseExact,
          hasBySessionId,
          willReusePersistentSession,
          canReuseWarmup,
          shouldResume,
          sdkSessionId: sdkSessionId || '(none)',
        });
        // 中文注释：WarmQuery 是 one-shot 预热句柄，不能接力成后续轮次的后台会话。
        // 如果 persistent session 可复用，必须优先使用 persistent，避免首轮消费
        // WarmQuery 后第二轮退回 resume 冷启动。
        const willConsumeWarmQuery = canReuseWarmup && sessionId && !willReusePersistentSession;

        // 中文注释：如果 WarmQuery 存在且将被消费，就不走 resume 路径，
        // 因为 WarmQuery 提供了更快的初始化路径（CLI 子进程已预热），
        // 不需要 "Reconnecting to previous conversation..." 的提示。
        const shouldPassResume = shouldResume && !willReusePersistentSession && !willConsumeWarmQuery;

        if (shouldPassResume) {
          // Emit visible status so the user sees feedback during resume initialization
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              notification: true,
              title: 'Resuming session',
              message: 'Reconnecting to previous conversation...',
            }),
          }));
          queryOptions.resume = sdkSessionId;
        }

        // Permission handler: sends SSE event and waits for user response
        queryOptions.canUseTool = async (toolName, input, opts) => {
          // Auto-approve CodePilot's own in-process MCP tools — they are internal
          // and the user has already opted in by enabling the relevant mode.
          // Auto-approve CodePilot's own in-process MCP tools — they are internal
          // and the user has already opted in by enabling the relevant mode.
          // Note: SDK prefixes MCP tool names with mcp__<server>__, so we check
          // both bare and prefixed names.
          const autoApprovedTools = [
            'codepilot_generate_image',
            'codepilot_import_media',
            'codepilot_load_widget_guidelines',
            'codepilot_cli_tools_list',
            'codepilot_cli_tools_add',
            'codepilot_cli_tools_remove',
            'codepilot_cli_tools_check_updates',
            'codepilot_dashboard_pin',
            'codepilot_dashboard_list',
            'codepilot_dashboard_refresh',
            'codepilot_dashboard_update',
            'codepilot_dashboard_remove',
            'TodoWrite',
            'mcp__codepilot-todo__TodoWrite',
            'codepilot_skill_create',
            'mcp__codepilot-todo__codepilot_skill_create',
            'codepilot_mcp_activate',
            'mcp__codepilot-todo__codepilot_mcp_activate',
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob',
            'Grep',
            'Skill',
            'Agent',
            'Task',
            'mcp__filesystem__read_file',
            'mcp__filesystem__read_multiple_files',
            'mcp__filesystem__write_file',
            'mcp__filesystem__edit_file',
            'mcp__filesystem__create_directory',
            'mcp__filesystem__list_directory',
            'mcp__filesystem__directory_tree',
            'mcp__filesystem__move_file',
            'mcp__filesystem__search_files',
            'mcp__filesystem__get_file_info',
            'mcp__filesystem__list_allowed_directories'
          ];
          if (autoApprovedTools.some(t => toolName === t || toolName.endsWith(`__${t}`))) {
            return { behavior: 'allow' as const, updatedInput: input };
          }

          const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            permissionRequestId,
            toolName,
            toolInput: input,
            suggestions: opts.suggestions as PermissionRequestEvent['suggestions'],
            decisionReason: opts.decisionReason,
            blockedPath: opts.blockedPath,
            toolUseId: opts.toolUseID,
            description: undefined,
          };

          // Persist permission request to DB for audit/recovery
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
          try {
            createPermissionRequest({
              id: permissionRequestId,
              sessionId,
              sdkSessionId: sdkSessionId || '',
              toolName,
              toolInput: JSON.stringify(input),
              decisionReason: opts.decisionReason || '',
              expiresAt,
            });
          } catch (e) {
            console.warn('[claude-client] Failed to persist permission request to DB:', e);
          }

          // Send permission_request SSE event to the client
          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Notify via Telegram (fire-and-forget) — skip for auto-trigger turns
          if (!autoTrigger) {
            notifyPermissionRequest(toolName, input as Record<string, unknown>, telegramOpts).catch(() => {});
          }

          // Notify runtime status change
          onRuntimeStatusChange?.('waiting_permission');

          // Wait for user response (resolved by POST /api/chat/permission)
          // Store original input so registry can inject updatedInput on allow
          // 中文注释：区分两类等待 ——
          //  · 交互式工具（AskUserQuestion / ExitPlanMode）按「等人工」处理：
          //    不设墙钟自动拒绝，等待时长由人决定，仅由流终止 signal 释放。
          //  · 其余工具权限沿用 5 分钟自动拒绝兜底。
          // 传入的 abortController.signal 只在「本轮确实终止」时触发
          // （用户手动停止 / 会话被替换 / SSE 连接断开）——等待期间不会误触发，
          // 因为前端 idle 由 15s keep_alive 保活、服务端看门狗在等待期已暂停。
          const interactive = isAlwaysAskTool(toolName);
          console.log('[canUseTool] waiting for permission:', { permissionRequestId, toolName, interactive, hasInput: !!input });
          waitingPermissionDepth++;
          let result: Awaited<ReturnType<typeof registerPendingPermission>>;
          try {
            result = await registerPendingPermission(permissionRequestId, input, {
              interactive,
              signal: abortController?.signal,
            });
          } finally {
            waitingPermissionDepth--;
          }
          console.log('[canUseTool] permission resolved:', {
            permissionRequestId,
            toolName,
            behavior: result.behavior,
            hasUpdatedInput: !!result.updatedInput,
            updatedInputPreview: result.updatedInput ? JSON.stringify(result.updatedInput).slice(0, 300) : 'none',
          });

          // Restore runtime status after permission resolved
          onRuntimeStatusChange?.('running');

          // Cast to SDK PermissionResult (NativePermissionResult is a compatible subset)
          return result as unknown as import('@anthropic-ai/claude-agent-sdk').PermissionResult;
        };

        // Telegram notification context for hooks
        const telegramOpts = {
          sessionId,
          sessionTitle: undefined as string | undefined,
          workingDirectory: resolvedWorkingDirectory.path,
        };

        // Capture real-time stderr output from Claude Code process
        queryOptions.stderr = (data: string) => {
          // Diagnostic: log raw stderr data length to server console
          console.log(`[stderr] received ${data.length} bytes, first 200 chars:`, data.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '?'));
          // Strip ANSI escape codes, OSC sequences, and control characters
          // but preserve tabs (\x09) and carriage returns (\x0D)
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
            .replace(/\x1B\([A-Z]/g, '')               // Character set selection
            .replace(/\x1B[=>]/g, '')                   // Keypad mode
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
            .replace(/\r\n/g, '\n')                    // Normalize CRLF
            .replace(/\r/g, '\n')                      // Convert remaining CR to LF
            .replace(/\n{3,}/g, '\n\n')                // Collapse multiple blank lines
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: cleaned,
            }));
          }
        };

        // Build the prompt with file attachments and optional conversation history.
        // When resuming, the SDK has full context so we send the raw prompt.
        // When NOT resuming (fresh or fallback), prepend DB history for context.
        function buildFinalPrompt(useHistory: boolean): string | AsyncIterable<SDKUserMessage> {
          const basePrompt = useHistory
            ? buildFallbackContext({
                prompt,
                history: conversationHistory,
                sessionSummary: options.sessionSummary,
                tokenBudget: options.fallbackTokenBudget,
              })
            : prompt;

          if (!files || files.length === 0) return basePrompt;

          const imageFiles = files.filter(f => isImageFile(f.type));
          const nonImageFiles = files.filter(f => !isImageFile(f.type));

          let textPrompt = basePrompt;
          if (nonImageFiles.length > 0) {
            const workDir = resolvedWorkingDirectory.path;
            const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
            const fileReferences = savedPaths
              .map((p, i) => `[User attached file: ${p} (${nonImageFiles[i].name})]`)
              .join('\n');
            textPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${basePrompt}`;
          }

          if (imageFiles.length > 0) {
            // Limit media items: keep the MOST RECENT images (drop oldest first),
            // consistent with "preserve recent context" strategy.
            const MAX_MEDIA_ITEMS = 100;
            const limitedImages = imageFiles.length > MAX_MEDIA_ITEMS
              ? imageFiles.slice(-MAX_MEDIA_ITEMS)
              : imageFiles;
            const droppedCount = imageFiles.length - limitedImages.length;

            // In imageAgentMode, skip file path references so Claude doesn't
            // try to use built-in tools to analyze images from disk. It will
            // see the images via vision (base64 content blocks) and follow the
            // IMAGE_AGENT_SYSTEM_PROMPT to output image-gen-request blocks.
            // In normal mode, append disk paths — only for the images actually included.
            const textWithImageRefs = imageAgentMode
              ? textPrompt
              : (() => {
                  const workDir = resolvedWorkingDirectory.path;
                  const imagePaths = getUploadedFilePaths(limitedImages, workDir);
                  const imageReferences = imagePaths
                    .map((p, i) => `[User attached image: ${p} (${limitedImages[i].name})]`)
                    .join('\n');
                  return `${imageReferences}\n\n${textPrompt}`;
                })();

            const contentBlocks: Array<
              | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }
              | { type: 'text'; text: string }
            > = [];

            for (const img of limitedImages) {
              // Read base64 from disk if the data was cleared after upload
              let imgData = img.data;
              if (!imgData && img.filePath) {
                try {
                  imgData = fs.readFileSync(img.filePath).toString('base64');
                } catch {
                  continue; // Skip images whose files are missing
                }
              }
              if (!imgData) continue;
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: (img.type || 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: imgData,
                },
              });
            }

            if (droppedCount > 0) {
              contentBlocks.push({ type: 'text', text: `[Note: ${droppedCount} older image(s) were omitted due to the ${MAX_MEDIA_ITEMS}-image limit per request.]` });
            }
            contentBlocks.push({ type: 'text', text: textWithImageRefs });

            const userMessage: SDKUserMessage = {
              type: 'user',
              message: {
                role: 'user',
                content: contentBlocks,
              },
              parent_tool_use_id: null,
              session_id: sdkSessionId || '',
            };

            return (async function* () {
              yield userMessage;
            })();
          }

          return textPrompt;
        }

        async function promptToUserMessages(
          value: string | AsyncIterable<SDKUserMessage>,
          fallbackSdkSessionId: string | undefined,
        ): Promise<SDKUserMessage[]> {
          if (typeof value !== 'string') {
            const messages: SDKUserMessage[] = [];
            for await (const message of value) {
              messages.push(message);
            }
            return messages;
          }

          return [{
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: value }],
            },
            parent_tool_use_id: null,
            session_id: fallbackSdkSessionId || '',
          }];
        }

        const finalPrompt = buildFinalPrompt(!shouldResume);

        // Try to start the conversation. If resuming a previous session fails
        // (e.g. stale/corrupt session file, CLI version mismatch), automatically
        // fall back to starting a fresh conversation without resume.
        let conversation: AsyncIterable<SDKMessage>;
        // Keep a handle to the underlying Query instance for control-API
        // calls (getContextUsage etc.). When we peek-and-rewrap below to
        // detect resume failures, `conversation` becomes a plain async
        // generator that loses the Query prototype's methods — we need
        // this original reference to call .getContextUsage() at result
        // time. Reassigned on resume-fallback to point at the fresh Query.
        let controlQuery: Query;

        // 中文注释：消费 WarmQuery 的条件改为：
        // 1. 不 bypass persistent session
        // 2. WarmQuery 存在（canReuseWarmup）
        // 3. sessionId 存在
        // 4. prompt 是 string
        // 5. 不在 resume 且 PersistentSession 可复用（旧逻辑）
        //    或者：在 resume 但 PersistentSession 不可用（签名不匹配/已过期），
        //    此时 WarmQuery 比失败的 resume 更快更可靠
        const warmedNativeQuery = canReuseWarmup
          && sessionId
          && typeof finalPrompt === 'string'
          && (!shouldResume || !willReusePersistentSession)
          && !willReusePersistentSession
          ? takeWarmedNativeClaudeQueryBySessionId(sessionId)
          : null;

        if (warmedNativeQuery) {
          console.log('[claude-client] Consuming official WarmQuery for first text turn');
          const warmConversation = warmedNativeQuery.warmQuery.query(finalPrompt);
          conversation = warmConversation;
          controlQuery = warmConversation;
          warmedQueryCleanup = warmedNativeQuery.cleanup;
        } else if (!shouldBypassPersistentSession) {
          const persistentMessages = await promptToUserMessages(finalPrompt, sdkSessionId);
          try {
            const persistentTurn = getPersistentClaudeTurn({
              codepilotSessionId: sessionId,
              signature: persistentSignature,
              options: {
                ...queryOptions,
                // Persistent sessions use an internal lifecycle; per-request
                // aborts close the pooled process explicitly below.
                abortController: undefined,
              },
              messages: persistentMessages,
              shadowHandle: shadowHome || undefined,
              requireInteractiveAskUserQuestion: true,
            });
            conversation = persistentTurn.conversation;
            controlQuery = persistentTurn.query;
            usingPersistentSession = true;
            persistentQueryForStream = persistentTurn.query;
            if (!persistentTurn.reused) {
              shadowHandleOwnedByPersistentSession = true;
            }
            console.log('[claude-client] Persistent Claude session:', persistentTurn.reused ? 'reused' : 'started');
          } catch (persistentStartError) {
            console.warn('[claude-client] Persistent Claude session failed to start, falling back to one-shot query:', persistentStartError);
            const oneShot = query({
              prompt: finalPrompt,
              options: queryOptions,
            });
            conversation = oneShot;
            controlQuery = oneShot;
          }
        } else {
          console.log('[claude-client] Using direct query path instead of persistent session pool');
          const oneShot = query({
            prompt: finalPrompt,
            options: queryOptions,
          });
          conversation = oneShot;
          controlQuery = oneShot;
        }

        // Wrap the iterator so we can detect resume failures on the first message
        if (shouldPassResume && usingPersistentSession) {
          try {
            const iter = conversation[Symbol.asyncIterator]();
            const first = await iter.next();
            conversation = (async function* () {
              if (!first.done) yield first.value;
              while (true) {
                const next = await iter.next();
                if (next.done) break;
                yield next.value;
              }
            })();
          } catch (resumeError) {
            const errMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            console.warn('[claude-client] Persistent resume failed, retrying without resume:', errMsg);
            if (persistentQueryForStream) {
              closePersistentClaudeSession(sessionId, persistentQueryForStream);
            }
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify({
                _internal: true,
                resumeFallback: true,
                title: 'Session fallback',
                message: 'Previous session could not be resumed. Starting fresh conversation.',
              }),
            }));
            delete queryOptions.resume;
            try {
              const freshMessages = await promptToUserMessages(buildFinalPrompt(true), undefined);
              const freshPersistent = getPersistentClaudeTurn({
                codepilotSessionId: sessionId,
                signature: buildPersistentClaudeSignature({
                  providerKey: resolved.provider?.id || options.providerId || options.sessionProviderId || 'env',
                  options: queryOptions,
                }),
                options: { ...queryOptions, abortController: undefined },
                messages: freshMessages,
                shadowHandle: shadowHome || undefined,
                requireInteractiveAskUserQuestion: true,
              });
              conversation = freshPersistent.conversation;
              controlQuery = freshPersistent.query;
              usingPersistentSession = true;
              persistentQueryForStream = freshPersistent.query;
              if (!freshPersistent.reused) {
                shadowHandleOwnedByPersistentSession = true;
              }
            } catch (persistentFallbackError) {
              console.warn('[claude-client] Persistent resume fallback failed, using one-shot query:', persistentFallbackError);
              const freshQuery = query({
                prompt: buildFinalPrompt(true),
                options: queryOptions,
              });
              conversation = freshQuery;
              controlQuery = freshQuery;
              usingPersistentSession = false;
            }
          }
        } else if (shouldPassResume && !usingPersistentSession) {
          try {
            // Peek at the first message to verify resume works
            const iter = conversation[Symbol.asyncIterator]();
            const first = await iter.next();

            // Re-wrap into an async iterable that yields the first message then the rest
            conversation = (async function* () {
              if (!first.done) yield first.value;
              while (true) {
                const next = await iter.next();
                if (next.done) break;
                yield next.value;
              }
            })();
            // controlQuery still points at the original Query with
            // getContextUsage() available.
          } catch (resumeError) {
            const errMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            console.warn('[claude-client] Resume failed, retrying without resume:', errMsg);
            // Clear stale sdk_session_id so future messages don't retry this broken resume
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }
            // Notify frontend about the fallback
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify({
                _internal: true,
                resumeFallback: true,
                title: 'Session fallback',
                message: 'Previous session could not be resumed. Starting fresh conversation.',
              }),
            }));
            // Remove resume and try again as a fresh conversation with history context
            delete queryOptions.resume;
            const freshQuery = query({
              prompt: buildFinalPrompt(true),
              options: queryOptions,
            });
            conversation = freshQuery;
            // Fresh Query replaces the old handle — control-API calls
            // now go through this one.
            controlQuery = freshQuery;
          }
        }

        registerConversation(sessionId, controlQuery);

        // Defer capability capture until first assistant response to avoid
        // competing with first-token latency. Skip entirely if cache is fresh.
        const capProviderId = resolved.provider?.api_key ? resolved.provider.id || 'custom' : 'env';
        let capturePending = !isCacheFresh(capProviderId);

        let tokenUsage: TokenUsage | null = null;
        // A stream iterator can end normally after an upstream transport drop.
        // Only an SDK result is proof that the user's turn completed.
        receivedTerminalResult = false;
        // A background task can finish while the SDK fails to start its
        // injected parent-summary turn. This is a graceful completion path:
        // preserve the completed work instead of later reclassifying it as a
        // generic upstream timeout.
        backgroundFinalizationExpired = false;
        // 中文注释：记录主线程最后一条 assistant 帧的单次请求用量。result 的
        // usage 是整个 query 的累计值，用它反推上下文尺寸会严重低估（见
        // extractTokenUsage 注释），所以这里留存真实单次请求的 input 侧。
        let lastAssistantUsage: AssistantRequestUsage | null = null;
        // 中文注释：功能名称「SDK 工作流统计」，用法是统计 SDK 主路径中实际发生的
        // tool_use 次数与去重后的工具集合，为 self-improvement / 自动技能提炼提供依据。
        let sdkToolUseCount = 0;
        const sdkDistinctTools = new Set<string>();
        const sdkAllToolNames: string[] = [];
        let sdkToolErrors = 0;
        // Track pending TodoWrite tool_use_ids so we can sync after successful execution
        const pendingTodoWrites = new Map<string, Array<{ content: string; status: string; activeForm?: string }>>();
        // Track pending file modifications so we can record checkpoints
        const pendingFileModifications = new Map<string, string>();
        // Collect file paths and web URLs from tool calls/results for context stats
        const toolFilesAccumulator = new Set<string>();
        // 中文注释：功能名称「SDK子Agent追踪」，用法是追踪SDK runtime中Agent工具的调用，
        // 发射合成的subagent_start/complete SSE事件，使子Agent卡片在会话切换后仍能恢复渲染
        const pendingAgentToolUse = new Map<string, SyntheticSubagentInfo>();
        // 中文注释：功能名称「Agent嵌套深度追踪」，用法是追踪当前工具调用是否处于子Agent上下文中。
        // 当SDK流中父Agent调用Agent/Team工具时，子Agent的工具调用(Read/Write/Bash等)会混在同一个流中，
        // 通过维护一个栈结构，可以为每个tool_use标记parentAgentId，使客户端能正确归属工具调用。
        const agentStack: string[] = [];
        // 中文注释：记录每个tool_use_id对应的parentAgentId，用于在tool_result时也能正确标记
        const toolParentAgentMap = new Map<string, string>();
        const resolvePendingSubagent = (toolUseId?: string, taskId?: string): [string, SyntheticSubagentInfo] | null => {
          if (toolUseId && pendingAgentToolUse.has(toolUseId)) {
            return [toolUseId, pendingAgentToolUse.get(toolUseId)!];
          }
          if (taskId) {
            for (const entry of pendingAgentToolUse.entries()) {
              if (entry[1].taskId === taskId) {
                return entry;
              }
            }
          }
          return null;
        };
        // 中文注释：功能名称「Bash命令追踪」，用法是追踪SDK runtime中Bash工具的调用，
        // 在tool_result时发射terminal_mirror事件，将命令输出镜像到终端面板
        const pendingBashCommands = new Map<string, string>();
        // 中文注释：功能名称「SDK 内部轮次抑制」，用法是标记当前是否处于 SDK 自己注入的
        // 轮次（如后台 Bash 任务的 <task-notification>）中。处于抑制态时其 assistant 输出
        // 与工具结果都不再向上游发射，避免被当作用户问题的回答；该轮次的 result 只用来
        // 关闭标记，不透传，以免污染本轮的 usage/耗时统计。状态机见 SdkInjectedTurnTracker。
        const sdkInjectedTurn = new SdkInjectedTurnTracker();
        const clearBackgroundFinalizationTimer = () => {
          if (backgroundFinalizationTimer) {
            clearTimeout(backgroundFinalizationTimer);
            backgroundFinalizationTimer = null;
          }
        };
        const scheduleBackgroundFinalization = () => {
          clearBackgroundFinalizationTimer();
          backgroundFinalizationTimer = setTimeout(() => {
            if (controller.closed || abortController?.signal.aborted) return;
            console.warn('[claude-client] Background tasks finished, but the final summary did not arrive; ending stale query');
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify({
                notification: true,
                message: '后台任务已完成，但未收到最终汇总，已结束本轮。任务结果已保留。',
              }),
            }));
            controller.enqueue(formatSSE({
              type: 'aborted',
              data: JSON.stringify({ reason: 'background_finalization_timeout' }),
            }));
            backgroundFinalizationExpired = true;
            abortController?.abort();
          }, BACKGROUND_FINALIZATION_GRACE_MS);
        };
        // 中文注释：等待后台子 Agent 期间的保活心跳——每 30s 一条 keep_alive，
        // 只有存在未回报的后台子 Agent 时才发送，正常对话不受影响。
        agentWaitKeepAliveTimer = setInterval(() => {
          if (pendingAgentToolUse.size > 0 && !controller.closed) {
            // A background child is an expected silent phase.  This is real
            // server-side progress, not merely a browser keep-alive: refresh
            // the same clock used by the global watchdog so it cannot abort
            // a child that is still within the persistent-session deadline.
            lastStreamActivityAt = Date.now();
            controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
          }
        }, 30_000);
        streamMessages: for await (const message of conversation) {
          // 中文注释：全流无进度看门狗的活动时间戳 —— 收到任何 SDK 消息都算有进度
          lastStreamActivityAt = Date.now();
          if (abortController?.signal.aborted) {
            // This request no longer owns the stream.  A persistent SDK Query
            // can continue emitting background task frames after an abort; if
            // reused, the next user message would consume those old frames.
            // Discard the process to make the next POST a clean turn boundary.
            if (usingPersistentSession && persistentQueryForStream) {
              closePersistentClaudeSession(sessionId, persistentQueryForStream);
            }
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }
            console.log('[claude-client] Stream aborted for session', sessionId, '— discarded persistent session to prevent cross-turn events');
            break;
          }

          // 中文注释：功能名称「SDK 内部轮次抑制」，用法是在检测到 SDK 注入轮次（如后台任务
          // 完成的 <task-notification>）后，丢弃该轮次的全部可见输出（assistant 文本、
          // 工具调用与工具结果），只放行 system 与 result。这样下游既不会把这一轮误当成
          // 用户问题的回答，Bridge 也不会把它推送出去；放行 result 是为了拿到轮次结束信号。
          if (sdkInjectedTurn.shouldSuppress(message.type)) {
            continue;
          }

          switch (message.type) {
            case 'assistant': {
              sdkInjectedTurn.markAssistantMessage();
              // Deferred capability capture: trigger after first assistant message
              if (capturePending) {
                capturePending = false;
                captureCapabilities(sessionId, controlQuery, capProviderId).catch((err) => {
                  console.warn('[claude-client] Deferred capability capture failed:', err);
                });
              }
              const assistantMsg = message as SDKAssistantMessage;
              if (!assistantMsg.parent_tool_use_id && assistantMsg.error) {
                assistantErrorMessage = extractTextFromMessage(assistantMsg).trim() || assistantMsg.error;
              }
              // Text deltas are handled by stream_event for real-time streaming.
              // Here we only process tool_use blocks.

              // 中文注释：只取主线程的 assistant 帧。子Agent 的帧带
              // parent_tool_use_id，其上下文与主会话无关，若覆盖会污染主会话
              // 的上下文尺寸统计。
              if (!assistantMsg.parent_tool_use_id && assistantMsg.message.usage) {
                lastAssistantUsage = assistantMsg.message.usage;
              }

              // Check for tool use blocks
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
                  sdkToolUseCount += 1;
                  sdkDistinctTools.add(block.name);
                  sdkAllToolNames.push(block.name);
                  console.log('[claude-client] tool_use:', { id: block.id, name: block.name, input: block.input });
                  // 中文注释：如果当前处于子Agent上下文（agentStack非空），标记parentAgentId，
                  // 使客户端能将此工具调用归属到正确的子Agent时间线而非主时间线
                  const currentParentAgentId = agentStack.length > 0 ? agentStack[agentStack.length - 1] : undefined;
                  if (currentParentAgentId) {
                    toolParentAgentMap.set(block.id, currentParentAgentId);
                  }
                  controller.enqueue(formatSSE({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: block.id,
                      name: block.name,
                      input: block.input,
                      ...(currentParentAgentId ? { parentAgentId: currentParentAgentId } : {}),
                    }),
                  }));

                  // Track TodoWrite calls — sync deferred until tool_result confirms success
                  if (isTodoWriteToolName(block.name)) {
                    try {
                      const toolInput = block.input as {
                        todos?: Array<{ content: string; status: string; activeForm?: string }>;
                      };
                      if (toolInput?.todos && Array.isArray(toolInput.todos)) {
                        pendingTodoWrites.set(block.id, toolInput.todos);
                      }
                    } catch (e) {
                      console.warn('[claude-client] Failed to parse TodoWrite input:', e);
                    }
                  }

                  // 中文注释：功能名称「Agent工具检测」，用法是检测SDK runtime中的Agent/Team工具调用，
                  // 发射合成的subagent_start SSE事件，使子Agent卡片能实时显示并在会话切换后恢复
                  if (isSyntheticSubagentToolName(block.name)) {
                    try {
                      const agentInfo = getSyntheticSubagentInfo({
                        input: block.input,
                        omcPluginEnabled,
                      });
                      // 中文注释：功能名称「空智能体过滤」，用法是当Agent/Task工具调用没有prompt/task时，
                      // 不发射subagent_start事件，避免产生无任务的空智能体卡片
                      if (!agentInfo) {
                        console.warn('[claude-client] Skipping agentic tool_use with empty prompt:', block.id, block.name);
                      } else {
                        pendingAgentToolUse.set(block.id, agentInfo);
                        // 中文注释：压入agent栈，标记当前进入子Agent上下文，
                        // 后续子Agent发出的工具调用会被标记parentAgentId
                        agentStack.push(agentInfo.id);
                        controller.enqueue(formatSSE({
                          type: 'subagent_start',
                          data: JSON.stringify(agentInfo),
                        }));
                      }
                    } catch (e) {
                      console.warn('[claude-client] Failed to emit synthetic subagent_start:', e);
                    }
                  }

                  // 中文注释：功能名称「Bash工具终端镜像」，用法是检测SDK runtime中的Bash工具调用，
                  // 发射 terminal_mirror SSE事件，将命令和输出镜像到终端面板
                  const bashToolPattern = /^Bash$|^mcp__.*bash$/i;
                  if (bashToolPattern.test(block.name)) {
                    try {
                      const toolInput = block.input as { command?: string; cmd?: string };
                      const cmd = toolInput?.command || toolInput?.cmd || '';
                      console.log('[claude-client] Bash tool detected:', { id: block.id, name: block.name, cmd: cmd.slice(0, 100) });
                      if (cmd) {
                        pendingBashCommands.set(block.id, cmd);
                        controller.enqueue(formatSSE({
                          type: 'terminal_mirror',
                          data: JSON.stringify({ action: 'command', command: cmd }),
                        }));
                      }
                    } catch { /* best effort */ }
                  }

                  // 中文注释：功能名称「浏览器工具检测」，用法是检测SDK runtime中的浏览器工具调用，
                  // 发射 open-browser-panel SSE事件，通知前端打开内置浏览器面板
                  const browserToolNames = ['codepilot_open_browser', 'mcp__codepilot-browser__codepilot_open_browser'];
                  if (browserToolNames.includes(block.name)) {
                    try {
                      const toolInput = block.input as { url?: string; title?: string };
                      if (toolInput?.url) {
                        controller.enqueue(formatSSE({
                          type: 'open-browser-panel',
                          data: JSON.stringify({
                            url: toolInput.url,
                            title: toolInput.title || '网页预览',
                          }),
                        }));
                        console.log('[claude-client] Browser panel open requested:', toolInput.url);
                      }
                    } catch (e) {
                      console.warn('[claude-client] Failed to emit open-browser-panel:', e);
                    }
                  }

                  // Track file modifications for checkpointing (review feature)
                  const fileToolNames = ['EditFile', 'WriteFile', 'Edit', 'Write', 'Replace', 'str_replace_editor'];
                  if (fileToolNames.includes(block.name)) {
                    try {
                      const toolInput = block.input as { file_path?: string; path?: string };
                      const filePath = toolInput?.file_path || toolInput?.path;
                      if (filePath) {
                        pendingFileModifications.set(block.id, filePath);
                        // Record original file state IMMEDIATELY before the CLI executes the tool
                        if (enableFileCheckpointing && resolvedWorkingDirectory.path) {
                          try {
                            const relativePath = filePath.startsWith(resolvedWorkingDirectory.path)
                              ? filePath.slice(resolvedWorkingDirectory.path.length).replace(/^[/\\]/, '')
                              : filePath;
                            recordFileModification(sessionId, relativePath, resolvedWorkingDirectory.path);
                          } catch (e) {
                            console.warn('[claude-client] Failed to record file modification:', e);
                          }
                        }
                      }
                    } catch (e) {
                      console.warn('[claude-client] Failed to parse file modification input:', e);
                    }
                  }

                  // Collect file paths for context stats (broader than just file modification tools)
                  const inp = block.input as Record<string, unknown>;
                  if (inp) {
                    // Read tools
                    if (/^Read$|^ReadFile$|^read_file$|^read$|^ReadMultipleFiles$|^read_text_file$|^str_replace_editor$|^View$|^Open$/i.test(block.name)) {
                      if (inp.file_path && typeof inp.file_path === 'string') toolFilesAccumulator.add(inp.file_path);
                      if (inp.path && typeof inp.path === 'string') toolFilesAccumulator.add(inp.path);
                      if (inp.files && Array.isArray(inp.files)) {
                        (inp.files as string[]).forEach((f: string) => {
                          if (typeof f === 'string') toolFilesAccumulator.add(f);
                        });
                      }
                    }
                    // Glob/Search tools
                    else if (/^Glob$|^GlobFiles$|^search_files$|^find_files$|^Find$|^NotebookRead$/i.test(block.name)) {
                      if (inp.pattern && typeof inp.pattern === 'string') toolFilesAccumulator.add(inp.pattern);
                      if (inp.glob && typeof inp.glob === 'string') toolFilesAccumulator.add(inp.glob);
                      if (inp.path && typeof inp.path === 'string') toolFilesAccumulator.add(inp.path);
                    }
                    // Grep/Search tools
                    else if (/^Grep$|^SearchCodebase$|^search$|^grep$|^NotebookEdit$/i.test(block.name)) {
                      if (inp.pattern && typeof inp.pattern === 'string') toolFilesAccumulator.add(inp.pattern);
                      if (inp.query && typeof inp.query === 'string') toolFilesAccumulator.add(inp.query);
                      if (inp.path && typeof inp.path === 'string') toolFilesAccumulator.add(inp.path);
                    }
                    // Write/Edit tools
                    else if (/^Write$|^WriteFile$|^write_file$|^create_file$|^Edit$|^Patch$|^replace_in_file$|^EditFile$|^WriteEdit$/i.test(block.name)) {
                      if (inp.file_path && typeof inp.file_path === 'string') toolFilesAccumulator.add(inp.file_path);
                      if (inp.path && typeof inp.path === 'string') toolFilesAccumulator.add(inp.path);
                    }
                    // Web search tools
                    else if (/^WebSearch$|^web_search$|^search$|^Browse$|^Fetch$|^getUrl$|^get_url$|^mcp__MiniMax__web_search$|^mcp__bailian-web-search__bailian_web_search$/i.test(block.name)) {
                      // Extract URLs from search query / input
                      if (inp.query && typeof inp.query === 'string') {
                        const urlPattern = /https?:\/\/[^\s"')>\]]+/g;
                        let match;
                        while ((match = urlPattern.exec(inp.query)) !== null) {
                          toolFilesAccumulator.add(match[0]);
                        }
                      }
                      if (inp.url && typeof inp.url === 'string') toolFilesAccumulator.add(inp.url);
                    }
                  }
                }
              }
              // 中文注释：功能名称「SDK工具文件实时发射」，用法是每次工具调用后立即发射tool_files事件，
              // 使上下文统计在流式期间就能显示AI访问的文件和网页
              if (toolFilesAccumulator.size > 0) {
                const allToolFiles = Array.from(toolFilesAccumulator).filter((f): f is string => typeof f === 'string');
                controller.enqueue(formatSSE({
                  type: 'tool_files',
                  data: JSON.stringify({ files: allToolFiles }),
                }));
              }
              break;
            }

            case 'user': {
              // Tool execution results come back as user messages with tool_result blocks
              const userMsg = message as SDKUserMessage;
              const content = userMsg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    // 中文注释：工具已结束，移出无进度看门狗的跟踪表
                    toolProgressAt.delete(block.tool_use_id);
                    console.log('[claude-client] tool_result:', { id: block.tool_use_id, contentType: typeof block.content, isError: block.is_error });
                    if (block.is_error) sdkToolErrors++;
                    let resultContent = typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter((c: any): c is { type: 'text'; text: string } => c.type === 'text')
                            .map((c: any) => c.text)
                            .join('\n')
                        : String(block.content ?? '');

                    // Extract media blocks (image/audio) from MCP tool results.
                    // Two sources:
                    // 1. SDK content array: image/audio blocks with base64 data (external MCP servers)
                    // 2. MEDIA_RESULT_MARKER in text: localPath-based media from in-process MCP tools
                    //    (SDK strips image blocks from in-process tool results, so we use a text marker)
                    const mediaBlocks: MediaBlock[] = [];
                    if (Array.isArray(block.content)) {
                      for (const c of block.content) {
                        const cb = c as { type: string; data?: string; mimeType?: string; media_type?: string };
                        if ((cb.type === 'image' || cb.type === 'audio') && cb.data) {
                          mediaBlocks.push({
                            type: cb.type === 'audio' ? 'audio' : 'image',
                            data: cb.data,
                            mimeType: cb.mimeType || cb.media_type || (cb.type === 'image' ? 'image/png' : 'audio/wav'),
                          });
                        }
                      }
                    }
                    // Detect MEDIA_RESULT_MARKER in text result (from codepilot-image-gen MCP)
                    const MEDIA_MARKER = '__MEDIA_RESULT__';
                    const markerIdx = resultContent.indexOf(MEDIA_MARKER);
                    if (markerIdx >= 0) {
                      try {
                        const mediaJson = resultContent.slice(markerIdx + MEDIA_MARKER.length).trim();
                        const parsed = JSON.parse(mediaJson) as Array<{ type: string; mimeType: string; localPath: string; mediaId?: string }>;
                        for (const m of parsed) {
                          mediaBlocks.push({
                            type: (m.type as MediaBlock['type']) || 'image',
                            mimeType: m.mimeType,
                            localPath: m.localPath,
                            mediaId: m.mediaId,
                          });
                        }
                      } catch {
                        // Malformed marker payload — ignore
                      }
                      // Strip marker from content so it's not shown in the UI
                      resultContent = resultContent.slice(0, markerIdx).trim();
                    }

                    // 中文注释：查找此tool_result对应的parentAgentId（从tool_use时记录的映射中获取）
                    const resultParentAgentId = toolParentAgentMap.get(block.tool_use_id);
                    const ssePayload: Record<string, unknown> = {
                      tool_use_id: block.tool_use_id,
                      content: resultContent,
                      is_error: block.is_error || false,
                      ...(resultParentAgentId ? { parentAgentId: resultParentAgentId } : {}),
                    };
                    // 清理已完成的映射
                    if (resultParentAgentId) {
                      toolParentAgentMap.delete(block.tool_use_id);
                    }
                    console.log('[claude-client] tool_result payload:', { tool_use_id: block.tool_use_id, contentLength: resultContent?.length });
                    if (mediaBlocks.length > 0) {
                      ssePayload.media = mediaBlocks;
                    }
                    controller.enqueue(formatSSE({
                      type: 'tool_result',
                      data: JSON.stringify(ssePayload),
                    }));

                    // Extract web search URLs from tool result content for context stats
                    const urlPattern = /https?:\/\/[^\s"')>\]]+/g;
                    const urls = resultContent.match(urlPattern) || [];
                    urls.forEach(url => toolFilesAccumulator.add(url));
                    // 中文注释：功能名称「SDK URL实时发射」，用法是工具结果中的URL提取后立即发射tool_files事件
                    if (urls.length > 0) {
                      const allToolFiles = Array.from(toolFilesAccumulator).filter((f): f is string => typeof f === 'string');
                      controller.enqueue(formatSSE({
                        type: 'tool_files',
                        data: JSON.stringify({ files: allToolFiles }),
                      }));
                    }

                    // 中文注释：功能名称「Bash工具结果镜像」，用法是检测Bash工具的tool_result，
                    // 发射terminal_mirror事件，将命令输出和退出码镜像到终端面板
                    console.log('[claude-client] Checking pendingBashCommands for tool_use_id:', block.tool_use_id, 'has:', pendingBashCommands.has(block.tool_use_id));
                    if (pendingBashCommands.has(block.tool_use_id)) {
                      pendingBashCommands.delete(block.tool_use_id);
                      try {
                        if (resultContent) {
                          controller.enqueue(formatSSE({
                            type: 'terminal_mirror',
                            data: JSON.stringify({ action: 'output', output: resultContent + '\n' }),
                          }));
                        }
                        controller.enqueue(formatSSE({
                          type: 'terminal_mirror',
                          data: JSON.stringify({ action: 'exit', exitCode: block.is_error ? 1 : 0 }),
                        }));
                      } catch { /* best effort */ }
                    }

                    // 中文注释：功能名称「Agent工具完成检测」，用法是检测SDK runtime中Agent/Team工具的
                    // tool_result，发射合成的subagent_complete SSE事件，使子Agent卡片能正确显示完成状态。
                    // ⚠️ 后台Agent（run_in_background=true）的 tool_result 是"已派发"确认，不是真正完成。
                    // 真正的完成信号来自 task_notification/task_updated 系统消息。
                    // 如果这里直接发射 subagent_complete，后台Agent会在派发瞬间显示"已完成（0秒）"。
                    if (pendingAgentToolUse.has(block.tool_use_id)) {
                      const agentInfo = pendingAgentToolUse.get(block.tool_use_id)!;
                      // 中文注释：弹出agent栈，标记当前离开子Agent上下文（无论前台/后台都需要）
                      const stackIdx = agentStack.indexOf(agentInfo.id);
                      if (stackIdx >= 0) agentStack.splice(stackIdx, 1);

                      if (agentInfo.runInBackground && !block.is_error) {
                        // 后台Agent：tool_result 只是派发确认，保持 pending 状态等待 task_notification。
                        // 发射进度事件让用户知道任务已派发。
                        controller.enqueue(formatSSE({
                          type: 'subagent_progress',
                          data: JSON.stringify({
                            id: agentInfo.id,
                            detail: '任务已派发，后台运行中…\n',
                            append: true,
                          }),
                        }));
                        // 不从 pendingAgentToolUse 删除——留给 task_notification 处理完成
                      } else {
                        // 前台Agent或后台Agent出错：tool_result 就是最终结果
                        const reportText = resultContent.length > 500
                          ? resultContent.slice(0, 497) + '...'
                          : resultContent;
                        pendingAgentToolUse.delete(block.tool_use_id);
                        controller.enqueue(formatSSE({
                          type: 'subagent_complete',
                          data: JSON.stringify({
                            id: agentInfo.id,
                            report: block.is_error ? undefined : reportText,
                            error: block.is_error ? reportText : undefined,
                            source: agentInfo.source,
                          }),
                        }));
                      }
                    }

                                                            // Deferred TodoWrite sync: emit task_update after both success and error
                    // (UI should reflect the attempted state even if tool failed)
                    if (pendingTodoWrites.has(block.tool_use_id)) {
                      const todos = pendingTodoWrites.get(block.tool_use_id)!;
                      pendingTodoWrites.delete(block.tool_use_id);
                      controller.enqueue(formatSSE({
                        type: 'task_update',
                        data: JSON.stringify({
                          session_id: sessionId,
                          todos: todos.map((t, i) => ({
                            id: String(i),
                            content: t.content,
                            status: t.status,
                            activeForm: t.activeForm || '',
                          })),
                        }),
                      }));
                    }

                    // Clear pending modification since it completed
                    if (!block.is_error && pendingFileModifications.has(block.tool_use_id)) {
                      pendingFileModifications.delete(block.tool_use_id);
                    }
                  }
                }
              } else if (typeof content === 'string') {
                // 中文注释：字符串型 user 消息不是工具结果，正常用户输入也不会以 user 消息
                // 形式回流（只在本函数的入参里）。所以能走到这里的基本都是 SDK 注入的合成
                // 轮次，例如后台 Bash 任务结束时的 <task-notification>。
                const injected = sdkInjectedTurn.markUserMessage(content);
                if (injected) {
                  console.log('[claude-client] SDK injected user turn detected:', injected);
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      // 仅供观测/排障：标记 _internal，前端不会把它当成状态提示渲染
                      _internal: true,
                      subtype: 'internal_turn_start',
                      source: injected.source,
                      message: injected.summary,
                    }),
                  }));
                }
              }

              // Emit rewind_point for file checkpointing — only for prompt-level
              // user messages (parent_tool_use_id === null), and skip auto-trigger
              // turns which are invisible to the user (onboarding/check-in).
              // 注入轮次同样要跳过：它不是用户的输入点，不应产生回滚锚点。
              if (
                userMsg.parent_tool_use_id === null &&
                !autoTrigger &&
                !sdkInjectedTurn.isInjectedTurn &&
                userMsg.uuid
              ) {
                controller.enqueue(formatSSE({
                  type: 'rewind_point',
                  data: JSON.stringify({ userMessageId: userMsg.uuid }),
                }));
              }
              break;
            }

            case 'stream_event': {
              const streamEvent = message as SDKPartialAssistantMessage;
              const evt = streamEvent.event;
              if (evt.type === 'content_block_delta' && 'delta' in evt) {
                const delta = evt.delta;
                // 中文注释：子Agent上下文标记，将thinking/text事件标记parentAgentId，
                // 使客户端能将子Agent的思考内容路由到子Agent卡片而非主时间线
                const streamParentId = agentStack.length > 0 ? agentStack[agentStack.length - 1] : undefined;
                if ('text' in delta && delta.text) {
                  controller.enqueue(formatSSE({ type: 'text', data: delta.text, ...(streamParentId ? { parentAgentId: streamParentId } : {}) }));
                }
                if ('thinking' in delta && (delta as { thinking?: string }).thinking) {
                  controller.enqueue(formatSSE({ type: 'thinking', data: (delta as { thinking: string }).thinking, ...(streamParentId ? { parentAgentId: streamParentId } : {}) }));
                }
              }
              break;
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage;
              if ('subtype' in sysMsg) {
                if (sysMsg.subtype === 'init') {
                  const initMsg = sysMsg as SDKSystemMessage & {
                    slash_commands?: unknown;
                    skills?: unknown;
                    agents?: unknown;
                    plugins?: Array<{ name: string; path: string }>;
                    mcp_servers?: unknown;
                    output_style?: string;
                  };
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      session_id: sysMsg.session_id,
                      model: sysMsg.model,
                      requested_model: model,
                      tools: sysMsg.tools,
                      slash_commands: initMsg.slash_commands,
                      skills: initMsg.skills,
                      agents: initMsg.agents,
                      plugins: initMsg.plugins,
                      mcp_servers: initMsg.mcp_servers,
                      output_style: initMsg.output_style,
                      instruction_sources: instructionSources,
                    }),
                  }));

                  // Cache loaded plugins from init meta for cross-reference in skills route.
                  // Always set — including empty array — so stale data from a previous
                  // session that had plugins doesn't leak into a session without plugins.
                  // capProviderId is defined at line 786 in the same scope.
                  setCachedPlugins(capProviderId, Array.isArray(initMsg.plugins) ? initMsg.plugins : []);
                } else if (sysMsg.subtype === 'api_retry' || sysMsg.subtype === 'api_error') {
                  const retryMsg = sysMsg as SDKSystemMessage & {
                    attempt?: number;
                    max_retries?: number;
                    error?: string;
                    error_status?: number | null;
                  };
                  const attemptLabel = retryMsg.attempt ? `（第 ${retryMsg.attempt} 次）` : '';
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      subtype: 'upstream_retry',
                      attempt: retryMsg.attempt,
                      maxRetries: retryMsg.max_retries,
                      notification: true,
                      message: `模型上游连接中断，正在重试${attemptLabel}`,
                      detail: retryMsg.error || undefined,
                    }),
                  }));
                } else if (sysMsg.subtype === 'compact_boundary') {
                  const compactMsg = sysMsg as SDKSystemMessage & {
                    compact_metadata?: { trigger?: 'manual' | 'auto'; pre_tokens?: number; post_tokens?: number; duration_ms?: number };
                  };
                  // CLI's compact boundary is the authoritative completion
                  // signal. It keeps the same user conversation alive.
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      subtype: 'context_compressed',
                      source: 'cli',
                      trigger: compactMsg.compact_metadata?.trigger || 'auto',
                      message: 'CLI 已完成上下文整理，当前会话继续执行',
                      stats: { messagesCompressed: 0, tokensSaved: 0 },
                      compact: compactMsg.compact_metadata,
                    }),
                  }));
                } else if (sysMsg.subtype === 'status') {
                  // SDK sends status messages when permission mode changes (e.g. ExitPlanMode)
                  const statusMsg = sysMsg as SDKSystemMessage & { permissionMode?: string };
                  if (statusMsg.permissionMode) {
                    controller.enqueue(formatSSE({
                      type: 'mode_changed',
                      data: statusMsg.permissionMode,
                    }));
                  }
                } else if (sysMsg.subtype === 'task_started') {
                  const taskStarted = sysMsg as SDKSystemMessage & {
                    task_id: string;
                    tool_use_id?: string;
                    description?: string;
                  };
                  const pending = resolvePendingSubagent(taskStarted.tool_use_id, taskStarted.task_id);
                  if (pending) {
                    const [toolUseId, agentInfo] = pending;
                    agentInfo.taskId = taskStarted.task_id;
                    pendingAgentToolUse.set(toolUseId, agentInfo);
                    controller.enqueue(formatSSE({
                      type: 'subagent_progress',
                      data: JSON.stringify({
                        id: agentInfo.id,
                        detail: `${taskStarted.description || 'Task started'}\n`,
                        append: true,
                      }),
                    }));
                  }
                } else if (sysMsg.subtype === 'task_progress') {
                  const taskProgress = sysMsg as SDKSystemMessage & {
                    task_id: string;
                    tool_use_id?: string;
                    description?: string;
                    summary?: string;
                    last_tool_name?: string;
                  };
                  const pending = resolvePendingSubagent(taskProgress.tool_use_id, taskProgress.task_id);
                  if (pending) {
                    const [, agentInfo] = pending;
                    const detail = taskProgress.summary || taskProgress.description || taskProgress.last_tool_name;
                    if (detail) {
                      controller.enqueue(formatSSE({
                        type: 'subagent_progress',
                        data: JSON.stringify({
                          id: agentInfo.id,
                          detail: `${detail}\n`,
                          append: true,
                        }),
                      }));
                    }
                  }
                } else if (sysMsg.subtype === 'task_updated') {
                  const taskUpdated = sysMsg as SDKSystemMessage & {
                    task_id: string;
                    patch?: { status?: string; error?: string };
                  };
                  const pending = resolvePendingSubagent(undefined, taskUpdated.task_id);
                  if (pending && (taskUpdated.patch?.status === 'failed' || taskUpdated.patch?.status === 'killed')) {
                    const [toolUseId, agentInfo] = pending;
                    pendingAgentToolUse.delete(toolUseId);
                    controller.enqueue(formatSSE({
                      type: 'subagent_complete',
                      data: JSON.stringify({
                        id: agentInfo.id,
                        error: taskUpdated.patch?.error || `Task ${taskUpdated.patch?.status}`,
                        source: agentInfo.source,
                      }),
                    }));
                    // A failed/killed child must remain a failed task if its
                    // parent summary never arrives; only successful children
                    // may use the graceful-finalization fallback below.
                  }
                } else if (sysMsg.subtype === 'task_notification') {
                  // Agent task completed/failed/stopped — surface as notification
                  const taskMsg = sysMsg as SDKSystemMessage & {
                    status: string; summary: string; task_id: string; tool_use_id?: string;
                  };
                  const pending = resolvePendingSubagent(taskMsg.tool_use_id, taskMsg.task_id);
                  if (pending) {
                    const [toolUseId, agentInfo] = pending;
                    pendingAgentToolUse.delete(toolUseId);
                    const summary = (taskMsg.summary || '').slice(0, 500);
                    controller.enqueue(formatSSE({
                      type: 'subagent_complete',
                      data: JSON.stringify({
                        id: agentInfo.id,
                        report: taskMsg.status === 'completed' ? summary : undefined,
                        error: taskMsg.status === 'completed' ? undefined : (summary || `Task ${taskMsg.status}`),
                        source: agentInfo.source,
                      }),
                    }));
                    // 中文注释：最后一个后台子 Agent 结束——下一个注入轮就是最终汇总轮，
                    // 放行它的输出作为「全部完成后的统一回复」
                    if (shouldGracefullyFinalizeBackgroundTask(taskMsg.status, pendingAgentToolUse.size)) {
                      sdkInjectedTurn.forwardFinalTurn = true;
                      scheduleBackgroundFinalization();
                    }
                  }
                  const title = taskMsg.status === 'completed' ? 'Task completed' : `Task ${taskMsg.status}`;
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      notification: true,
                      title,
                      message: taskMsg.summary || '',
                    }),
                  }));
                  if (!autoTrigger) {
                    notifyGeneric(title, taskMsg.summary || '', telegramOpts).catch(() => {});
                  }
                } else if (
                  sysMsg.subtype === 'hook_started' ||
                  sysMsg.subtype === 'hook_progress' ||
                  sysMsg.subtype === 'hook_response' ||
                  sysMsg.subtype === 'hook_additional_context'
                ) {
                  const hookMsg = sysMsg as SDKSystemMessage & {
                    hook_name?: string;
                    hook_event_name?: string;
                    status?: string;
                    additional_context?: string;
                    content?: string[] | string;
                    decision?: string;
                  };
                  const additionalContext = hookMsg.additional_context
                    || (Array.isArray(hookMsg.content)
                      ? hookMsg.content.join('\n\n')
                      : hookMsg.content);
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      _internal: true,
                      hook_event: sysMsg.subtype,
                      hook_name: hookMsg.hook_name,
                      hook_event_name: hookMsg.hook_event_name,
                      status: hookMsg.status,
                      additional_context: additionalContext,
                      decision: hookMsg.decision,
                    }),
                  }));
                }
              }
              break;
            }

            case 'tool_progress': {
              const progressMsg = message as SDKToolProgressMessage;
              controller.enqueue(formatSSE({
                type: 'tool_output',
                data: JSON.stringify({
                  _progress: true,
                  tool_use_id: progressMsg.tool_use_id,
                  tool_name: progressMsg.tool_name,
                  elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                }),
              }));
              if (pendingAgentToolUse.has(progressMsg.tool_use_id) && isSyntheticSubagentToolName(progressMsg.tool_name)) {
                const agentInfo = pendingAgentToolUse.get(progressMsg.tool_use_id)!;
                controller.enqueue(formatSSE({
                  type: 'subagent_progress',
                  data: JSON.stringify({
                    id: agentInfo.id,
                    detail: `${progressMsg.tool_name} running for ${Math.round(progressMsg.elapsed_time_seconds)}s\n`,
                    append: true,
                  }),
                }));
              }
              // 中文注释：记录最近一次进度时间 —— 由无进度看门狗统一判定是否卡死
              // （不再按工具总运行时长误杀长任务）。
              toolProgressAt.set(progressMsg.tool_use_id, { name: progressMsg.tool_name, at: Date.now() });
              break;
            }

            case 'result': {
              const resultMsg = message as SDKResultMessage;
              // 中文注释：内部轮次的 result 只用于关闭抑制标记，不向上游透传——
              // 否则下游会把这一轮的 usage / 耗时 / session_id 当成用户这一轮的结果。
              const turnTransition = sdkInjectedTurn.onResult();
              if (turnTransition === 'internal_end') {
                console.log('[claude-client] SDK injected turn finished, resuming normal relay');
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ _internal: true, subtype: 'internal_turn_end' }),
                }));
                break;
              }
              if (turnTransition === 'suppressed_start') {
                console.log('[claude-client] SDK injected turn pending from earlier, suppressing its reply');
              }
              // A parent turn's first SDK result is only an internal boundary
              // while background Agents or their injected final summary are
              // still pending.  Do not publish it: consumers treat `result`
              // as task completion, which previously closed the UI while the
              // child was still running.
              if (!isFinalUserTurnResult(
                turnTransition,
                pendingAgentToolUse.size,
                sdkInjectedTurn.hasPendingFinalSummary,
              )) {
                break;
              }
              tokenUsage = extractTokenUsage(resultMsg, resultMsg.duration_ms, lastAssistantUsage);
              // terminal_reason is an optional field added in SDK 0.2.111.
              // When present, it enriches the end-of-turn UI chip (Phase 1 of
              // agent-sdk-0-2-111-adoption) without replacing error-classifier.
              const terminalReason = (resultMsg as SDKResultMessage & { terminal_reason?: string }).terminal_reason;
              const resultErrors = resultMsg.is_error
                ? ('errors' in resultMsg && resultMsg.errors.length ? resultMsg.errors : [assistantErrorMessage || `模型服务返回错误：${resultMsg.subtype}`])
                : [];
              if (resultMsg.is_error && !abortController?.signal.aborted) {
                controller.enqueue(formatSSE({ type: 'error', data: resultErrors.join('\n') }));
              }
              controller.enqueue(formatSSE({
                type: 'result',
                data: JSON.stringify({
                  subtype: resultMsg.subtype,
                  is_error: resultMsg.is_error,
                  num_turns: resultMsg.num_turns,
                  duration_ms: resultMsg.duration_ms,
                  usage: tokenUsage,
                  session_id: resultMsg.session_id,
                  ...(resultMsg.is_error ? { errors: resultErrors, terminal_reason: 'error' } : terminalReason ? { terminal_reason: terminalReason } : {}),
                }),
              }));
              // Notify on conversation-level errors (e.g. rate limit, auth failure)
              if (resultMsg.is_error) {
                const errTitle = 'Conversation error';
                const errMsg = resultErrors.join('\n');
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ notification: true, title: errTitle, message: errMsg }),
                }));
                // Skip Telegram for auto-trigger turns (onboarding/heartbeat)
                if (!autoTrigger) {
                  notifyGeneric(errTitle, errMsg, telegramOpts).catch(() => {});
                }
              }

              // Phase 5 — context-usage snapshot via Query.getContextUsage()
              // is intentionally NOT called here.
              //
              // getContextUsage() is a SDK control-API request that shares
              // the same message channel as the for-await-of iterator we're
              // inside. Awaiting it blocks the iterator from advancing,
              // which prevents the control-response frame from arriving —
              // the Query then closes on result and the call errors out
              // with "Query closed before response received". There's no
              // stable place outside the iteration loop where the Query
              // is still alive.
              //
              // The chat-page indicator doesn't suffer from this: it
              // already computes used-tokens from the SDKResultMessage's
              // own `usage` field (input + cache_read + cache_creation),
              // which is SDK-authoritative and carries <5% drift against
              // what getContextUsage would report. The snapshot would
              // only add category-level breakdown (system prompt / tools
              // / user / memory) that the current UI doesn't surface.
              //
              // The SSE 'context_usage' event type and stream-session-
              // manager snapshot field stay in place as extension points
              // — a future Phase that needs category breakdown can fire
              // them from a different point in the SDK lifecycle (e.g.
              // from a background control-channel timer, or from a
              // lifecycle hook the SDK may expose later).
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const _unusedControlQuery = controlQuery;

              // The SDK result is the authoritative completion signal only
              // after the final-summary guard above.  A persistent Query can
              // remain iterable afterwards, so stop here instead of waiting
              // for iterator EOF and risking the 600s stall watchdog.
              clearBackgroundFinalizationTimer();
              receivedTerminalResult = true;
              break streamMessages;
            }

            default: {
              const mType = (message as { type: string }).type;
              if (mType === 'keep_alive') {
                controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
              } else if (mType === 'rate_limit_event') {
                // SDK 0.2.111+ — subscription rate limit telemetry. SDK
                // only emits these for claude.ai subscription paths, so
                // API-key / third-party provider sessions won't see this
                // branch. Forward verbatim so the UI can render a
                // warning banner (allowed_warning) or a closable recovery
                // panel (rejected) per Phase 2 of agent-sdk-0-2-111.
                const rlEvent = message as {
                  type: 'rate_limit_event';
                  rate_limit_info: {
                    status: 'allowed' | 'allowed_warning' | 'rejected';
                    resetsAt?: number;
                    rateLimitType?: string;
                    utilization?: number;
                    overageStatus?: string;
                    overageResetsAt?: number;
                    overageDisabledReason?: string;
                    isUsingOverage?: boolean;
                  };
                  session_id: string;
                };
                controller.enqueue(formatSSE({
                  type: 'rate_limit',
                  data: JSON.stringify(rlEvent.rate_limit_info),
                }));
              }
              break;
            }
          }
        }

        if (!receivedTerminalResult && !backgroundFinalizationExpired) {
          // A user stop aborts the HTTP request's controller. The SDK then
          // ends its iterator without a terminal result, which must not be
          // mistaken for a provider-side interruption.
          if (abortController?.signal.aborted) {
            controller.enqueue(formatSSE({
              type: 'aborted',
              data: JSON.stringify({
                reason: 'user_cancel',
                message: '任务已由用户手动中断。',
              }),
            }));
            controller.close();
            return;
          }
          // Do not translate a result-less EOF into a successful `done`.
          // This is the exact failure mode that previously produced a green
          // “任务完成” after a provider/CLI connection had been interrupted.
          const message = '模型上游中断，任务未完成；请重新发送消息继续。';
          console.warn('[claude-client] SDK iterator ended without result for session', sessionId);
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({ subtype: 'upstream_interrupted', notification: true, message }),
          }));
          controller.enqueue(formatSSE({
            type: 'aborted',
            data: JSON.stringify({ reason: 'upstream_interrupted', message }),
          }));
          if (persistentQueryForStream) {
            closePersistentClaudeSession(sessionId, persistentQueryForStream);
          }
          try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          controller.close();
          return;
        }

        // Emit accumulated file paths and web URLs for context stats
        const allToolFiles = Array.from(toolFilesAccumulator).filter((f): f is string => typeof f === 'string');
        if (allToolFiles.length > 0) {
          controller.enqueue(formatSSE({
            type: 'tool_files',
            data: JSON.stringify({ files: allToolFiles }),
          }));
        }

        // 中文注释：功能名称「SDK 自动技能提炼」，用法是让 Claude Code SDK 主路径在
        // 复杂多步工具工作流后，也像 native runtime 一样触发 skill_nudge 与自动保存技能，
        // 避免 self-improvement 仅在 native 链路生效。
        // Three-layer knowledge evolution for SDK path (mirrors agent-loop.ts)
        if (resolvedWorkingDirectory.path) {
          // 中文注释：知识库进化管线（Layer 1 学习提取 / Layer 3 技能提炼）会调用 LLM，
          // 耗时可达数秒到数十秒。若在关闭 SSE 之前 await 它，前端会一直停留在
          // phase='active'，表现为“回答已经输出完、任务却卡着不结束、状态还是生成中”。
          // 改为后台 fire-and-forget 执行，让主流程立即关闭流。
          void (async () => {
          try {
            const runStats = {
              step: sdkToolUseCount,
              distinctTools: sdkDistinctTools,
              hasErrors: sdkToolErrors > 0,
              toolNames: sdkAllToolNames,
            };

            const decision = decideNudge(runStats);

            if (decision.recordLearning) {
              console.log(`[knowledge/SDK] Layer 1 triggered: ${decision.reason}`);

              const { generateTextFromProvider } = await import('./text-generator');
              const { resolveProvider } = await import('./provider-resolver');
              const activeResolved = resolveProvider({ sessionProviderId: options.providerId || options.sessionProviderId, sessionModel: model });

              if (activeResolved.hasCredentials) {
                const recentHistory = (conversationHistory || [])
                  .slice(-20)
                  .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
                  .join('\n\n');

                try {
                  const extractionPrompt = buildLearningExtractionPrompt(runStats);
                  const result = await generateTextFromProvider({
                    providerId: activeResolved.provider?.id || '',
                    model: activeResolved.upstreamModel || activeResolved.model || 'haiku',
                    system: extractionPrompt,
                    prompt: `用户请求：\n${prompt}\n\n最近聊天记录：\n${recentHistory}`,
                    maxTokens: 1500,
                  });

                  const rawJson = result.replace(/^```json/i, '').replace(/```$/i, '').trim();
                  const learningDef = JSON.parse(rawJson);

                  if (learningDef.category && learningDef.patternKey && learningDef.summary) {
                    const { recordLearning } = await import('./learning-store');
                    const learning = recordLearning(resolvedWorkingDirectory.path, {
                      category: learningDef.category,
                      priority: learningDef.priority || 'medium',
                      area: learningDef.area || 'general',
                      patternKey: learningDef.patternKey,
                      summary: learningDef.summary,
                      details: learningDef.details || '',
                      suggestedAction: learningDef.suggestedAction || '',
                    });
                    console.log(`[knowledge/SDK] Layer 1 recorded: ${learning.id} (${learning.patternKey}, count=${learning.recurrenceCount})`);

                    if (decision.evaluatePatterns) {
                      const { evaluatePromotions } = await import('./pattern-tracker');
                      const promotions = evaluatePromotions(resolvedWorkingDirectory.path);

                      for (const promo of promotions) {
                        if (promo.shouldPromote) {
                          console.log(`[knowledge/SDK] Layer 2 promotion ready: ${promo.pattern.patternKey}`);

                          const crystallizePrompt = buildCrystallizationPrompt(promo.pattern, recentHistory);
                          try {
                            const skillResult = await generateTextFromProvider({
                              providerId: activeResolved.provider?.id || '',
                              model: activeResolved.upstreamModel || activeResolved.model || 'haiku',
                              system: crystallizePrompt,
                              prompt: `基于上述模式，生成完整的 Skill 定义。`,
                              maxTokens: 2000,
                            });

                            const skillJson = skillResult.replace(/^```json/i, '').replace(/```$/i, '').trim();
                            const skillDef = JSON.parse(skillJson);

                            if (skillDef.name && skillDef.content) {
                              const { createSkillCreateTool } = await import('./builtin-tools/skill-create');
                              const tool = createSkillCreateTool(resolvedWorkingDirectory.path);
                              await tool.execute!(
                                { ...skillDef, patternKey: promo.pattern.patternKey },
                                { toolCallId: 'sdk-auto-skill', messages: [] }
                              );
                              console.log(`[knowledge/SDK] Layer 3 crystallized: ${skillDef.name}`);

                              // 中文注释：管线已改为后台执行，SSE 流此时可能已关闭；跳过已关闭控制器的写入。
                              if (!controller.closed) {
                                controller.enqueue(formatSSE({
                                  type: 'status',
                                  data: JSON.stringify({
                                    notification: true,
                                    message: `模式 "${promo.pattern.patternKey}" 经过 ${promo.pattern.recurrenceCount} 次复现已提炼为技能：${skillDef.name}`,
                                    subtype: 'skill_nudge',
                                  }),
                                }));
                              }
                            }
                          } catch (crystErr) {
                            console.error('[knowledge/SDK] Layer 3 crystallization failed:', crystErr);
                          }
                        }
                      }
                    }
                  }
                } catch (extractErr) {
                  console.error('[knowledge/SDK] Layer 1 extraction failed:', extractErr);
                }
              }
            }
          } catch (err) {
            console.error('[knowledge/SDK] Evolution pipeline failed:', err);
          }
          })();
        }

        // 中文注释：等待后台子 Agent 期间主动发 keep_alive，防止客户端
        // 5.5 分钟空闲看门狗把这条还活着的流误杀。
        if (agentWaitKeepAliveTimer) clearInterval(agentWaitKeepAliveTimer);
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        if (agentWaitKeepAliveTimer) clearInterval(agentWaitKeepAliveTimer);
        // `conversation.interrupt()` commonly rejects the SDK iterator with a
        // generic error instead of yielding an abort frame.  The browser has
        // already marked this request as user-cancelled; do not run it through
        // error classification or persist a second “task failed” terminal.
        const watchdogAborted = streamWatchdogFired || toolWatchdogFired || backgroundFinalizationExpired;
        if (abortController?.signal.aborted && !watchdogAborted) {
          if (usingPersistentSession && persistentQueryForStream) {
            closePersistentClaudeSession(sessionId, persistentQueryForStream);
          }
          controller.enqueue(formatSSE({
            type: 'aborted',
            data: JSON.stringify({ reason: 'user_cancel', message: '任务已由用户手动中断。' }),
          }));
          controller.close();
          return;
        }
        // 中文注释：功能名称「错误分类关闭策略」，用法是区分可恢复错误和不可恢复错误，
        // 决定是否关闭 persistent session。
        // 可恢复错误（MCP 工具调用失败、rate limit、网络超时等）：
        //   persistent session 仍然可用，下一轮消息可以复用，不需要冷启动。
        // 不可恢复错误（认证失败、配置错误、SDK 进程崩溃等）：
        //   persistent session 不可用，必须关闭并重新创建。
        const rawMessage = error instanceof Error ? error.message : 'Unknown error';
        const stderrContent = error instanceof Error ? (error as { stderr?: string }).stderr : undefined;
        const networkErrorCode = (error instanceof Error) ? (error as NodeJS.ErrnoException).code : undefined;
        const isRecoverableError = /rate.?limit|429|529|overloaded/i.test(rawMessage)
          || /timeout|ETIMEDOUT/i.test(rawMessage)
          || /ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(rawMessage)
          || /MCP.*error|mcp.*fail|mcp.*crash/i.test(rawMessage)
          || /tool.*fail|tool.*error|tool.*timeout/i.test(rawMessage)
          || /server.*error|server.*fail|server.*crash/i.test(rawMessage)
          || networkErrorCode === 'ECONNRESET'
          || networkErrorCode === 'ETIMEDOUT'
          || networkErrorCode === 'ECONNREFUSED';

        if (usingPersistentSession) {
          // A thrown stream error has no authoritative terminal result.  Even
          // a recoverable upstream error can leave unread SDK frames behind,
          // so reusing this iterator risks replying to the next message with
          // the old turn's output.
          console.log('[claude-client] Stream ended without a terminal result; discarding persistent session:', rawMessage.slice(0, 100));
          if (persistentQueryForStream) {
            closePersistentClaudeSession(sessionId, persistentQueryForStream);
          }
        }
        console.error('[claude-client] Stream error:', {
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
          stderr: stderrContent,
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
        });

        // Look up preset meta for recovery action URLs
        const presetForMeta = resolved.provider?.base_url
          ? (await import('./provider-catalog')).findPresetForLegacy(resolved.provider.base_url, resolved.provider.provider_type, resolved.protocol)
          : undefined;

        // Classify the error using structured pattern matching
        const classified = classifyError({
          error,
          stderr: stderrContent,
          providerName: resolved.provider?.name,
          baseUrl: resolved.provider?.base_url,
          hasImages: files && files.some(f => isImageFile(f.type)),
          thinkingEnabled: !!thinking,
          context1mEnabled: !!context1m,
          effortSet: !!effort,
          providerMeta: presetForMeta?.meta ? {
            apiKeyUrl: presetForMeta.meta.apiKeyUrl,
            docsUrl: presetForMeta.meta.docsUrl,
            pricingUrl: presetForMeta.meta.pricingUrl,
          } : undefined,
        });

        // ── Reactive compact: auto-compress and retry on CONTEXT_TOO_LONG ──
        if (classified.category === 'CONTEXT_TOO_LONG' && !ptlRetryAttempted && conversationHistory && conversationHistory.length > 4) {
          ptlRetryAttempted = true;
          try {
            console.log('[claude-client] CONTEXT_TOO_LONG detected — attempting auto-compress + retry');
            controller.enqueue(formatSSE({ type: 'status', data: JSON.stringify({ notification: true, message: 'context_compressing_retry' }) }));

            const { compressConversation, resolveReactiveCompactBoundaryRowid } = await import('./context-compressor');
            const { updateSessionSummary: updateSummary, getSessionSummary } = await import('@/lib/db');
            const compResult = await compressConversation({
              sessionId,
              messages: conversationHistory,
              existingSummary: options.sessionSummary,
              providerId: options.providerId || options.sessionProviderId,
              sessionModel: model,
            });
            // Derive boundary from rowids plumbed through conversationHistory.
            // Invariant: reactive compact here hands the WHOLE
            // conversationHistory to compressConversation — no keep/compress
            // split — so the last row with a known _rowid is exactly the
            // last DB row this summary covers.
            //
            // Fallback (no _rowid in history): use Math.max of the DB's
            // CURRENT boundary and the caller's hint. Re-reading DB here
            // matters because an auto pre-compression earlier in the same
            // request may have already advanced the boundary past what
            // options.sessionSummaryBoundaryRowid captured (that value was
            // snapshotted in chat/route.ts before auto pre-compression ran).
            // Without the re-read, a degraded reactive compact could
            // silently roll the DB boundary back to a stale value.
            const existingBoundary = Math.max(
              getSessionSummary(sessionId).boundaryRowid,
              options.sessionSummaryBoundaryRowid ?? 0,
            );
            const reactiveBoundaryRowid = resolveReactiveCompactBoundaryRowid({
              history: conversationHistory,
              existingBoundaryRowid: existingBoundary,
            });
            updateSummary(sessionId, compResult.summary, reactiveBoundaryRowid);
            options.sessionSummary = compResult.summary;
            // Recalculate fallback budget with new summary size
            const newSummaryTokens = roughTokenEstimate(compResult.summary);
            const promptTokens = roughTokenEstimate(prompt);
            const systemTokens = roughTokenEstimate(systemPrompt || '');
            // Use a conservative 50% of actual context window for retry
            const { getContextWindow } = await import('./model-context');
            const ctxWindow = getContextWindow(model || 'sonnet', { context1m: !!context1m }) || 200000;
            const retryBudget = Math.max(10000, Math.floor(ctxWindow * 0.5 - systemTokens - newSummaryTokens - promptTokens));
            console.log(`[claude-client] Compressed ${compResult.messagesCompressed} messages for PTL retry, budget=${retryBudget}`);

            // Clear stale session so retry starts fresh
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }

            // Build retry prompt using compressed context with recalculated budget
            const retryPrompt = buildFallbackContext({
              prompt,
              history: conversationHistory,
              sessionSummary: options.sessionSummary,
              tokenBudget: retryBudget,
            });

            // Rebuild minimal query options from closure variables
            // (queryOptions is scoped to the try block and not accessible here)
            const retryOptions: Options = {
              cwd: options.workingDirectory || os.homedir(),
              abortController,
              permissionMode: 'bypassPermissions' as Options['permissionMode'],
              allowDangerouslySkipPermissions: true,
              env: { ...process.env as Record<string, string> },
              maxTurns: undefined,
            };
            if (model) retryOptions.model = model;
            if (systemPrompt) {
              retryOptions.systemPrompt = { type: 'preset', preset: 'claude_code', append: systemPrompt };
            }

            const retryConversation = query({ prompt: retryPrompt, options: retryOptions });

            // Forward retry stream events (simplified — covers the critical path)
            // 中文注释：重试路径也需要agent栈追踪，用于标记子Agent的工具调用
            const retryAgentStack: string[] = [];
            // 中文注释：与主路径同理，留存最后一条主线程 assistant 帧的真实单次请求用量
            let retryLastAssistantUsage: AssistantRequestUsage | null = null;
            for await (const msg of retryConversation) {
              // 中文注释：重试循环同样刷新全流看门狗的活动时间戳
              lastStreamActivityAt = Date.now();
              if (abortController?.signal.aborted) break;
              switch (msg.type) {
                case 'system': {
                  // Forward init event so the chat route persists the NEW
                  // sdk_session_id. Without this, the session row keeps an
                  // empty sdk_session_id (cleared above at line ~1619) and the
                  // next user message goes back through buildFallbackContext,
                  // re-exposing prior-tool-call history to the model.
                  const sysMsg = msg as SDKSystemMessage;
                  if ('subtype' in sysMsg && sysMsg.subtype === 'init') {
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({
                        session_id: sysMsg.session_id,
                        model: sysMsg.model,
                        requested_model: model,
                        tools: sysMsg.tools,
                      }),
                    }));
                  }
                  break;
                }
                case 'assistant': {
                  // Text deltas are forwarded via stream_event below; here we
                  // only emit tool_use blocks (matches main path at L1213).
                  const aMsg = msg as SDKAssistantMessage;
                  if (!aMsg.parent_tool_use_id && aMsg.error) {
                    assistantErrorMessage = extractTextFromMessage(aMsg).trim() || aMsg.error;
                  }
                  if (!aMsg.parent_tool_use_id && aMsg.message.usage) {
                    retryLastAssistantUsage = aMsg.message.usage;
                  }
                  for (const block of aMsg.message.content) {
                    if (block.type === 'tool_use') {
                      // 中文注释：重试路径的agent栈追踪
                      if (isSyntheticSubagentToolName(block.name)) {
                        retryAgentStack.push(block.id);
                      }
                      const retryParentId = retryAgentStack.length > 0 ? retryAgentStack[retryAgentStack.length - 1] : undefined;
                      controller.enqueue(formatSSE({ type: 'tool_use', data: JSON.stringify({ id: block.id, name: block.name, input: block.input, ...(retryParentId ? { parentAgentId: retryParentId } : {}) }) }));
                      // 中文注释：功能名称「恢复路径浏览器检测」，用法是在SDK session恢复路径中
                      // 也检测浏览器工具调用，确保压缩重试后浏览器仍能正确打开
                      const browserToolNames = ['codepilot_open_browser', 'mcp__codepilot-browser__codepilot_open_browser'];
                      if (browserToolNames.includes(block.name)) {
                        try {
                          const toolInput = block.input as { url?: string; title?: string };
                          if (toolInput?.url) {
                            controller.enqueue(formatSSE({
                              type: 'open-browser-panel',
                              data: JSON.stringify({ url: toolInput.url, title: toolInput.title || '网页预览' }),
                            }));
                          }
                        } catch { /* best effort */ }
                      }
                    }
                  }
                  break;
                }
                case 'user': {
                  const uMsg = msg as { type: 'user'; message: { content: Array<{ type: string; content?: string | Array<Record<string, unknown>>; tool_use_id?: string; is_error?: boolean }> } };
                  for (const block of uMsg.message.content) {
                    if (block.type === 'tool_result') {
                      // 中文注释：重试路径的agent栈弹出
                      const retryStackIdx = retryAgentStack.indexOf(block.tool_use_id!);
                      if (retryStackIdx >= 0) retryAgentStack.splice(retryStackIdx, 1);
                      const retryMedia: MediaBlock[] = [];
                      let retryContent = '';

                      if (Array.isArray(block.content)) {
                        // Array-form tool result (external MCP): extract text + image/audio blocks
                        const textParts: string[] = [];
                        for (const c of block.content) {
                          const cb = c as { type: string; text?: string; data?: string; mimeType?: string; media_type?: string };
                          if (cb.type === 'text' && cb.text) {
                            textParts.push(cb.text);
                          } else if ((cb.type === 'image' || cb.type === 'audio') && cb.data) {
                            retryMedia.push({
                              type: cb.type === 'audio' ? 'audio' : 'image',
                              data: cb.data,
                              mimeType: cb.mimeType || cb.media_type || (cb.type === 'image' ? 'image/png' : 'audio/wav'),
                            });
                          }
                        }
                        retryContent = textParts.join('\n').slice(0, 2000);
                      } else if (typeof block.content === 'string') {
                        retryContent = block.content.slice(0, 2000);
                      }

                      // Extract __MEDIA_RESULT__ markers from text content
                      const RETRY_MEDIA_MARKER = '__MEDIA_RESULT__';
                      const retryMarkerIdx = retryContent.indexOf(RETRY_MEDIA_MARKER);
                      if (retryMarkerIdx >= 0) {
                        try {
                          const mediaJson = retryContent.slice(retryMarkerIdx + RETRY_MEDIA_MARKER.length).trim();
                          const parsed = JSON.parse(mediaJson) as Array<{ type: string; mimeType: string; localPath: string; mediaId?: string }>;
                          for (const m of parsed) {
                            retryMedia.push({
                              type: (m.type as MediaBlock['type']) || 'image',
                              mimeType: m.mimeType,
                              localPath: m.localPath,
                              mediaId: m.mediaId,
                            });
                          }
                        } catch { /* malformed marker */ }
                        retryContent = retryContent.slice(0, retryMarkerIdx).trim();
                      }

                      const retryResultParentId = retryAgentStack.length > 0 ? retryAgentStack[retryAgentStack.length - 1] : undefined;
                      controller.enqueue(formatSSE({ type: 'tool_result', data: JSON.stringify({
                        tool_use_id: block.tool_use_id,
                        content: retryContent,
                        ...(block.is_error ? { is_error: true } : {}),
                        ...(retryMedia.length > 0 ? { media: retryMedia } : {}),
                        ...(retryResultParentId ? { parentAgentId: retryResultParentId } : {}),
                      }) }));
                    }
                  }
                  break;
                }
                case 'stream_event': {
                  const se = msg as { type: 'stream_event'; event: { type: string; delta?: { text?: string; thinking?: string }; index?: number } };
                  if (se.event.type === 'content_block_delta') {
                    const retryStreamParentId = retryAgentStack.length > 0 ? retryAgentStack[retryAgentStack.length - 1] : undefined;
                    if (se.event.delta?.text) {
                      controller.enqueue(formatSSE({ type: 'text', data: se.event.delta.text, ...(retryStreamParentId ? { parentAgentId: retryStreamParentId } : {}) }));
                    }
                    if (se.event.delta?.thinking) {
                      controller.enqueue(formatSSE({ type: 'thinking', data: se.event.delta.thinking, ...(retryStreamParentId ? { parentAgentId: retryStreamParentId } : {}) }));
                    }
                  }
                  break;
                }
                case 'result': {
                  const rMsg = msg as SDKResultMessage;
                  const usage = 'result' in rMsg ? extractTokenUsage(rMsg as SDKResultSuccess, undefined, retryLastAssistantUsage) : undefined;
                  // Match main-path result shape so the chat route can persist
                  // the new sdk_session_id (route reads result.session_id as a
                  // safety net when status init was missed).
                  const retryResultErrors = rMsg.is_error
                    ? ('errors' in rMsg && rMsg.errors.length ? rMsg.errors : [assistantErrorMessage || `模型服务返回错误：${rMsg.subtype}`])
                    : [];
                  if (rMsg.is_error && !abortController?.signal.aborted) {
                    controller.enqueue(formatSSE({ type: 'error', data: retryResultErrors.join('\n') }));
                  }
                  controller.enqueue(formatSSE({
                    type: 'result',
                    data: JSON.stringify({
                      subtype: rMsg.subtype,
                      is_error: rMsg.is_error,
                      num_turns: rMsg.num_turns,
                      duration_ms: rMsg.duration_ms,
                      usage,
                      session_id: rMsg.session_id,
                      ...(rMsg.is_error ? { errors: retryResultErrors, terminal_reason: 'error' } : {}),
                    }),
                  }));
                  // Emit compression notification via the shared builder so
                  // useSSEStream's subtype=context_compressed dispatch fires.
                  const { buildContextCompressedStatus } = await import('./context-compressor');
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify(buildContextCompressedStatus({
                      messagesCompressed: compResult.messagesCompressed,
                      tokensSaved: compResult.estimatedTokensSaved,
                    })),
                  }));
                  break;
                }
              }
            }
            controller.enqueue(formatSSE({ type: 'done', data: '' }));
            controller.close();
            return; // Retry succeeded — skip normal error path
          } catch (retryErr) {
            console.warn('[claude-client] PTL retry failed, falling through to error display:', retryErr);
            // Fall through to normal error handling below
          }
        }

        // Send structured error JSON so frontend can parse category + hints
        // Falls back gracefully for older frontends that only read raw text
        const errorMessage = formatClassifiedError(classified);
        controller.enqueue(formatSSE({
          type: 'error',
          data: JSON.stringify({
            category: classified.category,
            userMessage: classified.userMessage,
            actionHint: classified.actionHint,
            retryable: classified.retryable,
            providerName: classified.providerName,
            details: classified.details,
            rawMessage: classified.rawMessage,
            recoveryActions: classified.recoveryActions,
            // Include formatted text for backward compatibility
            _formattedMessage: errorMessage,
          }),
        }));
        controller.enqueue(formatSSE({
          type: 'aborted',
          data: JSON.stringify({
            reason: 'error',
            message: classified.userMessage || classified.rawMessage || 'Unknown error',
          }),
        }));

        // Always clear sdk_session_id on crash so the next message starts fresh.
        // Even for fresh sessions — the SDK may emit a session_id via status
        // event before crashing, which gets persisted by consumeStream/SSE
        // handlers. Leaving it would cause repeated resume failures.
        if (sessionId) {
          try {
            updateSdkSessionId(sessionId, '');
            console.warn('[claude-client] Cleared stale sdk_session_id for session', sessionId);
          } catch {
            // best effort
          }
        }

        controller.close();
      } finally {
        if (backgroundFinalizationTimer) clearTimeout(backgroundFinalizationTimer);
        clearInterval(sdkKeepAliveTimer);
        if (toolWatchdogTimer) clearInterval(toolWatchdogTimer);
        if (streamWatchdogTimer) clearInterval(streamWatchdogTimer);
        unregisterConversation(sessionId);
        if (warmedQueryCleanup) {
          warmedQueryCleanup();
          warmedQueryCleanup = null;
        }
        // Tear down shadow ~/.claude/ if we built one. Best-effort — the OS
        // will eventually GC tmpdir even if this fails.
        if (usingPersistentSession && !receivedTerminalResult) {
          // Defensive backstop for iterator EOF / cancellation paths that
          // leave the try block without an SDK result event.
          if (persistentQueryForStream) {
            closePersistentClaudeSession(sessionId, persistentQueryForStream);
          }
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
        }
        if (shadowHome && !shadowHandleOwnedByPersistentSession) {
          shadowHome.cleanup();
          shadowHome = null;
        }
      }
    },

    cancel() {
      // A cancelled response may leave the SDK producing old background-task
      // frames.  Never hand that iterator to a later user request.
      if (persistentQueryForStream) {
        closePersistentClaudeSession(sessionId, persistentQueryForStream);
      }
      if (sessionId) {
        try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
      }
      console.log('[claude-client] Stream cancelled for session', sessionId, '— discarded persistent session to prevent cross-turn events');
      abortController?.abort();
    },
  });
}

// ── Provider Connection Test ─────────────────────────────────────

export interface ConnectionTestResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
    suggestion: string;
    recoveryActions?: Array<{ label: string; url?: string; action?: string }>;
  };
}

/**
 * Test a provider connection by sending a direct HTTP request to the API endpoint.
 * Bypasses the Claude Code SDK subprocess entirely to avoid false positives
 * from keychain/OAuth credentials leaking into the test.
 */
export async function testProviderConnection(config: {
  apiKey: string;
  baseUrl: string;
  protocol: string;
  authStyle: string;
  envOverrides?: Record<string, string>;
  modelName?: string;
  presetKey?: string;
  providerName?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
}): Promise<ConnectionTestResult> {
  const { getPreset, findPresetForLegacy } = await import('./provider-catalog');

  // Look up preset for default model
  const preset = config.presetKey
    ? getPreset(config.presetKey)
    : (config.baseUrl ? findPresetForLegacy(config.baseUrl, 'custom', config.protocol as import('./provider-catalog').Protocol) : undefined);

  // Determine model to use in test request
  const model = config.modelName
    || preset?.defaultRoleModels?.default
    || (preset?.defaultModels?.[0]?.upstreamModelId || preset?.defaultModels?.[0]?.modelId)
    || 'sonnet';

  // For bedrock/vertex/env_only protocols, we can't do a simple HTTP test
  if (config.protocol === 'bedrock' || config.protocol === 'vertex' || config.authStyle === 'env_only') {
    return {
      success: false,
      error: { code: 'SKIPPED', message: 'Cloud providers (Bedrock/Vertex) require IAM or OAuth credentials — connection test is not available for this provider type', suggestion: 'Save the configuration and send a message to verify' },
    };
  }

  // Media-only protocols: the rest of this function builds an Anthropic
  // /v1/messages probe with anthropic-version + x-api-key. That endpoint
  // doesn't exist for GPT Image or Nano Banana, so the generic probe would
  // always report failure even for correctly-configured providers. Route
  // them to a minimal image-API probe instead (both endpoints return a
  // 401/403 for bad auth and a 400/422 for a valid-but-rejected request,
  // which is enough to verify that the key reaches the right service).
  if (config.protocol === 'openai-image' || config.protocol === 'gemini-image') {
    return testMediaProviderConnection(config);
  }

  // 中文注释：OpenAI 兼容中转（bananarouter 等）只提供 OpenAI 格式 API —— Anthropic
  // /v1/messages 探测会 404/503 误报失败。改为 GET /v1/models + Bearer 验证
  // （最便宜的可用端点，与 openai-image 探测同一思路；也能顺带列出可用模型）。
  if (config.protocol === 'openai-compatible' || config.protocol === 'openrouter') {
    return testOpenAiCompatibleConnection(config);
  }

  // Reject third-party / custom Anthropic providers without a base URL.
  // Otherwise the fallback to https://api.anthropic.com would test the
  // official endpoint, giving a misleading green signal before saving a
  // provider that in production would also resolve to api.anthropic.com
  // via the same fallback and silently inherit first-party catalog.
  // Users who genuinely want official Anthropic must pass the URL
  // explicitly (or choose the anthropic-official preset).
  if (config.protocol === 'anthropic' && !config.baseUrl?.trim()) {
    return {
      success: false,
      error: {
        code: 'MISSING_BASE_URL',
        message: 'Base URL is required for Anthropic-protocol providers',
        suggestion: 'Use https://api.anthropic.com for the official API or your third-party endpoint',
      },
    };
  }

  // Build the API URL — Anthropic-compatible endpoint.
  // baseUrl is guaranteed non-empty above for protocol='anthropic';
  // other protocols retain the historical fallback behavior.
  let apiUrl = config.baseUrl || 'https://api.anthropic.com';
  // Ensure URL ends with /v1/messages for Anthropic-compatible providers
  if (!apiUrl.endsWith('/v1/messages')) {
    apiUrl = apiUrl.replace(/\/+$/, '');
    if (!apiUrl.endsWith('/v1')) {
      apiUrl += '/v1';
    }
    apiUrl += '/messages';
  }

  // Build headers based on auth style
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (config.authStyle === 'auth_token') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    headers['x-api-key'] = config.apiKey;
  }

  // Minimal request body — just enough to verify auth + endpoint
  const body = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // 2xx = success (even if model returns an error in body, auth works)
    if (response.ok) {
      return { success: true };
    }

    // Parse error response
    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }

    const classified = classifyError({
      error: new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`),
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Network errors (ECONNREFUSED, ENOTFOUND, timeout, etc.)
    const classified = classifyError({
      error: err,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  }
}

/**
 * Connection probe for media providers (Gemini image, OpenAI image). Each
 * provider has a different authentication scheme and endpoint shape:
 *
 *   OpenAI Image:   Bearer auth, GET /v1/models is the cheapest reachable
 *                   probe (no body; returns 401 for bad keys, 200 for good).
 *   Gemini Image:   Google uses an API key query parameter, not a header.
 *                   GET /v1beta/models?key=... mirrors the same 401/200 shape.
 *
 * Using these instead of the Anthropic /v1/messages probe means a valid
 * media configuration no longer reports a false failure because it never
 * had /v1/messages to hit.
 */
async function testOpenAiCompatibleConnection(config: {
  apiKey: string;
  baseUrl: string;
  providerName?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
}): Promise<ConnectionTestResult> {
  if (!config.baseUrl?.trim()) {
    return {
      success: false,
      error: {
        code: 'MISSING_BASE_URL',
        message: 'Base URL is required for OpenAI-compatible providers',
        suggestion: '填写中转站根地址（例如 https://api.bananarouter.com/v1）',
      },
    };
  }

  const root = config.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const apiUrl = `${root}/v1/models`;
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(apiUrl, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) return { success: true };

    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }

    const classified = classifyError({
      error: new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`),
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });
    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const classified = classifyError({
      error: err,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });
    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  }
}

async function testMediaProviderConnection(config: {
  apiKey: string;
  baseUrl: string;
  protocol: string;
  providerName?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
}): Promise<ConnectionTestResult> {
  const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
  const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const trimmed = (config.baseUrl || '').replace(/\/+$/, '');

  let apiUrl: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (config.protocol === 'openai-image') {
    const base = trimmed || DEFAULT_OPENAI_BASE;
    apiUrl = `${base}/models`;
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    // gemini-image: Google AI Studio uses ?key=... query-string auth.
    const base = trimmed || DEFAULT_GEMINI_BASE;
    apiUrl = `${base}/models?key=${encodeURIComponent(config.apiKey)}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(apiUrl, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) return { success: true };

    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }

    const classified = classifyError({
      error: new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`),
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const classified = classifyError({
      error: err,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });
    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  }
}
