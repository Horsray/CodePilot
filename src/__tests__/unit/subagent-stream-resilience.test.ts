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
    const route = read('src/app/api/chat/route.ts');
    const teamRunner = read('src/lib/team-runner.ts');
    assert.match(route, /isTeamCommand/);
    assert.match(route, /runTeamPipeline/);
    assert.match(teamRunner, /Team Job/);
  });
});
