import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectOnDemandMcpServerNames } from '@/lib/claude-client';

describe('selectOnDemandMcpServerNames', () => {
  it('loads web research MCPs for natural external-doc questions', () => {
    const selected = selectOnDemandMcpServerNames(
      '请帮我对照官方文档确认这个 SDK 的版本兼容性和最佳实践，不要只凭本地代码猜。',
    );

    assert.equal(selected.has('WebSearch'), true);
    assert.equal(selected.has('fetch'), true);
  });

  it('loads web research MCPs for upstream implementation questions without explicit 搜索 wording', () => {
    const selected = selectOnDemandMcpServerNames(
      '终端版 Claude Code 里的 OMC hook 到底怎么实现，和我们现在的行为差异在哪里？',
    );

    assert.equal(selected.has('WebSearch'), true);
    assert.equal(selected.has('fetch'), true);
  });
});
