const TRANSPORT_BLOCK_TYPES = new Set([
  'tool_use',
  'tool_result',
  'tool_output',
  'status',
  'thinking',
  'result',
  'done',
  'error',
  'keep_alive',
  'referenced_contexts',
  'permission_request',
  'task_update',
  'rate_limit',
  'context_usage',
  'mode_changed',
  'rewind_point',
]);

const STRUCTURED_MESSAGE_TYPES = new Set([
  ...TRANSPORT_BLOCK_TYPES,
  'text',
  'code',
  'timeline',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTransportLikeObject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = typeof value.type === 'string' ? value.type : '';
  if (TRANSPORT_BLOCK_TYPES.has(type)) return true;
  if ('tool_use_id' in value && ('content' in value || 'is_error' in value)) return true;
  if ('tool_calls' in value && Array.isArray(value.tool_calls)) return true;
  if ('id' in value && 'name' in value && 'input' in value && Object.keys(value).length <= 5) return true;
  return false;
}

function visibleTextFromStructured(value: unknown): string | null {
  if (Array.isArray(value)) {
    const looksStructured = value.every((item) => (
      isRecord(item)
      && typeof item.type === 'string'
      && STRUCTURED_MESSAGE_TYPES.has(item.type)
    ));
    if (!looksStructured) return null;
    const text = value
      .map((item) => {
        if (!isRecord(item)) return '';
        if (item.type === 'text' && typeof item.text === 'string') return item.text;
        if (item.type === 'code' && typeof item.code === 'string') {
          const language = typeof item.language === 'string' ? item.language : '';
          return `\`\`\`${language}\n${item.code}\n\`\`\``;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    return text;
  }

  if (isTransportLikeObject(value)) return '';
  return null;
}

export function extractVisibleTextFromStructuredContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return null;
  try {
    return visibleTextFromStructured(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function stripLeakedTransportContent(content: string): string {
  const structuredText = extractVisibleTextFromStructuredContent(content);
  if (structuredText !== null) return structuredText;

  return content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const dataMatch = trimmed.match(/^\$?data\s*:?\s*(\{[\s\S]*\})$/);
      if (dataMatch) {
        try {
          return !isTransportLikeObject(JSON.parse(dataMatch[1]));
        } catch {
          return false;
        }
      }
      if (/^\{[\s\S]*\}$/.test(trimmed)) {
        try {
          return !isTransportLikeObject(JSON.parse(trimmed));
        } catch {
          return true;
        }
      }
      return true;
    })
    .join('\n')
    .trim();
}
