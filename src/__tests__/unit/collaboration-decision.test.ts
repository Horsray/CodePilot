import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCollaborationNeed } from '../../lib/collaboration-decision';

describe('analyzeCollaborationNeed', () => {
  it('triggers execution and quality roles while leaving search/vision to MCP capabilities', () => {
    const result = analyzeCollaborationNeed({
      prompt: '请根据截图分析 UI 问题，再去官网和最新文档检索资料，然后修改代码并验证是否修复。',
      teamMode: 'on',
      orchestrationTier: 'multi',
      files: [
        { id: '1', name: 'bug.png', type: 'image/png', size: 12, data: '' },
      ],
      conversationHistory: [],
      conversationHistoryCount: 0,
    });

    assert.equal(result.shouldCollaborate, true);
    assert.ok(result.suggestedRoles.includes('team-leader'));
    assert.ok(result.suggestedRoles.includes('worker-executor'));
    assert.ok(result.suggestedRoles.includes('quality-inspector'));
    assert.ok(result.phases?.some((phase) => phase.id === 'execution' && phase.dependsOn?.includes('lead-plan')));
    assert.match(result.summary, /MCP/);
  });

  it('escalates to expert consultant after repeated negative user feedback', () => {
    const result = analyzeCollaborationNeed({
      prompt: '还是错，依旧无效，这次也没解决问题。',
      teamMode: 'on',
      orchestrationTier: 'multi',
      conversationHistory: [
        { role: 'user', content: '不对，上一轮完全没解决。' },
        { role: 'assistant', content: '我再试一下。' },
        { role: 'user', content: '还是无效，问题依旧存在。' },
        { role: 'assistant', content: '收到。' },
      ],
      conversationHistoryCount: 4,
    });

    assert.equal(result.shouldCollaborate, true);
    assert.ok(result.suggestedRoles.includes('expert-consultant'));
    assert.match(result.summary, /专家顾问/);
    assert.ok(result.phases?.some((phase) => phase.id === 'expert-escalation'));
  });
});
