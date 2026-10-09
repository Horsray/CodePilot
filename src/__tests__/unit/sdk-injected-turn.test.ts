import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SdkInjectedTurnTracker,
  detectSdkInjectedUserTurn,
  isFinalUserTurnResult,
  isSyntheticSubagentToolName,
  shouldGracefullyFinalizeBackgroundTask,
} from '@/lib/claude-client';

// 中文注释：真实样本。取自 ~/.claude/projects/.../442780eb-*.jsonl 里 SDK 实际注入的
// 合成 user 消息——本机排查「助手桥接微信答非所问」时抓到的原始报文，字段顺序与
// 额外标签（tool-use-id / output-file）都保持原样，用来锁死解析的健壮性。
const TASK_NOTIFICATION = `<task-notification>
<task-id>bwehs6gf3</task-id>
<tool-use-id>call_7dd060ae65f042d8b7d69a16</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-horsray-Documents-codepilot-agentHelper/442780eb-b56d-403f-b313-dd057f817acd/tasks/bwehs6gf3.output</output-file>
<status>completed</status>
<summary>Background command "建立SSH隧道到远程数据库" completed (exit code 0)</summary>
</task-notification>`;

describe('detectSdkInjectedUserTurn', () => {
  it('识别 SDK 注入的 <task-notification> 并抽出状态与摘要', () => {
    const result = detectSdkInjectedUserTurn(TASK_NOTIFICATION);

    assert.ok(result, '应当识别为注入消息');
    assert.equal(result.source, 'task-notification');
    assert.match(result.summary, /^completed · /);
    assert.match(result.summary, /Background command "建立SSH隧道到远程数据库" completed/);
    assert.match(result.summary, /task bwehs6gf3$/);
    // 额外的 tool-use-id / output-file 标签不应污染摘要
    assert.doesNotMatch(result.summary, /call_7dd060ae/);
    assert.doesNotMatch(result.summary, /\.output/);
  });

  it('前导空白不影响识别', () => {
    assert.ok(detectSdkInjectedUserTurn(`\n\n  ${TASK_NOTIFICATION}`));
  });

  it('普通用户输入不会被误判', () => {
    assert.equal(detectSdkInjectedUserTurn('我说的是用户名。你仔细看看代码'), null);
    // 正文里提到标签也不算——只有开头的注入块才认
    assert.equal(detectSdkInjectedUserTurn('为什么会有 <task-notification> 这种东西？'), null);
  });

  it('非字符串内容不会误判', () => {
    assert.equal(detectSdkInjectedUserTurn([{ type: 'tool_result', content: 'x' }]), null);
    assert.equal(detectSdkInjectedUserTurn(undefined), null);
    assert.equal(detectSdkInjectedUserTurn({ type: 'text', text: TASK_NOTIFICATION }), null);
  });

  it('摘要缺失时回退为固定文案，且长度受控', () => {
    const bare = detectSdkInjectedUserTurn('<task-notification></task-notification>');
    assert.ok(bare);
    assert.equal(bare.summary, 'background task finished');

    const long = detectSdkInjectedUserTurn(
      `<task-notification><summary>${'长'.repeat(500)}</summary></task-notification>`,
    );
    assert.ok(long);
    assert.equal(long.summary.length, 300);
  });
});

describe('isSyntheticSubagentToolName', () => {
  it('识别 CodePilot MCP 前缀的 Agent/Team，避免后台子任务未登记就结束主轮', () => {
    assert.equal(isSyntheticSubagentToolName('mcp__codepilot-agent__Agent'), true);
    assert.equal(isSyntheticSubagentToolName('mcp__codepilot-team__Team'), true);
    assert.equal(isSyntheticSubagentToolName('mcp__third-party__Agent'), false);
  });
});

