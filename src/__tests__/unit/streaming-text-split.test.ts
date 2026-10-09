import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStablePrefix } from '../../lib/streaming-text-split';

test('splitStablePrefix: 无空行时全部算尾段', () => {
  const r = splitStablePrefix('正在输出的第一段，还没有出现空行');
  assert.equal(r.stable, '');
  assert.equal(r.tail, '正在输出的第一段，还没有出现空行');
});

test('splitStablePrefix: 在最后一个空行处切开，前缀+尾段拼回原文', () => {
  const text = '第一段。\n\n第二段。\n\n第三段还在写';
  const r = splitStablePrefix(text);
  assert.equal(r.stable, '第一段。\n\n第二段。');
  assert.equal(r.tail, '\n\n第三段还在写');
  assert.equal(r.stable + r.tail, text);
});

test('splitStablePrefix: 前缀不残留首尾空白（否则会多出一个段落间距）', () => {
  const r = splitStablePrefix('甲。\n\n乙。\n\n丙');
  assert.ok(r.stable.trim() === r.stable, `stable 不应有首尾空白: ${JSON.stringify(r.stable)}`);
});

test('splitStablePrefix: 闭合代码块保留在前缀里', () => {
  const text = '说明：\n\n```ts\nconst a = 1;\n```\n\n后面还在写';
  const r = splitStablePrefix(text);
  assert.ok(r.stable.includes('```ts'), '闭合围栏应留在前缀');
  assert.equal(r.stable + r.tail, text);
});

test('splitStablePrefix: 未闭合围栏回退，半截代码块不进 Markdown 解析', () => {
  const text = '说明：\n\n```ts\nconst a = 1;\n\nconst b = 2;';
  const r = splitStablePrefix(text);
  assert.equal(r.stable, '说明：');
  assert.ok(r.tail.includes('```ts'), '未闭合的代码块应留在尾段用纯文本渲染');
  assert.equal(r.stable + r.tail, text);
});

test('splitStablePrefix: 前后各一个闭合围栏（偶数）不回退', () => {
  const text = '```a\nx\n```\n\n中间\n\n```b\ny\n```\n\n尾段';
  const r = splitStablePrefix(text);
  assert.equal(r.stable, '```a\nx\n```\n\n中间\n\n```b\ny\n```');
  assert.equal(r.tail, '\n\n尾段');
});

test('splitStablePrefix: 只有空白前缀时全部算尾段', () => {
  const r = splitStablePrefix('\n\n   \n\n实际内容');
  assert.equal(r.stable, '');
  assert.equal(r.tail, '\n\n   \n\n实际内容');
});

test('splitStablePrefix: 波浪线围栏同样成对判定', () => {
  const text = '说明：\n\n~~~ts\nconst a = 1;\n\n还在写';
  const r = splitStablePrefix(text);
  assert.equal(r.stable, '说明：');
  assert.equal(r.stable + r.tail, text);
});

test('splitStablePrefix: 增量追加时前后缀始终是原文本的一个切分', () => {
  const full = '第一段。\n\n第二段。\n\n```ts\nconst a = 1;\n```\n\n收尾一句。';
  for (let i = 1; i <= full.length; i += 1) {
    const partial = full.slice(0, i);
    const r = splitStablePrefix(partial);
    assert.equal(r.stable + r.tail, partial, `长度 ${i} 时切分不自洽`);
    // 前缀必须落在段落边界上：要么为空，要么以非空白结尾
    if (r.stable) {
      assert.ok(r.stable.trimEnd() === r.stable, `长度 ${i} 时前缀尾部有多余空白`);
    }
  }
});
