/**
 * tool-call-recovery.ts — 工具调用兜底与恢复辅助函数。
 *
 * 用法：
 * 1. 在流式执行阶段，遇到缺失 tool_result 时生成补偿消息，避免会话卡死。
 * 2. 在消息持久化和历史回放阶段，补齐孤立的 tool_use，修复已损坏会话。
 */

import type {
  ModelMessage,
  AssistantContent,
  ToolContent,
  AssistantModelMessage,
  ToolModelMessage,
} from 'ai';
import type { MessageContentBlock } from '@/types';

export interface ToolCallSnapshot {
  id: string;
  name: string;
  input?: unknown;
}

const DEFAULT_RECOVERY_REASON =
  'Tool execution did not produce a final result. The runtime skipped this call so the conversation can continue.';

/**
 * 中文注释：生成统一的工具失败文案，给模型和前端都能直接消费。
 * 用法：在超时、异常、跳过时作为 tool_result.content 写回。
 */
export function buildRecoveredToolResultText(toolName: string, reason?: string): string {
  const detail = reason?.trim() || DEFAULT_RECOVERY_REASON;
  return `Tool "${toolName}" failed or was skipped. ${detail}`;
}

/**
 * 中文注释：从异常文本中提取缺失的 toolCallId 列表。
 * 用法：捕获 AI_MissingToolResultsError 后，用它定位需要补偿的调用。
 */
export function extractMissingToolCallIds(error: unknown): string[] {
  const candidates: string[] = [];

  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === 'string') {
      candidates.push(value);
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (typeof parsed.userMessage === 'string') candidates.push(parsed.userMessage);
        if (typeof parsed.message === 'string') candidates.push(parsed.message);
      } catch {
        // ignore plain strings
      }
      return;
    }
    if (value instanceof Error) {
      candidates.push(value.message);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.userMessage === 'string') candidates.push(record.userMessage);
      if (typeof record.message === 'string') candidates.push(record.message);
    }
  };

  visit(error);

  const ids = new Set<string>();
  for (const text of candidates) {
    for (const match of text.matchAll(/\b(call_[a-zA-Z0-9_-]+)\b/g)) {
      if (match[1]) ids.add(match[1]);
    }
  }

  return Array.from(ids);
}

/**
 * 中文注释：给结构化内容块补齐缺失的 tool_result。
 * 用法：持久化前或从数据库读取后调用，避免残缺历史再次触发 MissingToolResults。
 */
export function sanitizeToolCallBlocks(
  blocks: MessageContentBlock[],
  reason?: string,
): MessageContentBlock[] {
  const toolUses = new Map(
    blocks
      .filter(
        (block): block is Extract<MessageContentBlock, { type: 'tool_use' }> => block.type === 'tool_use',
      )
      .map((block) => [block.id, block] as const),
  );
  if (toolUses.size === 0) return blocks;

  const repaired: MessageContentBlock[] = [];
  const consumedResultIndexes = new Set<number>();
  const pendingToolIds: string[] = [];

  const appendRecoveredResults = (toolIds: string[]) => {
    for (const toolId of toolIds) {
      const toolUse = toolUses.get(toolId);
      if (!toolUse) continue;
      repaired.push({
        type: 'tool_result',
        tool_use_id: toolId,
        content: buildRecoveredToolResultText(toolUse.name, reason),
        is_error: true,
      });
    }
  };

  const flushPendingBeforeAssistantContinuation = (fromIndex: number) => {
    if (pendingToolIds.length === 0) return;

    // 中文注释：功能名称「tool_result 顺序修复」，用法是在 assistant 继续输出文本前，
    // 先把后面错位的真实 tool_result 提前，保证兼容 Anthropic/Claude Code 的严格顺序约束。
    for (let lookahead = fromIndex; lookahead < blocks.length && pendingToolIds.length > 0; lookahead++) {
      if (consumedResultIndexes.has(lookahead)) continue;
      const futureBlock = blocks[lookahead];
      if (futureBlock.type !== 'tool_result') continue;
      const pendingIndex = pendingToolIds.indexOf(futureBlock.tool_use_id);
      if (pendingIndex === -1) continue;
      repaired.push(futureBlock);
      consumedResultIndexes.add(lookahead);
      pendingToolIds.splice(pendingIndex, 1);
    }

    if (pendingToolIds.length > 0) {
      appendRecoveredResults([...pendingToolIds]);
      pendingToolIds.length = 0;
    }
  };

  for (let index = 0; index < blocks.length; index++) {
    if (consumedResultIndexes.has(index)) continue;
    const block = blocks[index];

    if (block.type === 'tool_use') {
      repaired.push(block);
      if (!pendingToolIds.includes(block.id)) {
        pendingToolIds.push(block.id);
      }
      continue;
    }

    if (block.type === 'tool_result') {
      repaired.push(block);
      const pendingIndex = pendingToolIds.indexOf(block.tool_use_id);
      if (pendingIndex !== -1) {
        pendingToolIds.splice(pendingIndex, 1);
      }
      continue;
    }

    flushPendingBeforeAssistantContinuation(index);
    repaired.push(block);
  }

  if (pendingToolIds.length > 0) {
    appendRecoveredResults(pendingToolIds);
  }

  return repaired;
}

/**
 * 中文注释：为当前 step 合成 assistant/tool 消息，补上丢失的工具结果。
 * 用法：agent-loop 当前轮恢复时调用，让模型能够在下一步继续推理。
 */
export function buildSyntheticToolRecoveryMessages(params: {
  toolCalls: ToolCallSnapshot[];
  text?: string;
  reason?: string;
}): ModelMessage[] {
  const { toolCalls, text, reason } = params;
  if (toolCalls.length === 0) return [];

  const assistantParts: Exclude<AssistantContent, string> = [];
  if (text?.trim()) {
    assistantParts.push({ type: 'text', text: text.trim() });
  }

  for (const toolCall of toolCalls) {
    assistantParts.push({
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
    });
  }

  const toolParts: ToolContent = toolCalls.map((toolCall) => ({
    type: 'tool-result',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: {
      type: 'text',
      value: buildRecoveredToolResultText(toolCall.name, reason),
    },
  }));

  return [
    { role: 'assistant', content: assistantParts } as AssistantModelMessage,
    { role: 'tool', content: toolParts } as ToolModelMessage,
  ];
}