describe('SdkInjectedTurnTracker', () => {
  it('普通轮次：注入消息到来前一切正常转发', () => {
    const tracker = new SdkInjectedTurnTracker();

    assert.equal(tracker.markUserMessage('帮我看下这段代码'), null);
    assert.equal(tracker.shouldSuppress('assistant'), false);
    assert.equal(tracker.shouldSuppress('stream_event'), false);
    assert.equal(tracker.isInjectedTurn, false);
    assert.equal(tracker.onResult(), 'turn_completed');
  });

  it('本轮答完后来的通知：抑制该轮的可见输出，但放行 system 与 result', () => {
    const tracker = new SdkInjectedTurnTracker();
    tracker.onResult(); // 用户这一轮结束

    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    assert.equal(tracker.isInjectedTurn, true);

    assert.equal(tracker.shouldSuppress('assistant'), true);
    assert.equal(tracker.shouldSuppress('stream_event'), true);
    assert.equal(tracker.shouldSuppress('tool_use'), true);
    assert.equal(tracker.shouldSuppress('tool_result'), true);
    // system 维持模式/任务状态，result 是关闭标记的信号，必须放行
    assert.equal(tracker.shouldSuppress('system'), false);
    assert.equal(tracker.shouldSuppress('result'), false);

    // 注入轮自己的 result 关闭抑制，之后恢复正常转发
    assert.equal(tracker.onResult(), 'internal_end');
    assert.equal(tracker.isInjectedTurn, false);
    assert.equal(tracker.shouldSuppress('assistant'), false);
  });

  it('通知在本轮回答途中到达：先不抑制，等本轮 result 后再接管', () => {
    const tracker = new SdkInjectedTurnTracker();

    // 用户本轮已经开始回答（出现过 assistant 输出）后才收到通知——
    // 此时若立刻抑制，会把用户自己的回答吞掉
    tracker.markAssistantMessage();
    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    assert.equal(tracker.isInjectedTurn, true, '已识别为注入轮次，回滚锚点应当跳过');
    assert.equal(tracker.shouldSuppress('assistant'), false, '用户自己的输出必须照常转发');
    assert.equal(tracker.shouldSuppress('result'), false);

    // 用户本轮 result 到达：从这一刻起进入抑制态，承接随后那一轮模型输出
    assert.equal(tracker.onResult(), 'suppressed_start');
    assert.equal(tracker.shouldSuppress('assistant'), true);
    assert.equal(tracker.shouldSuppress('stream_event'), true);

    // 注入轮结束
    assert.equal(tracker.onResult(), 'internal_end');
    assert.equal(tracker.shouldSuppress('assistant'), false);
  });

  it('上一轮残留的通知在流开始就出现：立即抑制，不让旧回复泄漏', () => {
    const tracker = new SdkInjectedTurnTracker();

    // 新一流开始，尚未出现任何 assistant 输出就来了注入消息 = 上一轮残留
    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    assert.equal(tracker.shouldSuppress('assistant'), true, '残留轮的旧回复必须被吞掉');
    assert.equal(tracker.shouldSuppress('stream_event'), true);

    // 残留轮 result 到达，恢复正常转发——用户本轮真实回答照常输出
    assert.equal(tracker.onResult(), 'internal_end');
    assert.equal(tracker.shouldSuppress('assistant'), false);
  });

  it('全部子 Agent 完成后的最终汇总轮：放行输出作为统一回复', () => {
    const tracker = new SdkInjectedTurnTracker();
    tracker.onResult(); // 用户本轮结束

    // 标记最终汇总轮
    tracker.forwardFinalTurn = true;
    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    assert.equal(tracker.shouldSuppress('assistant'), false, '最终汇总轮的输出应当放行');
    assert.equal(tracker.shouldSuppress('stream_event'), false);

    // 汇总轮 result 正常收尾
    tracker.markAssistantMessage();
    assert.equal(tracker.onResult(), 'turn_completed');
  });

  it('子 Agent 完成通知后的空 result 不能被当成父 Agent 的最终回复', () => {
    const tracker = new SdkInjectedTurnTracker();
    tracker.onResult(); // 父 Agent 已派发后台任务，原始轮次不能在此结束会话

    tracker.forwardFinalTurn = true;
    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));

    // SDK 可能在没有任何父 Agent 可见输出时发出 result；这只是子任务通知轮结束。
    const transition = tracker.onResult();
    assert.equal(transition, 'internal_end');
    assert.equal(isFinalUserTurnResult(transition, 0), false);
  });

  it('子 Agent 先完成时，父轮排队中的首个 result 必须等待最终汇总', () => {
    const tracker = new SdkInjectedTurnTracker();

    // task_notification 可在父轮的 result 之前到达：此时子任务已完成，
    // 但 SDK 尚未注入父 Agent 的最终汇总轮。
    tracker.forwardFinalTurn = true;
    const parentTransition = tracker.onResult();

    assert.equal(parentTransition, 'turn_completed');
    assert.equal(
      isFinalUserTurnResult(parentTransition, 0, tracker.hasPendingFinalSummary),
      false,
    );

    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    tracker.markAssistantMessage();
    const summaryTransition = tracker.onResult();
    assert.equal(
      isFinalUserTurnResult(summaryTransition, 0, tracker.hasPendingFinalSummary),
      true,
    );
  });

  it('真实场景回放：SSH 隧道任务通知不再被当成用户问题的回答', () => {
    // 现场还原（session 1616e2a8407b9517f47501dac8385824 →
    // sdk_session_id 442780eb-b56d-403f-b313-dd057f817acd）：
    //   用户提问 → 助手正常回答 → result → 隧道任务 60s 后结束，SDK 注入通知
    //   → SDK 自动再跑一轮，吐出「SSH 隧道任务已完成 📮 还在等你回复呢～」
    // 修复前这一轮被并进用户回复缓冲区，落库时贴到用户下一条消息的时间戳上，
    // 看起来就成了「答非所问」，Bridge 场景还会直接推到微信。
    const tracker = new SdkInjectedTurnTracker();

    // 1) 用户提问，本轮正常开始
    assert.equal(tracker.markUserMessage('我说的是用户名。你仔细看看代码，基本逻辑搞清楚'), null);
    assert.equal(tracker.shouldSuppress('assistant'), false);
    assert.equal(tracker.shouldSuppress('stream_event'), false);

    // 2) 本轮正常结束
    assert.equal(tracker.onResult(), 'turn_completed');
    assert.equal(tracker.shouldSuppress('assistant'), false);

    // 3) 隧道任务结束，SDK 注入通知 —— 抑制开始
    assert.ok(tracker.markUserMessage(TASK_NOTIFICATION));
    assert.equal(tracker.shouldSuppress('assistant'), true, '自动回答不得外发');
    assert.equal(tracker.shouldSuppress('stream_event'), true, '流式增量同样不得外发');

    // 4) 注入轮自己的 result 收尾，恢复正常
    assert.equal(tracker.onResult(), 'internal_end');
    assert.equal(tracker.shouldSuppress('assistant'), false, '下一轮真实对话照常转发');
  });

  it('连续多次通知不会漏掉关闭动作', () => {
    const tracker = new SdkInjectedTurnTracker();
    tracker.onResult();

    tracker.markUserMessage(TASK_NOTIFICATION);
    assert.equal(tracker.onResult(), 'internal_end');

    tracker.markUserMessage(TASK_NOTIFICATION);
    assert.equal(tracker.shouldSuppress('assistant'), true);
    assert.equal(tracker.onResult(), 'internal_end');
    assert.equal(tracker.shouldSuppress('assistant'), false);
  });
});

describe('isFinalUserTurnResult', () => {
  it('在没有后台子任务时，立即把用户轮 result 视为最终终态', () => {
    assert.equal(isFinalUserTurnResult('turn_completed', 0), true);
  });

  it('后台子任务尚未回报时，不把首个 result 当成最终终态', () => {
    assert.equal(isFinalUserTurnResult('turn_completed', 1), false);
  });

  it('内部注入轮 result 不能结束用户轮', () => {
    assert.equal(isFinalUserTurnResult('internal_end', 0), false);
    assert.equal(isFinalUserTurnResult('suppressed_start', 0), false);
  });
});

describe('shouldGracefullyFinalizeBackgroundTask', () => {
  it('仅在最后一个后台子任务成功完成且缺少父级汇总时走正常收尾', () => {
    assert.equal(shouldGracefullyFinalizeBackgroundTask('completed', 0), true);
  });

  it('失败或仍有其他后台子任务时不能伪装成成功', () => {
    assert.equal(shouldGracefullyFinalizeBackgroundTask('failed', 0), false);
    assert.equal(shouldGracefullyFinalizeBackgroundTask('killed', 0), false);
    assert.equal(shouldGracefullyFinalizeBackgroundTask('completed', 1), false);
  });
});
