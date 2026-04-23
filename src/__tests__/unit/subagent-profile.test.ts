import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('subagent performance profile', () => {
  it('detects local code search tasks', async () => {
    const { isLocalCodeSearchTask } = await import('../../lib/subagent-profile');
    assert.equal(
      isLocalCodeSearchTask('在 /Users/horsray/Documents/codepilot/CodePilot 项目中搜索 "tool_files" 关键字出现在哪些文件，并返回文件路径和代码片段'),
      true,
    );
  });

  it('does not classify web research as local code search', async () => {
    const { isLocalCodeSearchTask } = await import('../../lib/subagent-profile');
    assert.equal(
      isLocalCodeSearchTask('联网查一下 OpenAI 最新官方文档里 responses API 的变更'),
      false,
    );
  });

  it('shrinks search agent max steps and tools for local code lookup', async () => {
    const { buildSubAgentExecutionProfile } = await import('../../lib/subagent-profile');
    const profile = buildSubAgentExecutionProfile({
      id: 'search',
      displayName: 'Search',
      description: 'search',
      mode: 'subagent',
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'web_search', 'codepilot_open_browser'],
      maxSteps: 25,
    }, '在项目中搜索 agent-loop.ts 里 tool_result 的处理逻辑');

    assert.equal(profile.mode, 'local_code_search');
    assert.equal(profile.initialStatus, '准备代码检索');
    assert.deepEqual(profile.sla, { softMs: 20_000, hardMs: 60_000 });
  });

  it('keeps default profile for non-search executors', async () => {
    const { buildSubAgentExecutionProfile } = await import('../../lib/subagent-profile');
    const profile = buildSubAgentExecutionProfile({
      id: 'executor',
      displayName: 'Executor',
      description: 'execute',
      mode: 'subagent',
      disallowedTools: ['Agent'],
      maxSteps: 40,
    }, '修改三个文件并补测试');

    assert.equal(profile.mode, 'default');
    assert.equal(profile.initialStatus, '等待模型响应');
    assert.deepEqual(profile.sla, { softMs: 60_000, hardMs: 180_000 });
  });
});
