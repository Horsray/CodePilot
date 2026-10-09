import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryForReason,
  outcomeFromReason,
  phaseForReason,
  chipForReason,
  actionsForReason,
  noteForReason,
  notificationForReason,
  deriveServerOutcome,
  isKnownOutcome,
  TURN_OUTCOME_META,
} from '../../lib/turn-outcome';

describe('turn-outcome 统一终止态总表', () => {
  describe('REASON_TABLE 完整性：每个 reason 的 outcome/phase 与总表一致', () => {
    // 全量枚举表内所有 reason（防止新增 reason 漏测）
    const ALL_REASONS = [
      'completed', 'user_cancel', 'aborted', 'aborted_streaming', 'aborted_tools',
      'error', 'max_turns', 'prompt_too_long', 'blocking_limit',
      'rapid_refill_breaker', 'image_error', 'model_error', 'length',
      'upstream_interrupted', 'connection_lost', 'stalled',
      'background_wait_timeout', 'background_finalization_graceful',
      'background_finalization_timeout', 'background_summary_received', 'tool_timeout',
      'hook_stopped', 'stop_hook_prevented', 'tool_deferred',
    ];

    it('每个 reason 都能在表里查到条目', () => {
      for (const reason of ALL_REASONS) {
        const entry = entryForReason(reason);
        assert.ok(entry, `reason ${reason} 应有条目`);
        assert.equal(entry.reason, reason);
      }
    });

    it('每个 reason 的 outcomeFromReason / phaseForReason 与表条目一致', () => {
      for (const reason of ALL_REASONS) {
        const entry = entryForReason(reason)!;
        assert.equal(outcomeFromReason(reason), entry.outcome, `outcome(${reason})`);
        assert.equal(phaseForReason(reason), entry.phase, `phase(${reason})`);
      }
    });

    it('每个 outcome 大类都有 TURN_OUTCOME_META（消息底部徽标文案）', () => {
      const outcomes = new Set(ALL_REASONS.map(r => entryForReason(r)!.outcome));
      for (const outcome of outcomes) {
        assert.ok(TURN_OUTCOME_META[outcome], `outcome ${outcome} 应有底部徽标 meta`);
        assert.ok(TURN_OUTCOME_META[outcome].labelKey, `outcome ${outcome} 应有 labelKey`);
      }
    });
  });

  describe('核心分类规则', () => {
    it('无 reason 且无错误 → completed（SDK/CLI 正常结束不携带 reason）', () => {
      assert.equal(outcomeFromReason(null), 'completed');
      assert.equal(outcomeFromReason(undefined), 'completed');
      assert.equal(outcomeFromReason(''), 'completed');
      assert.equal(phaseForReason(null), 'completed');
    });

    it('isError 是最高优先级信号 → upstream_error', () => {
      assert.equal(outcomeFromReason('completed', { isError: true }), 'upstream_error');
      assert.equal(outcomeFromReason(null, { isError: true }), 'upstream_error');
      assert.equal(phaseForReason(null, { isError: true }), 'error');
    });

    it('未知 reason → stopped（绝不误报「任务完成」），且无徽章、无动作、无通知、无正文说明', () => {
      assert.equal(outcomeFromReason('future_sdk_new_value'), 'stopped');
      assert.equal(phaseForReason('future_sdk_new_value'), 'aborted');
      assert.equal(chipForReason('future_sdk_new_value'), undefined);
      assert.deepEqual(actionsForReason('future_sdk_new_value'), []);
      assert.equal(noteForReason('future_sdk_new_value'), undefined);
      assert.equal(notificationForReason('future_sdk_new_value'), null);
    });

    it('未知 reason 但 isError → 仍归 upstream_error', () => {
      assert.equal(outcomeFromReason('future_sdk_new_value', { isError: true }), 'upstream_error');
    });

    it('isKnownOutcome 只认 8 个大类', () => {
      assert.equal(isKnownOutcome('completed'), true);
      assert.equal(isKnownOutcome('graceful_stopped'), true);
      assert.equal(isKnownOutcome('tool_timeout'), true);
      assert.equal(isKnownOutcome('stopped'), true);
      assert.equal(isKnownOutcome('whatever'), false);
      assert.equal(isKnownOutcome(null), false);
      assert.equal(isKnownOutcome(undefined), false);
    });
  });

  describe('用户可见的矛盾场景（用户报告的原矛盾对）', () => {
    it('background_wait_timeout → graceful_stopped + phase completed（不再「完成了却显示中断」）', () => {
      assert.equal(outcomeFromReason('background_wait_timeout'), 'graceful_stopped');
      assert.equal(phaseForReason('background_wait_timeout'), 'completed');
      assert.equal(TURN_OUTCOME_META.graceful_stopped.status, 'interrupted');
      // 通知与徽章按 grace 而非 error 处理
      assert.ok(notificationForReason('background_wait_timeout'));
      const chip = chipForReason('background_wait_timeout');
      assert.ok(chip && chip !== 'silent' && chip.tone === 'info');
    });

    it('background_finalization_graceful → graceful_stopped + phase completed', () => {
      assert.equal(outcomeFromReason('background_finalization_graceful'), 'graceful_stopped');
      assert.equal(phaseForReason('background_finalization_graceful'), 'completed');
    });

    it('background_summary_received → completed（汇总已转发，绝不显示「未等到汇总」）', () => {
      // 竞态修复：汇总输出已转发给用户、注入轮 result 迟到/丢失时按正常完成收尾。
      assert.equal(outcomeFromReason('background_summary_received'), 'completed');
      assert.equal(phaseForReason('background_summary_received'), 'completed');
      assert.equal(chipForReason('background_summary_received'), 'silent');
      assert.equal(noteForReason('background_summary_received'), undefined); // 无「未等到」正文说明
      const n = notificationForReason('background_summary_received');
      assert.ok(n && n.title === '任务已完成'); // 完成态发正常完成通知
    });

    it('user_cancel → cancelled + phase stopped（手动中断就是手动中断）', () => {
      assert.equal(outcomeFromReason('user_cancel'), 'cancelled');
      assert.equal(phaseForReason('user_cancel'), 'stopped');
      assert.equal(TURN_OUTCOME_META.cancelled.status, 'interrupted');
      assert.equal(chipForReason('user_cancel'), 'silent'); // 手动中断用户已知，不渲染徽章
      assert.equal(notificationForReason('user_cancel'), null); // 手动中断不发通知
    });

    it('stalled → stalled + phase aborted（超时就是超时，不归入完成）', () => {
      assert.equal(outcomeFromReason('stalled'), 'stalled');
      assert.equal(phaseForReason('stalled'), 'aborted');
      assert.equal(TURN_OUTCOME_META.stalled.status, 'interrupted');
      const chip = chipForReason('stalled');
      assert.ok(chip && chip !== 'silent' && chip.tone === 'error');
    });

    it('tool_timeout → tool_timeout + phase aborted，且正文说明带工具名与秒数', () => {
      assert.equal(outcomeFromReason('tool_timeout'), 'tool_timeout');
      assert.equal(phaseForReason('tool_timeout'), 'aborted');
      const note = noteForReason('tool_timeout', { toolName: 'Bash', elapsedSeconds: 300 });
      assert.ok(note);
      assert.ok(note.includes('Bash') && note.includes('300'));
      assert.ok(notificationForReason('tool_timeout')); // 卡死要发通知
    });

    it('upstream_interrupted → upstream_interrupted + phase aborted（模型上游就明确模型上游）', () => {
      assert.equal(outcomeFromReason('upstream_interrupted'), 'upstream_interrupted');
      assert.equal(phaseForReason('upstream_interrupted'), 'aborted');
      assert.ok(notificationForReason('upstream_interrupted'));
    });

    it('error → upstream_error + phase error（错误态明确，不发通知、不加徽章）', () => {
      assert.equal(outcomeFromReason('error'), 'upstream_error');
      assert.equal(phaseForReason('error'), 'error');
      assert.equal(TURN_OUTCOME_META.upstream_error.status, 'failed');
      assert.equal(chipForReason('error'), 'silent');
      assert.equal(notificationForReason('error'), null);
    });

    it('限流类（max_turns 等）→ upstream_error 但 phase completed（回复已完整产出）', () => {
      for (const r of ['max_turns', 'prompt_too_long', 'blocking_limit', 'length']) {
        assert.equal(outcomeFromReason(r), 'upstream_error', `outcome(${r})`);
        assert.equal(phaseForReason(r), 'completed', `phase(${r})`);
      }
    });
  });

  describe('noteForReason 占位符', () => {
    it('无 toolName 时用「未知工具」兜底，无 elapsedSeconds 用 0', () => {
      const note = noteForReason('tool_timeout')!;
      assert.ok(note.includes('未知工具'));
      assert.ok(note.includes('0'));
    });
    it('无说明条目的 reason 返回 undefined', () => {
      assert.equal(noteForReason('completed'), undefined);
    });
  });

  describe('notificationForReason', () => {
    it('isError 时不发通知（错误以界面徽标呈现，避免双重打扰）', () => {
      assert.equal(notificationForReason('error', { isError: true }), null);
      assert.equal(notificationForReason(null, { isError: true }), null);
    });
    it('无 reason 正常完成 → 默认完成通知', () => {
      const n = notificationForReason(null);
      assert.ok(n && n.title === '任务已完成');
    });
    it('无通知条目的 reason → null', () => {
      assert.equal(notificationForReason('user_cancel'), null);
      assert.equal(notificationForReason('max_turns'), null);
    });
    it('completed 大类的 reason → 默认完成通知（SDK 显式携带 terminal_reason: completed 时不丢通知）', () => {
      const n = notificationForReason('completed');
      assert.ok(n && n.title === '任务已完成');
      assert.equal(notificationForReason('tool_deferred')!.title, '任务已完成');
    });
  });

  describe('deriveServerOutcome（服务端落库推导）', () => {
    it('优先级 1：明确中止原因（stalled 等）直接采用', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: 'stalled', hasError: false, terminalReason: 'length' }),
        { outcome: 'stalled', effectiveReason: 'stalled' },
      );
    });
    it('优先级 2：hasError → upstream_error（effectiveReason=error）', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: null, hasError: true, terminalReason: 'completed' }),
        { outcome: 'upstream_error', effectiveReason: 'error' },
      );
    });
    it('优先级 3：result 携带的 terminal_reason', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: null, hasError: false, terminalReason: 'background_wait_timeout' }),
        { outcome: 'graceful_stopped', effectiveReason: 'background_wait_timeout' },
      );
      assert.deepEqual(
        deriveServerOutcome({ abortReason: null, hasError: false, terminalReason: 'max_turns' }),
        { outcome: 'upstream_error', effectiveReason: 'max_turns' },
      );
    });
    it('未知 terminal_reason → stopped 但保留细因', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: null, hasError: false, terminalReason: 'weird_future' }),
        { outcome: 'stopped', effectiveReason: 'weird_future' },
      );
    });
    it('优先级 4：一切正常 → completed', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: null, hasError: false, terminalReason: null }),
        { outcome: 'completed', effectiveReason: null },
      );
    });
    it('非明确中止原因（如 aborted）不抢 hasError 的优先级', () => {
      assert.deepEqual(
        deriveServerOutcome({ abortReason: 'aborted', hasError: true, terminalReason: null }),
        { outcome: 'upstream_error', effectiveReason: 'error' },
      );
    });
  });
});
