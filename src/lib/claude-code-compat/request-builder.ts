/**
 * request-builder.ts — Convert AI SDK call options to Anthropic Messages API format.
 *
 * Translates LanguageModelV3CallOptions (messages + tools + system)
 * into the request body that Claude Code-compatible proxies expect.
 */

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { ClaudeCodeCompatConfig } from './types';

// ── Headers ─────────────────────────────────────────────────────

const BETA_HEADERS = 'interleaved-thinking-2025-05-14';

export function buildHeaders(config: ClaudeCodeCompatConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-beta': BETA_HEADERS,
    ...config.headers,
  };

  // Auth: api_key style → x-api-key, auth_token style → Authorization Bearer
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  } else if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  return headers;
}

// ── Request Body ────────────────────────────────────────────────

export function buildBody(
  options: LanguageModelV3CallOptions,
  config: ClaudeCodeCompatConfig,
): Record<string, unknown> {
  const { prompt, maxOutputTokens, tools, toolChoice, providerOptions } = options;

  // Extract system messages and convert conversation messages
  const systemBlocks: Array<{ type: 'text'; text: string }> = [];
  const messages: Array<{ role: string; content: unknown }> = [];

  for (const msg of prompt) {
    if (msg.role === 'system') {
      // System messages → top-level system field
      if (typeof msg.content === 'string') {
        systemBlocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ text?: string }>) {
          if (part.text) {
            systemBlocks.push({ type: 'text', text: part.text });
          }
        }
      }
    } else if (msg.role === 'user') {
      messages.push({ role: 'user', content: convertUserContent(msg.content) });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: convertAssistantContent(msg.content) });
    } else if (msg.role === 'tool') {
      // Tool results → user message with tool_result content blocks
      messages.push({ role: 'user', content: convertToolContent(msg.content) });
    }
  }

  const body: Record<string, unknown> = {
    model: config.modelId,
    messages,
    max_tokens: maxOutputTokens || 16384,
    stream: true,
  };

  if (systemBlocks.length > 0) {
    body.system = systemBlocks;
  }

  // Tools
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => {
      if (t.type === 'function') {
        return {
          name: t.name,
          description: t.description || '',
          input_schema: t.inputSchema,
        };
      }
      return t; // pass through provider-defined tools
    });
  }

  // Tool choice
  if (toolChoice) {
    if (toolChoice.type === 'auto') body.tool_choice = { type: 'auto' };
    else if (toolChoice.type === 'required') body.tool_choice = { type: 'any' };
    else if (toolChoice.type === 'none') body.tool_choice = { type: 'none' };
    else if (toolChoice.type === 'tool') body.tool_choice = { type: 'tool', name: toolChoice.toolName };
  }

  // Thinking (from provider options)
  const anthropicOpts = providerOptions?.anthropic as Record<string, unknown> | undefined;
  if (anthropicOpts?.thinking) {
    body.thinking = anthropicOpts.thinking;
  }

  return body;
}

// ── Content Converters ──────────────────────────────────────────

function convertUserContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return content;

  return content.map((part: Record<string, unknown>) => {
    if (part.type === 'text') return { type: 'text', text: part.text as string };
    if (part.type === 'image') {
      const imagePart = part as { image: unknown; mimeType?: string };
      // AI SDK image → Anthropic image
      if (imagePart.image instanceof URL) {
        return { type: 'image', source: { type: 'url', url: imagePart.image.toString() } };
      }
      
      if (typeof imagePart.image === 'string') {
        // If it starts with http, it's a URL
        if (imagePart.image.startsWith('http')) {
          return { type: 'image', source: { type: 'url', url: imagePart.image } };
        }
        // Otherwise assume base64
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imagePart.mimeType || 'image/png',
            data: imagePart.image,
          },
        };
      }
      
      // Buffer/Uint8Array
      const base64Data = Buffer.from(imagePart.image as Uint8Array | Buffer).toString('base64');
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imagePart.mimeType || 'image/png',
          data: base64Data,
        },
      };
    }

    // Handle 'file' type (new in AI SDK 3.x)
    if (part.type === 'file') {
      const filePart = part as { mimeType?: string; contentType?: string; data: unknown };
      const mimeType = filePart.mimeType || filePart.contentType || '';
      const data = filePart.data;
      let base64Data = '';

      if (typeof data === 'string') {
        base64Data = data;
      } else if (data instanceof Uint8Array || data instanceof Buffer) {
        base64Data = Buffer.from(data).toString('base64');
      } else if (data instanceof ArrayBuffer) {
        base64Data = Buffer.from(new Uint8Array(data)).toString('base64');
      }

      if (mimeType.startsWith('image/') || (!mimeType && base64Data.length > 100)) {
        // Anthropic supports: image/jpeg, image/png, image/gif, image/webp
        const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const effectiveMimeType = supportedTypes.includes(mimeType) ? mimeType : 'image/png';
        
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: effectiveMimeType,
            data: base64Data,
          },
        };
      }

      // Non-image files: if they are text-like, we could potentially read them, 
      // but for now let's just indicate a file was attached.
      return { type: 'text', text: `[File attachment: ${mimeType || 'unknown'}]` };
    }

    return part; // pass through unknown types
  });
}

function convertAssistantContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return content;

  return content.map((part: Record<string, unknown>) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'tool-call') {
      return {
        type: 'tool_use',
        id: part.toolCallId,
        name: part.toolName,
        input: typeof part.input === 'string' ? JSON.parse(part.input as string) : part.input,
      };
    }
    if (part.type === 'reasoning') return { type: 'thinking', thinking: part.text };
    return part;
  });
}

function convertToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;

  return content.map((part: Record<string, unknown>) => {
    if (part.type === 'tool-result') {
      const resultContent = typeof part.result === 'string'
        ? part.result
        : JSON.stringify(part.result, null, 2);

      // Note: Anthropic tool_result content can be a string or array of blocks
      const toolContent: Array<Record<string, unknown>> = [{ type: 'text', text: resultContent }];

      // If the tool result has experimental_attachments (AI SDK feature),
      // we should convert them to images if they are images.
      const experimentalAttachments = (part as { experimental_attachments?: Array<Record<string, unknown>> }).experimental_attachments;
      if (Array.isArray(experimentalAttachments)) {
        for (const attachment of experimentalAttachments) {
          if (attachment.type === 'image' || (attachment.type === 'file' && (attachment.mimeType as string | undefined)?.startsWith('image/'))) {
            const data = attachment.image || attachment.data;
            let base64Data = '';
            if (typeof data === 'string') base64Data = data;
            else if (data instanceof Uint8Array || data instanceof Buffer) base64Data = Buffer.from(data).toString('base64');
            
            if (base64Data) {
              toolContent.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: attachment.mimeType || 'image/png',
                  data: base64Data,
                },
              });
            }
          }
        }
      }

      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: toolContent,
      };
    }
    return part;
  });
}
