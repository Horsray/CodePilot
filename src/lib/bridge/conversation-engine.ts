/**
 * Conversation Engine — processes inbound IM messages through Claude.
 *
 * Takes a ChannelBinding + inbound message, calls streamClaude(),
 * consumes the SSE stream server-side, saves messages to DB,
 * and returns the response text for delivery.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import '@/lib/runtime';
import type { ChannelBinding } from './types';
import type { SSEEvent, TokenUsage, MessageContentBlock, FileAttachment } from '@/types';
import { streamClaude } from '../claude-client';
import {
  addMessage,
  getMessages,
  acquireSessionLock,
  renewSessionLock,
  releaseSessionLock,
  setSessionRuntimeStatus,
  updateSdkSessionId,
  updateSessionModel,
  syncSdkTasks,
  getSession,
  getSetting,
  getDefaultProviderId,
} from '../db';
import { resolveProvider as resolveProviderUnified } from '../provider-resolver';
import { loadAllMcpServers } from '../mcp-loader';
import { assembleContext } from '../context-assembler';
import { getEnabledPluginConfigs, hasEnabledOmcPlugin } from '../plugin-discovery';
import crypto from 'crypto';

export interface PermissionRequestInfo {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: unknown[];
}

/**
 * Callback invoked immediately when a permission_request SSE event arrives.
 * This breaks the deadlock: the stream blocks until the permission is resolved,
 * so we must forward the request to the IM *during* stream consumption,
 * not after it returns.
 */
export type OnPermissionRequest = (perm: PermissionRequestInfo) => Promise<void>;

/**
 * Callback invoked on each `text` SSE event with the full accumulated text so far.
 * Must return synchronously — the bridge-manager handles throttling and fire-and-forget.
 */
export type OnPartialText = (fullText: string) => void;

/**
 * Callback invoked on tool_use / tool_result SSE events.
 * Used by card streaming to show tool progress indicators.
 */
export type OnToolEvent = (event: { type: 'tool_use'; id: string; name: string } | { type: 'tool_result'; tool_use_id: string; is_error: boolean }) => void;

export interface ConversationResult {
  responseText: string;
  tokenUsage: TokenUsage | null;
  hasError: boolean;
  errorMessage: string;
  /** Permission request events that were forwarded during streaming */
  permissionRequests: PermissionRequestInfo[];
  /** SDK session ID captured from status/result events, for session resume */
  sdkSessionId: string | null;
  /** 中文注释：本轮疑似未完成（模型提前结束 / 工具调用悬空），调用方可据此续跑 */
  incomplete: boolean;
}

type TextBlock = Extract<MessageContentBlock, { type: 'text' }>;
const isTextBlock = (b: MessageContentBlock): b is TextBlock => b.type === 'text';

/**
 * 中文注释：功能名称「只发最终结论」，用法是把一轮 query 的可见内容裁剪成
 * "最后一次工具调用之后"的文本，作为发给 IM 用户的回复。
 *
 * 背景：assistant 在两次 tool_use 之间的解说词（"让我查一下…"、"接下来我看看…"）
 * 本身就是 text 块。整轮拼接会让手机端收到一串过程叙述而不是结论
 * （2026-10-07 微信桥接实测：发出去的全是"让我…让我…"，并以冒号半句收尾）。
 * 结论应当是"最后一次工具动作之后"那段话；若模型收尾时没有输出文本，
 * 回退到最后一个非空文本块，保证不空发。
 */
export function extractFinalResponseText(blocks: MessageContentBlock[]): string {
  let lastToolIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const t = blocks[i].type;
    if (t === 'tool_use' || t === 'tool_result') {
      lastToolIdx = i;
      break;
    }
  }

  const tail = blocks
    .slice(lastToolIdx + 1)
    .filter(isTextBlock)
    .map((b) => b.text.trim())
    .filter((t) => t !== '');
  if (tail.length > 0) return tail.join('\n\n').trim();

  // 回退：末尾没有文本（模型调用完工具就收尾），用最后一个非空文本块。
  const allTexts = blocks.filter(isTextBlock).map((b) => b.text.trim()).filter((t) => t !== '');
  return allTexts.length > 0 ? allTexts[allTexts.length - 1] : '';
}

