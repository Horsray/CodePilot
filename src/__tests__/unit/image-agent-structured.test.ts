import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageAgentFallbackText, structuredImageAgentResultToText } from '@/lib/image-agent-structured';

describe('structuredImageAgentResultToText', () => {
  it('converts single image request into fenced image-gen block', () => {
    const text = structuredImageAgentResultToText({
      kind: 'single',
      explanation: '我会先生成一张基础图。',
      prompt: 'A glossy red apple on a white studio background',
      aspectRatio: '1:1',
      resolution: '2K',
      useLastGenerated: true,
    });

    assert.equal(
      text,
      '我会先生成一张基础图。\n\n```image-gen-request\n{"prompt":"A glossy red apple on a white studio background","aspectRatio":"1:1","resolution":"2K","useLastGenerated":true}\n```',
    );
  });

  it('converts batch plan into fenced batch-plan block', () => {
    const text = structuredImageAgentResultToText({
      kind: 'batch',
      summary: '三张封面图',
      items: [
        {
          prompt: 'A minimal poster with a red apple',
          aspectRatio: '3:4',
          resolution: '1K',
          tags: ['cover'],
        },
      ],
    });

    assert.equal(
      text,
      '```batch-plan\n{"summary":"三张封面图","items":[{"prompt":"A minimal poster with a red apple","aspectRatio":"3:4","resolution":"1K","tags":["cover"]}]}\n```',
    );
  });

  it('falls back to original prompt when structured prompt is empty', () => {
    const text = structuredImageAgentResultToText({
      kind: 'single',
      prompt: '   ',
    }, '画一个红色苹果');

    assert.equal(
      text,
      '```image-gen-request\n{"prompt":"画一个红色苹果","aspectRatio":"1:1","resolution":"1K"}\n```',
    );
  });

  it('marks edit-style prompts as useLastGenerated in fallback mode', () => {
    const text = buildImageAgentFallbackText('把背景换成蓝色');
    assert.equal(
      text,
      '```image-gen-request\n{"prompt":"把背景换成蓝色","aspectRatio":"1:1","resolution":"1K","useLastGenerated":true}\n```',
    );
  });
});
