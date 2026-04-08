const IMAGE_AGENT_SINGLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'prompt'],
  properties: {
    kind: { const: 'single' },
    explanation: { type: 'string' },
    prompt: { type: 'string', minLength: 1 },
    aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'] },
    resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
    useLastGenerated: { type: 'boolean' },
  },
} as const;

const IMAGE_AGENT_BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'summary', 'items'],
  properties: {
    kind: { const: 'batch' },
    explanation: { type: 'string' },
    summary: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1 },
          aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'] },
          resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
          tags: { type: 'array', items: { type: 'string' } },
          sourceRefs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const IMAGE_AGENT_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    oneOf: [IMAGE_AGENT_SINGLE_SCHEMA, IMAGE_AGENT_BATCH_SCHEMA],
  },
};

interface StructuredSingleRequest {
  kind: 'single';
  explanation?: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  useLastGenerated?: boolean;
}

interface StructuredBatchItem {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  tags?: string[];
  sourceRefs?: string[];
}

interface StructuredBatchRequest {
  kind: 'batch';
  explanation?: string;
  summary: string;
  items: StructuredBatchItem[];
}

function normalizeAspectRatio(value: unknown): string {
  const allowed = new Set(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4']);
  return typeof value === 'string' && allowed.has(value) ? value : '1:1';
}

function normalizeResolution(value: unknown): string {
  const allowed = new Set(['1K', '2K', '4K']);
  return typeof value === 'string' && allowed.has(value) ? value : '1K';
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return tags.length > 0 ? tags : undefined;
}

function toTextBlock(prefix: string | undefined, fencedBlock: string): string {
  const intro = typeof prefix === 'string' ? prefix.trim() : '';
  return intro ? `${intro}\n\n${fencedBlock}` : fencedBlock;
}

function shouldUseLastGenerated(prompt: string): boolean {
  return /(上一张|上次|刚才|之前生成|继续改|继续调整|修改|编辑|调整|去掉|删除|移除|换成|替换|加上|加个|change|edit|adjust|remove|delete|replace|add\b)/i.test(prompt);
}

export function buildImageAgentFallbackText(prompt: string): string | null {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return null;

  return structuredImageAgentResultToText({
    kind: 'single',
    prompt: normalizedPrompt,
    useLastGenerated: shouldUseLastGenerated(normalizedPrompt),
  }, normalizedPrompt);
}

export function structuredImageAgentResultToText(value: unknown, fallbackPrompt?: string): string | null {
  if (!value || typeof value !== 'object') return null;

  const kind = (value as { kind?: unknown }).kind;

  if (kind === 'single') {
    const request = value as StructuredSingleRequest;
    const prompt = typeof request.prompt === 'string' && request.prompt.trim().length > 0
      ? request.prompt.trim()
      : (fallbackPrompt?.trim() || '');
    if (!prompt) return null;

    const payload = {
      prompt,
      aspectRatio: normalizeAspectRatio(request.aspectRatio),
      resolution: normalizeResolution(request.resolution),
      ...(request.useLastGenerated ? { useLastGenerated: true } : {}),
    };

    return toTextBlock(
      request.explanation,
      `\`\`\`image-gen-request\n${JSON.stringify(payload)}\n\`\`\``,
    );
  }

  if (kind === 'batch') {
    const request = value as StructuredBatchRequest;
    const items = Array.isArray(request.items)
      ? request.items
        .map(item => {
          const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
          if (!prompt) return null;
          return {
            prompt,
            aspectRatio: normalizeAspectRatio(item.aspectRatio),
            resolution: normalizeResolution(item.resolution),
            ...(normalizeTags(item.tags) ? { tags: normalizeTags(item.tags) } : {}),
            ...(normalizeTags(item.sourceRefs) ? { sourceRefs: normalizeTags(item.sourceRefs) } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

    if (items.length === 0) return null;

    const payload = {
      summary: typeof request.summary === 'string' && request.summary.trim().length > 0
        ? request.summary.trim()
        : 'Batch image generation plan',
      items,
    };

    return toTextBlock(
      request.explanation,
      `\`\`\`batch-plan\n${JSON.stringify(payload)}\n\`\`\``,
    );
  }

  return null;
}