export type IncompleteReason = 'dangling_tool_use' | 'trailing_intent';

/** 中文注释：模型"宣告下一步动作"的句式，用于识别未完成的尾巴。 */
const TRAILING_INTENT_RE = /(让我|我来|接下来|接着|下面我|现在我)[^。！？!?]{0,40}[：:…]\s*$/;

/**
 * 中文注释：功能名称「裁掉前瞻尾巴」，用法是在结论末尾去掉模型"宣告要做什么"
 * 却提前结束留下的句子（"让我确认一下…："），避免用户读到结论后以为还有下文。
 *
 * 只从**末尾**逐段裁剪，且要求段落以冒号/省略号收尾并含前瞻词；裁到只剩一段就停，
 * 防止把整条回复裁空。正常结论（"查到了，horsray 属于花生国风空间。"）不受影响。
 */
export function trimTrailingIntent(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
  while (paragraphs.length > 1 && TRAILING_INTENT_RE.test(paragraphs[paragraphs.length - 1])) {
    paragraphs.pop();
  }
  return paragraphs.join('\n\n').trim();
}

/**
 * 中文注释：功能名称「未完成轮次检测」，用法是判断一轮回复是否"说完了但没做完"，
 * 供桥接层决定是否续跑，避免任务半途停下却被当成最终答复发给用户。
 *
 * - 硬信号 `dangling_tool_use`：某个 tool_use 没有配对的 tool_result —— 工具调用悬空，
 *   说明流是被中断的，任务必然没跑完。
 * - 软信号 `trailing_intent`：结尾那句话以冒号/省略号收尾且带前瞻词（"让我…"、"接下来…"），
 *   这是模型"宣告要调用工具"却提前 end_turn 的形态（deepseek 等中转模型实测高发）。
 */
export function detectIncompleteTurn(
  blocks: MessageContentBlock[],
): { incomplete: boolean; reason?: IncompleteReason } {
  const toolUseIds = new Set<string>();
  const resolvedIds = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'tool_use' && 'id' in b && typeof b.id === 'string') toolUseIds.add(b.id);
    if (b.type === 'tool_result' && 'tool_use_id' in b && typeof b.tool_use_id === 'string') {
      resolvedIds.add(b.tool_use_id);
    }
  }
  for (const id of toolUseIds) {
    if (!resolvedIds.has(id)) return { incomplete: true, reason: 'dangling_tool_use' };
  }

  const text = extractFinalResponseText(blocks);
  const lastParagraph = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '').pop() ?? '';
  if (TRAILING_INTENT_RE.test(lastParagraph)) {
    return { incomplete: true, reason: 'trailing_intent' };
  }

  return { incomplete: false };
}

/**
 * Resolve and validate working directory from multiple candidates.
 * Returns the first existing directory, or HOME as last resort.
 */
function resolveWorkingDirectory(...candidates: (string | undefined | null)[]): string {
  const safeFallback = path.join(os.homedir(), '.codepilot', 'bridge-workspace');

  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) {
      // DANGER: Never allow the bare home directory to be used as a workspace
      // for bridge sessions, as it triggers massive filesystem scans and freezes.
      if (dir === os.homedir()) {
        console.warn(`[conversation-engine] Refusing to bind to raw home directory: ${dir}. Using safe fallback.`);
        continue;
      }
      return dir;
    }
  }

  // Fallback to a safe empty directory to prevent native runtime from scanning massive home dirs
  if (!fs.existsSync(safeFallback)) {
    fs.mkdirSync(safeFallback, { recursive: true });
  }
  return safeFallback;
}

/**
 * Process an inbound message: send to Claude, consume the response stream,
 * save to DB, and return the result.
 */
