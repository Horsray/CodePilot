import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('subagent stream resilience', () => {
  it('forwards keep_alive from nested subagents to the parent stream', () => {
    const agentTool = read('src/lib/tools/agent.ts');
    const agentMcp = read('src/lib/agent-mcp.ts');
    const teamRunner = read('src/lib/team-runner.ts');

    assert.match(agentTool, /event\.type === 'keep_alive'/);
    assert.match(agentMcp, /event\.type === 'keep_alive'/);
    assert.match(teamRunner, /event\.type === 'keep_alive'/);
  });

  it('persists aborted turns and subagent blocks in chat route collection', () => {
    const route = read('src/app/api/chat/route.ts');
    assert.match(route, /event\.type === 'aborted'/);
    assert.match(route, /b\.type === 'tool_use' \|\| b\.type === 'tool_result' \|\| b\.type === 'thinking' \|\| b\.type === 'sub_agents'/);
  });

  it('routes /team deterministically through runTeamPipeline instead of prompt-only orchestration', () => {
    // [DISABLED] CodePilot 原生 /team 命令已停用，改由 OMC 驱动多 Agent 协作
    // /team 现在走正常 agent-loop 流程，不再直接调用 runTeamPipeline
    const route = read('src/app/api/chat/route.ts');
    const teamRunner = read('src/lib/team-runner.ts');
    // route.ts 中 /team 入口已被注释，确认不再包含活跃的 isTeamCommand 逻辑
    // 注释中仍保留 isTeamCommand 字样，但不再是活跃代码
    assert.match(route, /\/team.*已停用|DISABLED.*\/team/);
    assert.match(teamRunner, /Team Job/);
  });

  it('treats native Task tool usage as first-class subagent lifecycle in the SDK path', () => {
    const claudeClient = read('src/lib/claude-client.ts');

    assert.match(claudeClient, /name === 'Task'/);
    assert.match(claudeClient, /subtype === 'task_started'/);
    assert.match(claudeClient, /subtype === 'task_progress'/);
    assert.match(claudeClient, /subtype === 'task_notification'/);
    assert.match(claudeClient, /type: 'subagent_start'/);
    assert.match(claudeClient, /type: 'subagent_complete'/);
  });

  it('recovers persisted Task tool blocks into subagent cards after reload', () => {
    const messageItem = read('src/components/chat/MessageItem.tsx');

    assert.match(messageItem, /lower === 'task'/);
    assert.match(messageItem, /input\.subagent_type \|\| input\.task_type/);
    assert.match(messageItem, /input\.displayName \|\| input\.display_name \|\| input\.name \|\| agentId/);
  });
});
