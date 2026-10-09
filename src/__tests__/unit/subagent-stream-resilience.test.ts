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

  it('gives a completed background task a bounded final-summary wait', () => {
    const claudeClient = read('src/lib/claude-client.ts');

    assert.match(claudeClient, /const BACKGROUND_FINALIZATION_GRACE_MS = 30_000;/);
    // 到期行为是优雅收尾（用被拦下的主回合 result 发终态），不是 abort 整轮——
    // 2026-10-09 回归修复：原实现到期即 abort，通知在主回合进行中到达时会精准
    // 误杀主回合并触发自动继续死循环。详见 background-bash-hold.test.ts。
    // 收尾归类按 summaryRelayed 二选一，日志文案在公共收尾函数 finishTurnWithHeldResult 内。
    assert.match(claudeClient, /Background final summary did not arrive; finishing the turn gracefully/);
  });

  it('continues a background-finalization timeout without creating a user-visible retry message', () => {
    const manager = read('src/lib/stream-session-manager.ts');
    const turnOutcome = read('src/lib/turn-outcome.ts');
    const chatView = read('src/components/chat/ChatView.tsx');
    const route = read('src/app/api/chat/route.ts');

    assert.match(manager, /background_finalization_timeout/);
    assert.match(manager, /autoTrigger\?: boolean/);
    // 正文说明散文已迁入统一总表（turn-outcome.ts），manager 经 noteForReason 表驱动生成
    assert.match(manager, /noteForReason/);
    assert.match(turnOutcome, /正在自动继续原任务/);
    assert.match(manager, /getStreamsMap\(\)\.get\(stream\.sessionId\) !== stream/);
    assert.match(chatView, /options\?\.autoTrigger/);
    assert.match(chatView, /doStartStream\(retryContent[\s\S]*true\)/);
    assert.doesNotMatch(route, /isGracefulBackgroundFinalization/);
  });

  it('does not publish an SDK result before background agents and the parent summary finish', () => {
    const claudeClient = read('src/lib/claude-client.ts');
    const resultCaseStart = claudeClient.indexOf("case 'result': {");
    const resultCaseEnd = claudeClient.indexOf("default: {", resultCaseStart);
    const resultCase = claudeClient.slice(resultCaseStart, resultCaseEnd);

    assert.ok(resultCaseStart >= 0 && resultCaseEnd > resultCaseStart, 'SDK result handler should exist');
    assert.ok(
      resultCase.indexOf('if (isFinalUserTurnResult(') < resultCase.indexOf("type: 'result'"),
      'only the final user-turn result may be published to the client',
    );
  });

  it('does not block native stream completion on knowledge evolution', () => {
    const agentLoop = read('src/lib/agent-loop.ts');

    assert.match(agentLoop, /void \(async \(\) => \{/);
    assert.match(agentLoop, /Knowledge evolution is best-effort post-turn work/);
  });

  it('recovers persisted Task tool blocks into subagent cards after reload', () => {
    const messageItem = read('src/components/chat/MessageItem.tsx');

    assert.match(messageItem, /lower === 'task'/);
    assert.match(messageItem, /input\.subagent_type \|\| input\.task_type/);
    assert.match(messageItem, /input\.displayName \|\| input\.display_name \|\| input\.name \|\| agentId/);
  });

  it('retires persistent Claude sessions on cancellation so an old task cannot answer a new message', () => {
    const claudeClient = read('src/lib/claude-client.ts');
    const persistentSession = read('src/lib/persistent-claude-session.ts');

    assert.match(claudeClient, /const willConsumeWarmQuery = canReuseWarmup && sessionId && !willReusePersistentSession/);
    assert.match(claudeClient, /Stream cancelled for session[\s\S]*discarded persistent session to prevent cross-turn events/);
    assert.match(claudeClient, /closePersistentClaudeSession\(sessionId, persistentQueryForStream\)/);
    // 中文注释：retire 仅在不处于后台任务排空期时执行——排空期杀进程会连带
    // 杀掉还在运行的 run_in_background 任务（窜会话根因修复的一部分）。
    assert.match(persistentSession, /turnReserved && !entry\.backgroundWaitActive\)[\s\S]*Retiring active session before starting a new user turn/);
    assert.doesNotMatch(persistentSession, /force-resetting lock chain/);
  });

  it('treats an SDK interrupt as user cancellation before error classification', () => {
    const claudeClient = read('src/lib/claude-client.ts');
    const catchStart = claudeClient.indexOf('} catch (error) {\n        clearBackgroundWaitTimer();\n        if (agentWaitKeepAliveTimer) clearInterval(agentWaitKeepAliveTimer);');
    const rawMessage = claudeClient.indexOf("const rawMessage = error instanceof Error ? error.message : 'Unknown error';", catchStart);
    const classifier = claudeClient.indexOf('const classified = classifyError({', rawMessage);
    const cancellationGuard = claudeClient.indexOf("if (abortController?.signal.reason === 'user_cancel' && !watchdogAborted)", catchStart);

    assert.ok(catchStart >= 0 && rawMessage > catchStart && classifier > rawMessage, 'SDK stream error handler should classify real errors');
    assert.ok(
      cancellationGuard > catchStart && cancellationGuard < rawMessage,
      'a user-requested abort must be finalized before it can become a task error',
    );
  });
});