export async function processMessage(
  binding: ChannelBinding,
  text: string,
  onPermissionRequest?: OnPermissionRequest,
  abortSignal?: AbortSignal,
  files?: FileAttachment[],
  onPartialText?: OnPartialText,
  onToolEvent?: OnToolEvent,
  /** Per-request system prompt append (e.g. skill instructions injected for /skill). */
  systemPromptAppend?: string,
  /** 中文注释：是否把 text 作为用户消息落库。自动续跑时传 false，避免"继续"污染会话历史。 */
  persistUserMessage = true,
): Promise<ConversationResult> {
  const sessionId = binding.codepilotSessionId;

  // Acquire session lock
  const lockId = crypto.randomBytes(8).toString('hex');
  const lockAcquired = acquireSessionLock(sessionId, lockId, `bridge-${binding.channelType}`, 600);
  if (!lockAcquired) {
    return {
      responseText: '',
      tokenUsage: null,
      hasError: true,
      errorMessage: 'Session is busy processing another request',
      permissionRequests: [],
      sdkSessionId: null,
      incomplete: false,
    };
  }

  setSessionRuntimeStatus(sessionId, 'running');

  // Lock renewal interval
  const renewalInterval = setInterval(() => {
    try { renewSessionLock(sessionId, lockId, 600); } catch { /* best effort */ }
  }, 60_000);

  try {
    // Resolve session early — needed for workingDirectory and provider resolution
    const session = getSession(sessionId);

    // Save user message — persist file attachments to disk using the same
    // <!--files:JSON--> format as the desktop chat route, so the UI can render them.
    // Also attach filePath to the file objects so streamClaude() can reuse
    // on-disk copies (matching the desktop route behavior, preventing duplicate writes).
    let savedContent = text;
    if (files && files.length > 0) {
      const workDir = binding.workingDirectory || session?.working_directory || '';
      if (workDir) {
        try {
          const uploadDir = path.join(workDir, '.codepilot-uploads');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const fileMeta = files.map((f) => {
            const safeName = path.basename(f.name).replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
            const buffer = Buffer.from(f.data, 'base64');
            fs.writeFileSync(filePath, buffer);
            // Attach filePath to the original file object so streamClaude()
            // can reference the on-disk copy via getUploadedFilePaths()
            f.filePath = filePath;
            return { id: f.id, name: f.name, type: f.type, size: buffer.length, filePath };
          });
          savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${text}`;
        } catch (err) {
          console.warn('[conversation-engine] Failed to persist file attachments:', err instanceof Error ? err.message : err);
          savedContent = `[${files.length} image(s) attached] ${text}`;
        }
      } else {
        savedContent = `[${files.length} image(s) attached] ${text}`;
      }
    }
    if (persistUserMessage) {
      addMessage(sessionId, 'user', savedContent);
    }

    // Resolve provider via unified resolver.
    // Priority chain:
    // 1. Binding's provider_id (per-binding override)
    // 2. Session's provider_id (if the DB column exists)
    // 3. Global default provider (getDefaultProviderId)
    // 4. 'env' mode fallback
    const effectiveProviderId = binding.providerId || session?.provider_id || getDefaultProviderId() || undefined;

    const resolved = resolveProviderUnified({
      providerId: effectiveProviderId,
      model: binding.model || undefined,
      sessionModel: session?.model || undefined,
    });
    const resolvedProvider = resolved.provider;

    // Use upstream model from unified resolver (same chain as chat route)
    const effectiveModel = resolved.upstreamModel || resolved.model || binding.model || session?.model || getSetting('default_model') || undefined;

    // Guard: protocol/model mismatch — e.g. google protocol with model 'sonnet'
    // would silently send a wrong request. Fail fast with a clear error.
    if (resolvedProvider && resolved.protocol) {
      const modelLower = (effectiveModel || '').toLowerCase();
      const isAnthropicModel = modelLower.includes('claude') || ['sonnet', 'opus', 'haiku'].includes(modelLower);
      const isNonAnthropicProtocol = !['anthropic', 'openai-compatible', 'openrouter'].includes(resolved.protocol);
      if (isAnthropicModel && isNonAnthropicProtocol) {
        const errMsg = `Provider "${resolvedProvider.name}" uses ${resolved.protocol} protocol but model "${effectiveModel}" is an Anthropic model. Please configure the correct provider for this bridge channel.`;
        console.error(`[conversation-engine] ${errMsg}`);
        throw new Error(errMsg);
      }
    }

    // Permission mode from binding mode
    let permissionMode: string;
    switch (binding.mode) {
      case 'plan': permissionMode = 'explore'; break;
      case 'ask': permissionMode = 'trust'; break;
      default: permissionMode = 'trust'; break;
    }

    // Bypass permissions entirely when session has full_access profile
    const bypassPermissions = session?.permission_profile === 'full_access';

    // Load conversation history for context
    const { messages: recentMsgs } = getMessages(sessionId, { limit: 50, excludeHeartbeatAck: true });
    const historyMsgs = recentMsgs.slice(0, -1).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const abortController = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        abortController.abort();
      } else {
        abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }

    // Resolve a valid working directory from multiple candidates
    const effectiveCwd = resolveWorkingDirectory(
      binding.workingDirectory,
      session?.working_directory,
      getSetting('bridge_default_work_dir'),
    );

    // 中文注释：功能名称「Bridge Claude Code 全量 MCP 暴露」，用法是让 Bridge
    // 与桌面聊天完全共享当前工作区/用户层的全部外部 MCP，可用能力不再因为入口不同
    // 而被裁剪成按需子集。
    const mcpServers = loadAllMcpServers(effectiveCwd);
    // 中文注释：功能名称「Bridge OMC 检测」，用法是让 IM/Bridge 入口和桌面聊天一样
    // 在组装上下文前识别当前工作区是否启用了 OMC，避免两条入口对技能目录和 steering 的处理不一致。
    const omcPluginEnabled = hasEnabledOmcPlugin(getEnabledPluginConfigs(effectiveCwd));

    // Unified context assembly — adds CLI tools context (and workspace prompt if applicable)
    const assembled = await assembleContext({
      session: session!,
      entryPoint: 'bridge',
      userPrompt: text,
      conversationHistory: historyMsgs,
      omcPluginEnabled,
      systemPromptAppend,
    });

    // If the effective cwd differs from what the binding/session had, the
    // original directory is gone — clear sdkSessionId to prevent stale resume.
    const originalCwd = binding.workingDirectory || session?.working_directory;
    const cwdChanged = originalCwd && effectiveCwd !== originalCwd;
    const effectiveSdkSessionId = cwdChanged ? undefined : (binding.sdkSessionId || undefined);

    if (cwdChanged) {
      console.log(`[conversation-engine] CWD changed from "${originalCwd}" to "${effectiveCwd}", clearing sdkSessionId`);
    }

    const stream = streamClaude({
      prompt: text,
      sessionId,
      sdkSessionId: effectiveSdkSessionId,
      model: effectiveModel,
      systemPrompt: assembled.systemPrompt,
      workingDirectory: effectiveCwd,
      abortController,
      permissionMode,
      provider: resolvedProvider,
      providerId: effectiveProviderId,
      sessionProviderId: session?.provider_id || undefined,
      mcpServers,
      conversationHistory: historyMsgs,
      files,
      bypassPermissions,
      // Bridge-specific SDK options
      thinking: { type: 'disabled' as const },
      effort: 'medium' as const,
      generativeUI: false,
      enableFileCheckpointing: false,
      context1m: false,
      onRuntimeStatusChange: (status: string) => {
        try { setSessionRuntimeStatus(sessionId, status); } catch { /* best effort */ }
      },
    });

    // Consume the stream server-side (replicate collectStreamResponse pattern).
    // Permission requests are forwarded immediately via the callback during streaming
    // because the stream blocks until permission is resolved — we can't wait until after.
    return await consumeStream(stream, sessionId, onPermissionRequest, onPartialText, onToolEvent);
  } finally {
    clearInterval(renewalInterval);
    releaseSessionLock(sessionId, lockId);
    setSessionRuntimeStatus(sessionId, 'idle');
  }
}

/**
 * Consume an SSE stream and extract response data.
 * Mirrors the collectStreamResponse() logic from chat/route.ts.
 */
async function consumeStream(
  stream: ReadableStream<string>,
  sessionId: string,
  onPermissionRequest?: OnPermissionRequest,
  onPartialText?: OnPartialText,
  onToolEvent?: OnToolEvent,
): Promise<ConversationResult> {
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  /** Monotonically accumulated text for streaming preview — never resets on tool_use. */
  let previewText = '';
  let tokenUsage: TokenUsage | null = null;
  let hasError = false;
  let errorMessage = '';
  const seenToolResultIds = new Set<string>();
  const permissionRequests: PermissionRequestInfo[] = [];
  let capturedSdkSessionId: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = value.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        let event: SSEEvent;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        switch (event.type) {
          case 'thinking': {
            // Accumulate thinking deltas into a thinking content block
            const delta = event.data;
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === 'thinking' && 'thinking' in lastBlock) {
              (lastBlock as { type: 'thinking'; thinking: string }).thinking += delta;
            } else {
              contentBlocks.push({ type: 'thinking', thinking: delta });
            }
            break;
          }

          case 'text':
            currentText += event.data;
            if (onPartialText) {
              previewText += event.data;
              try { onPartialText(previewText); } catch { /* non-critical */ }
            }
            break;

          case 'tool_use': {
            if (currentText.trim()) {
              contentBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }
            try {
              const toolData = JSON.parse(event.data);
              contentBlocks.push({
                type: 'tool_use',
                id: toolData.id,
                name: toolData.name,
                input: toolData.input,
              });
              if (onToolEvent) {
                try { onToolEvent({ type: 'tool_use', id: toolData.id, name: toolData.name }); } catch { /* non-critical */ }
              }
            } catch { /* skip */ }
            break;
          }

          case 'tool_result': {
            try {
              const resultData = JSON.parse(event.data);
              const newBlock = {
                type: 'tool_result' as const,
                tool_use_id: resultData.tool_use_id,
                content: resultData.content,
                is_error: resultData.is_error || false,
              };
              if (seenToolResultIds.has(resultData.tool_use_id)) {
                const idx = contentBlocks.findIndex(
                  (b) => b.type === 'tool_result' && 'tool_use_id' in b && b.tool_use_id === resultData.tool_use_id
                );
                if (idx >= 0) contentBlocks[idx] = newBlock;
              } else {
                seenToolResultIds.add(resultData.tool_use_id);
                contentBlocks.push(newBlock);
              }
              if (onToolEvent) {
                try { onToolEvent({ type: 'tool_result', tool_use_id: resultData.tool_use_id, is_error: resultData.is_error || false }); } catch { /* non-critical */ }
              }
            } catch { /* skip */ }
            break;
          }

          case 'permission_request': {
            try {
              const permData = JSON.parse(event.data);
              const perm: PermissionRequestInfo = {
                permissionRequestId: permData.permissionRequestId,
                toolName: permData.toolName,
                toolInput: permData.toolInput,
                suggestions: permData.suggestions,
              };
              permissionRequests.push(perm);
              // Forward immediately — the stream blocks until the permission is
              // resolved, so we must send the IM prompt *now*, not after the stream ends.
              if (onPermissionRequest) {
                onPermissionRequest(perm).catch((err) => {
                  console.error('[conversation-engine] Failed to forward permission request:', err);
                });
              }
            } catch { /* skip */ }
            break;
          }

          case 'status': {
            try {
              const statusData = JSON.parse(event.data);
              if (statusData.session_id) {
                capturedSdkSessionId = statusData.session_id;
                updateSdkSessionId(sessionId, statusData.session_id);
              }
              // 中文注释：不再用 SDK 上报的模型名覆盖 session 的 model 字段。
              // SDK 可能返回别名或截断的模型名（如 "mimo-v2.5" 而非用户选择的 "mimo-v2.5-pro"），
              // 导致切换会话后模型被重置。用户的显式选择应始终优先于 SDK 的内部报告。
              // Skill-nudge: agent loop emits this at end-of-run when the
              // workflow is complex enough to warrant saving as a Skill.
              // Append as a separated text block so IM users see the
              // suggestion at the bottom of the assistant reply.
              if (
                statusData.subtype === 'skill_nudge' &&
                typeof statusData.message === 'string' &&
                statusData.message.trim() !== ''
              ) {
                // Flush any pending assistant text first so the nudge
                // appears AFTER the assistant's own final words.
                if (currentText.trim()) {
                  contentBlocks.push({ type: 'text', text: currentText });
                  currentText = '';
                }
                contentBlocks.push({
                  type: 'text',
                  text: `\n\n---\nSkill suggestion: ${statusData.message}`,
                });
              }
            } catch { /* skip */ }
            break;
          }

          case 'task_update': {
            try {
              const taskData = JSON.parse(event.data);
              if (taskData.session_id && taskData.todos) {
                syncSdkTasks(taskData.session_id, taskData.todos);
              }
            } catch { /* skip */ }
            break;
          }

          case 'error': {
            hasError = true;
            // Parse structured error JSON to extract a user-friendly message
            try {
              const errObj = JSON.parse(event.data);
              errorMessage = errObj.userMessage || errObj._formattedMessage || errObj.message || event.data;
            } catch {
              errorMessage = event.data || 'Unknown error';
            }
            break;
          }

          case 'result': {
            try {
              const resultData = JSON.parse(event.data);
              if (resultData.usage) tokenUsage = resultData.usage;
              if (resultData.is_error) hasError = true;
              if (resultData.session_id) {
                capturedSdkSessionId = resultData.session_id;
                updateSdkSessionId(sessionId, resultData.session_id);
              }
            } catch { /* skip */ }
            break;
          }

          // tool_output, tool_timeout, mode_changed, done — ignored for bridge
        }
      }
    }

    // Flush remaining text
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    // Save assistant message —— 中文注释：落库前剔除 thinking 块。thinking 只在本轮用于
    // 流式渲染与观测，持久化后会被 getMessages() 当作会话历史回放给模型，把原始推理文本
    // （常为英文，如 "The background SSH tunnel task completed..."）塞回上下文，污染后续
    // 推理并放大"答非所问"（2026-10-07 微信桥接实测）。
    const storableBlocks = contentBlocks.filter((b) => b.type !== 'thinking');
    if (storableBlocks.length > 0) {
      const hasStructuredBlocks = storableBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result'
      );
      const content = hasStructuredBlocks
        ? JSON.stringify(storableBlocks)
        : storableBlocks
            .filter(isTextBlock)
            .map((b) => b.text)
            .join('\n\n')
            .trim();

      if (content) {
        addMessage(sessionId, 'assistant', content, tokenUsage ? JSON.stringify(tokenUsage) : null);
      }
    }

    // 中文注释：只把「最终结论」发给 IM —— 工具调用之间的过程叙述（"让我查一下…"）
    // 不再参与拼接，否则手机端收到的是一串"我要做什么"而不是"结论是什么"。
    let responseText = extractFinalResponseText(contentBlocks);
    if (!responseText && contentBlocks.some((b) => b.type === 'thinking' && 'thinking' in b)) {
      responseText = '_(reasoning completed, no text output)_';
    }

    return {
      responseText,
      tokenUsage,
      hasError,
      errorMessage,
      permissionRequests,
      sdkSessionId: capturedSdkSessionId,
      incomplete: detectIncompleteTurn(contentBlocks).incomplete,
    };
  } catch (e) {
    // Best-effort save on stream error
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }
    const storableBlocks = contentBlocks.filter((b) => b.type !== 'thinking');
    if (storableBlocks.length > 0) {
      const hasStructuredBlocks = storableBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result'
      );
      const content = hasStructuredBlocks
        ? JSON.stringify(storableBlocks)
        : storableBlocks
            .filter(isTextBlock)
            .map((b) => b.text)
            .join('\n\n')
            .trim();
      if (content) {
        addMessage(sessionId, 'assistant', content);
      }
    }

    const isAbort = e instanceof DOMException && e.name === 'AbortError'
      || e instanceof Error && e.name === 'AbortError';

    // 中文注释：中断时同样只回传最终结论片段，并交给调用方按 incomplete 决定是否续跑。
    let errorText = extractFinalResponseText(contentBlocks);
    if (!errorText && contentBlocks.some((b) => b.type === 'thinking')) {
      errorText = '_(reasoning completed, no text output)_';
    }

    return {
      responseText: errorText,
      tokenUsage,
      hasError: true,
      errorMessage: isAbort ? 'Task stopped by user' : (e instanceof Error ? e.message : 'Stream consumption error'),
      permissionRequests,
      sdkSessionId: capturedSdkSessionId,
      incomplete: true,
    };
  }
}
