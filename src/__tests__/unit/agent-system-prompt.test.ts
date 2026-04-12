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
      reasons: ['任务包含知识检索信号', '任务包含视觉理解信号'],
      suggestedRoles: ['team-leader', 'knowledge-searcher', 'vision-understanding', 'worker-executor'],
      phases: [
        {
          id: 'lead-plan',
          name: '总指挥规划',
          roles: ['team-leader'],
          parallel: false,
          objective: '总指挥先拆解任务并确认依赖关系。',
        },
        {
          id: 'parallel-research',
          name: '并行取证',
          roles: ['knowledge-searcher', 'vision-understanding'],
          dependsOn: ['lead-plan'],
          parallel: true,
          objective: '知识检索与视觉理解并行进行。',
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
    assert.match(result.prompt, /parallel-research|并行取证/);
    assert.match(result.prompt, /knowledge-searcher/);
    assert.match(result.prompt, /vision-understanding/);
    assert.equal(result.phaseRunnerPayload.phases.length, 1);
  });
});
