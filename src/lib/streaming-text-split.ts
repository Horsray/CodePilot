/**
 * 流式正文的「定型前缀」切分。
 *
 * 流式内容只会向后追加，因此段落边界之前的文本不会再被改写 —— 这部分可以直接按最终
 * Markdown 渲染，让流式期间看到的排版就是最终排版，收尾时不再发生"整段裸文本突然
 * 变成排版好的内容"的形变。只有最后一个空行之后的那一小段还在增长，用纯文本兜底。
 *
 * 两条安全约束：
 * 1) 切点必须是空行（段落边界）。若切在段落中间，这段文字会先作为独立段落渲染出段
 *    间距，后续行接上时又会合并，反而制造跳动。
 * 2) 前缀里的围栏（``` / ~~~）必须成对闭合，否则回退到最后一个未闭合围栏之前 ——
 *    半截代码块交给 Markdown 解析会吞掉后面的文本。
 */
export function splitStablePrefix(text: string): { stable: string; tail: string } {
  const brk = text.lastIndexOf('\n\n');
  if (brk <= 0) return { stable: '', tail: text };

  let stable = text.slice(0, brk);

  const fenceRe = /^(`{3,}|~{3,})[^\n]*$/gm;
  let fenceCount = 0;
  let lastFenceIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(stable)) !== null) {
    fenceCount += 1;
    lastFenceIndex = m.index;
  }
  if (fenceCount % 2 === 1 && lastFenceIndex > 0) {
    stable = stable.slice(0, lastFenceIndex);
  }

  // 回退或连续空行都可能在前缀尾部留下空白；前缀末尾的空行在 Markdown 容器里
  // 会多顶出一段间距，必须去掉（去掉后 tail 仍能拼回原文）。
  stable = stable.replace(/\s+$/, '');

  if (!stable) return { stable: '', tail: text };
  return { stable, tail: text.slice(stable.length) };
}
