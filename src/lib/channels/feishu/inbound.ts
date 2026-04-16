/**
 * Feishu inbound message processing.
 *
 * Converts raw Feishu event data into InboundMessage for the bridge queue.
 */

import type { InboundMessage } from '../../bridge/types';
import type { FeishuConfig } from './types';
import type { FeishuResourceType } from './resource-downloader';

export interface PendingResource {
  messageId: string;
  fileKey: string;
  resourceType: FeishuResourceType;
  caption?: string;
}

const LOG_TAG = '[feishu/inbound]';

interface FeishuMention {
  key?: string;
  id?: { open_id?: string };
}

interface FeishuRawMessage {
  chat_id?: string;
  message_id?: string;
  message_type?: string;
  content?: string;
  root_id?: string;
  create_time?: string;
  mentions?: FeishuMention[];
}

interface FeishuRawEvent {
  event?: {
    message?: FeishuRawMessage;
    sender?: { sender_id?: { open_id?: string } };
  };
  message?: FeishuRawMessage;
  sender?: { sender_id?: { open_id?: string } };
}

function findBotMention(
  mentions: FeishuMention[] | undefined,
  botOpenId: string,
): FeishuMention | undefined {
  if (!mentions || !botOpenId) return undefined;
  return mentions.find((m) => m?.id?.open_id === botOpenId);
}

export function parseInboundMessage(
  eventData: unknown,
  config: FeishuConfig,
  botOpenId?: string,
): InboundMessage | null {
  try {
    const raw = eventData as FeishuRawEvent;
    const event = raw?.event ?? raw;
    const message = event?.message;
    if (!message) return null;

    const chatId = message.chat_id || '';
    const messageId = message.message_id || '';
    const sender = event.sender?.sender_id?.open_id || '';
    const msgType = message.message_type;

    const isGroupChat = chatId.startsWith('oc_');
    const botMention = isGroupChat
      ? findBotMention(message.mentions, botOpenId || '')
      : undefined;

    // 中文注释：功能名称「飞书群聊 @mention 门禁」。
    // 用法：requireMention 开启后，仅在已识别 botOpenId 时拦截未 @bot 的群聊消息，避免冷启动时误伤正常消息。
    if (isGroupChat && config.requireMention && botOpenId && !botMention) {
      return null;
    }

    const rootId = message.root_id || '';
    const effectiveChatId = (config.threadSession && rootId)
      ? `${chatId}:thread:${rootId}`
      : chatId;

    const address = { channelType: 'feishu' as const, chatId: effectiveChatId, userId: sender };
    const timestamp = parseInt(message.create_time || '0', 10) || Date.now();

    if (msgType === 'text') {
      let text = '';
      try {
        const content = JSON.parse(message.content || '{}');
        text = content.text || '';
      } catch {
        text = message.content || '';
      }
      if (!text.trim()) return null;

      if (botMention?.key) {
        text = text.split(botMention.key).join('').trim();
      }

      return {
        messageId,
        address,
        text: text.trim(),
        timestamp,
      };
    }

    const resources = extractResources(messageId, msgType, message.content || '');
    if (resources && resources.length > 0) {
      return {
        messageId,
        address,
        text: resources.map((r) => r.caption).filter(Boolean).join('\n') || '',
        timestamp,
      };
    }

    return null;
  } catch (err) {
    console.error(LOG_TAG, 'Failed to parse inbound message:', err);
    return null;
  }
}

export function extractResources(
  messageId: string,
  msgType: string | undefined,
  contentJson: string,
): PendingResource[] | null {
  if (!msgType || !contentJson) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return null;
  }

  switch (msgType) {
    case 'image': {
      const imageKey = typeof parsed.image_key === 'string' ? parsed.image_key : '';
      if (!imageKey) return null;
      return [{ messageId, fileKey: imageKey, resourceType: 'image' }];
    }
    case 'file': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      const fileName = typeof parsed.file_name === 'string' ? parsed.file_name : '';
      return [{
        messageId,
        fileKey,
        resourceType: 'file',
        caption: fileName ? `[File: ${fileName}]` : undefined,
      }];
    }
    case 'audio': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      return [{ messageId, fileKey, resourceType: 'audio' }];
    }
    case 'media':
    case 'video': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      return [{ messageId, fileKey, resourceType: 'video' }];
    }
    default:
      return null;
  }
}

export function parseMessageWithResources(
  eventData: unknown,
  config: FeishuConfig,
  botOpenId?: string,
): { message: InboundMessage; resources: PendingResource[] } | null {
  const base = parseInboundMessage(eventData, config, botOpenId);
  if (!base) return null;

  const raw = eventData as FeishuRawEvent;
  const event = raw?.event ?? raw;
  const message = event?.message;
  if (!message) return { message: base, resources: [] };

  const resources = extractResources(
    message.message_id || '',
    message.message_type,
    message.content || '',
  ) || [];

  return { message: base, resources };
}
