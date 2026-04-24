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

  it('uses a local-search SLA profile for code lookup', async () => {
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

  it('keeps analysis prompts on the normal model loop even when a file path is present', async () => {
    const { buildSubAgentExecutionProfile } = await import('../../lib/subagent-profile');
    const profile = buildSubAgentExecutionProfile({
      id: 'search',
      displayName: 'Search',
      description: 'search',
      mode: 'subagent',
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'web_search', 'codepilot_open_browser'],
      maxSteps: 25,
    }, '分析 src/lib/db.ts 中与 message 和 session 相关的数据库表定义：找出 CREATE TABLE 语句、分析表结构和索引、报告 schema 设计特点');

    assert.equal(profile.mode, 'default');
    assert.equal(profile.initialStatus, '等待模型响应');
    assert.deepEqual(profile.sla, { softMs: 30_000, hardMs: 120_000 });
  });

  it('uses a web-lookup SLA profile for simple web searches', async () => {
    const { buildSubAgentExecutionProfile } = await import('../../lib/subagent-profile');
    const profile = buildSubAgentExecutionProfile({
      id: 'search',
      displayName: 'Search',
      description: 'search',
      mode: 'subagent',
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'web_search', 'codepilot_open_browser'],
      maxSteps: 25,
    }, '联网搜索 OpenAI Responses API 最新官方文档');

    assert.equal(profile.mode, 'web_lookup');
    assert.equal(profile.initialStatus, '准备网页检索');
    assert.deepEqual(profile.sla, { softMs: 20_000, hardMs: 75_000 });
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
