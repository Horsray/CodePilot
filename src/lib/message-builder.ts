/**
 * message-builder.ts — Convert DB messages to Vercel AI SDK CoreMessage[] format.
 *
 * The DB stores all messages as `{ role: 'user' | 'assistant', content: string }`.
 * For assistant messages, `content` may be a JSON array of MessageContentBlock[]:
 *   [{ type: 'text', text }, { type: 'tool_use', id, name, input },
 *    { type: 'tool_result', tool_use_id, content }, ...]
 *
 * The Vercel AI SDK expects a strict multi-turn structure:
 *   - UserModelMessage: { role: 'user', content: UserContent }
 *   - AssistantModelMessage: { role: 'assistant', content: AssistantContent }
 *     where AssistantContent can include TextPart + ToolCallPart
 *   - ToolModelMessage: { role: 'tool', content: ToolContent }
 *     where ToolContent = Array<ToolResultPart>
 *
 * This module bridges the gap, splitting a single DB assistant record
 * (which may contain interleaved text + tool_use + tool_result) into
 * the correct alternating assistant → tool → assistant structure.
 */

import type {
  ModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  AssistantContent,
  ToolContent,
} from 'ai';
import type { Message, MessageContentBlock } from '@/types';
import { parseMessageContent } from '@/types';
import fs from 'fs';

interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  filePath?: string;
}

export function buildCoreMessages(dbMessages: Message[]): ModelMessage[] {
  const raw: ModelMessage[] = [];

  for (const msg of dbMessages) {
    if (msg.is_heartbeat_ack === 1) continue;

    if (msg.role === 'user') {
      raw.push(buildUserMessage(msg.content));
    } else {
      const blocks = parseMessageContent(msg.content);
      const converted = convertAssistantBlocks(blocks);
      raw.push(...converted);
    }
  }

  const result = enforceAlternation(raw);
  return result;
}

function enforceAlternation(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= 1) return messages;

  const result: ModelMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];

    if (curr.role === prev.role && curr.role === 'user') {
      result[result.length - 1] = { role: 'user', content: mergeUserContent(prev.content, curr.content) };
    } else if (curr.role === prev.role && curr.role === 'assistant') {
      result[result.length - 1] = curr;
    } else {
      result.push(curr);
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeUserContent(a: any, b: any): any {
  const partsA = typeof a === 'string' ? [{ type: 'text', text: a }] : Array.isArray(a) ? a : [{ type: 'text', text: String(a) }];
  const partsB = typeof b === 'string' ? [{ type: 'text', text: b }] : Array.isArray(b) ? b : [{ type: 'text', text: String(b) }];
  const merged = [...partsA, ...partsB];

  if (merged.every((p: { type: string }) => p.type === 'text')) {
    return merged.map((p: { text?: string }) => p.text || '').join('\n\n').trim();
  }
  return merged;
}

function buildUserMessage(content: string): ModelMessage {
  const match = content.match(/^<!--files:(\[.*?\])-->([\s\S]*)$/);
  if (!match) {
    return { role: 'user', content };
  }

  const text = match[2] || '';
  let fileMetas: FileMeta[] = [];
  try { fileMetas = JSON.parse(match[1]); } catch { /* ignore */ }

  if (fileMetas.length === 0) {
    return { role: 'user', content: text };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  if (text.trim()) {
    parts.push({ type: 'text', text: text.trim() });
  }

  for (const meta of fileMetas) {
    if (!meta.filePath || !meta.type) continue;

    if (meta.type.startsWith('image/')) {
      try {
        const data = fs.readFileSync(meta.filePath);
        const base64 = data.toString('base64');
        parts.push({ type: 'image', image: base64, mimeType: meta.type, mediaType: meta.type });
      } catch {
        parts.push({ type: 'text', text: `[Attached file: ${meta.name} (no longer available)]` });
      }
    } else {
      try {
        const fileContent = fs.readFileSync(meta.filePath, 'utf-8');
        parts.push({ type: 'text', text: `\n--- ${meta.name} ---\n${fileContent.slice(0, 50000)}\n--- end ---` });
      } catch {
        parts.push({ type: 'text', text: `[Attached file: ${meta.name}]` });
      }
    }
  }

  if (parts.length === 0) {
    return { role: 'user', content: text };
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    return { role: 'user', content: parts[0].text };
  }

  return { role: 'user', content: parts };
}

function convertAssistantBlocks(blocks: MessageContentBlock[]): ModelMessage[] {
  const messages: ModelMessage[] = [];

  let assistantParts: Exclude<AssistantContent, string> = [];
  let toolResults: ToolContent = [];
  const pendingToolCalls = new Map<string, string>();

  const flushAssistant = () => {
    if (assistantParts.length > 0) {
      messages.push({ role: 'assistant', content: assistantParts } as AssistantModelMessage);
      assistantParts = [];
    }
  };

  const flushPendingMissingToolResults = () => {
    if (pendingToolCalls.size === 0) return;
    const missing: ToolContent = [];
    for (const [toolCallId, toolName] of pendingToolCalls.entries()) {
      missing.push({
        type: 'tool-result',
        toolCallId,
        toolName,
        result: `[tool-error] ${toolName}: missing tool_result; previous run was interrupted or timed out.`,
        isError: true,
      } as any);
    }
    pendingToolCalls.clear();
    if (missing.length > 0) {
      messages.push({ role: 'tool', content: missing } as ToolModelMessage);
    }
  };

  const flushToolResults = () => {
    if (toolResults.length > 0) {
      messages.push({ role: 'tool', content: toolResults } as ToolModelMessage);
      toolResults = [];
    }
  };

  const toolNameMap = new Map<string, string>();
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      toolNameMap.set(block.id, block.name);
    }
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (toolResults.length > 0) {
          flushToolResults();
        }
        if (pendingToolCalls.size > 0) {
          flushAssistant();
          flushPendingMissingToolResults();
        }
        if (block.text.trim()) {
          assistantParts.push({ type: 'text', text: block.text });
        }
        break;

      case 'thinking':
        break;

      case 'tool_use':
        if (toolResults.length > 0) {
          flushToolResults();
        }
        pendingToolCalls.set(block.id, block.name);
        assistantParts.push({
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          input: block.input,
        });
        break;

      case 'tool_result':
        flushAssistant();
        pendingToolCalls.delete(block.tool_use_id);
        toolResults.push({
          type: 'tool-result',
          toolCallId: block.tool_use_id,
          toolName: toolNameMap.get(block.tool_use_id) || 'unknown',
          result: block.content,
          isError: block.is_error || false,
        } as any);
        break;

      case 'code':
        if (toolResults.length > 0) {
          flushToolResults();
        }
        if (pendingToolCalls.size > 0) {
          flushAssistant();
          flushPendingMissingToolResults();
        }
        assistantParts.push({
          type: 'text',
          text: `\`\`\`${block.language}\n${block.code}\n\`\`\``,
        });
        break;
    }
  }

  flushAssistant();
  flushToolResults();
  flushPendingMissingToolResults();

  if (messages.length === 0) {
    messages.push({ role: 'assistant', content: '' });
  }

  return messages;
}
