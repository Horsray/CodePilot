import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../../lib/agent-system-prompt';
import type { CollaborationDecision } from '../../types';

describe('buildSystemPrompt', () => {
  it('embeds a preferred PhaseRunner payload when collaboration phases exist', () => {
    const decision: CollaborationDecision = {
      shouldCollaborate: true,
      mode: 'team_workflow',
      leadMayImplementDirectly: false,
      reasons: ['任务包含搜索与图片理解需求', '任务包含实现信号'],
      suggestedRoles: ['team-leader', 'worker-executor'],
      phases: [
        {
          id: 'lead-plan',
          name: '总指挥规划',
          roles: ['team-leader'],
          parallel: false,
          objective: '总指挥先拆解任务并确认依赖关系。',
        },
        {
          id: 'execution',
          name: '工作执行',
          roles: ['worker-executor'],
          dependsOn: ['lead-plan'],
          parallel: false,
          objective: '搜索与图片理解优先通过 MCP 工具处理，工作执行负责后续实现。',
        },
      ],
      summary: '多模型协作已触发。',
    };

    const result = buildSystemPrompt({
      teamMode: 'on',
      orchestrationTier: 'multi',
      orchestrationProfileName: '高性能',
      collaborationDecision: decision,
    });

    assert.match(result.prompt, /Preferred PhaseRunner Payload/);
    assert.match(result.prompt, /First Tool Preference/);
    assert.match(result.prompt, /工作执行/);
    assert.match(result.prompt, /MCP|understand_image|web_search/);
    assert.equal(result.phaseRunnerPayload.phases.length, 1);
  });
});
