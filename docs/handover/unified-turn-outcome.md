# 统一任务终止态模型（TurnOutcome）技术交接

> 产品思考见 [docs/insights/unified-turn-outcome.md](../insights/unified-turn-outcome.md)
> 执行计划见 [docs/exec-plans/completed/unified-turn-outcome.md](../exec-plans/completed/unified-turn-outcome.md)

## 一句话概览

终止态从「9 处合成字符串 + 5 处各自重新分类 + 渲染时反向解析中文散文」重构为**单一推导表**（`src/lib/turn-outcome.ts`）驱动的两层模型：`TurnOutcome` 大类落库到 `messages.outcome` 列，`terminal_reason` 细因驱动徽章文案与动作。所有 UI 面（消息底部徽标 / 系统通知 / 徽章 / phase）结论一致。

## 两层模型

| 层 | 值 | 用途 |
|----|----|------|
| `TurnOutcome`（大类） | `completed` / `cancelled` / `upstream_error` / `upstream_interrupted` / `stalled` / `graceful_stopped` / `tool_timeout` / `stopped` | 所有 UI 面的**一致判定标准**；落库 `messages.outcome` |
| `terminal_reason`（细因） | SDK 原生值（`max_turns`、`prompt_too_long`…）+ fork 扩展（`background_wait_timeout`、`tool_timeout`…） | 驱动徽章文案 / 动作按钮 / 正文说明；落库 `messages.terminal_reason` |

判定规则：**UI 一致性只看 outcome，文案细节只看 reason。**

## 核心文件

### `src/lib/turn-outcome.ts` — 唯一推导点

`REASON_TABLE` 总表（23 行），每行声明一个 reason 的全部消费语义：

```ts
interface TurnOutcomeEntry {
  reason: string;
  outcome: TurnOutcome;
  phase: StreamPhase;          // 兼容现有 snapshot.phase
  chip?: { tone; labelKey } | 'silent';  // 徽章；'silent' = 不渲染
  actions?: TerminalActionId[];           // 徽章动作按钮
  messageNote?: string;                   // 正文说明（支持 {toolName}/{elapsedSeconds} 占位符）
  notification?: { title; body };         // 系统通知（缺省 = 不发）
}
```

导出函数：

| 函数 | 语义 |
|------|------|
| `outcomeFromReason(reason, {isError})` | 唯一分类入口：isError → `upstream_error`；无 reason → `completed`；未知 reason → `stopped` |
| `phaseForReason(reason, {isError})` | 终态 → `StreamPhase`（替换 stream-session-manager 的硬编码清单） |
| `chipForReason(reason)` | 徽章配置；未知 reason 无条目 → 不渲染（fail-safe 静默） |
| `actionsForReason(reason)` | 徽章动作（未知 → 空） |
| `noteForReason(reason, ctx)` | 正文说明散文，由表生成（替换原 if 链） |
| `notificationForReason(reason, {isError})` | 通知（isError / 手动中断 → null） |
| `deriveServerOutcome({abortReason, hasError, terminalReason})` | 服务端落库推导（route.ts 专用） |
| `isKnownOutcome(v)` | 8 大类类型守卫 |
| `TURN_OUTCOME_META` | 大类 → 消息底部徽标（status: completed/interrupted/failed + i18n labelKey） |

**新增终止原因只需在 `REASON_TABLE` 加一行**，所有消费点自动生效。禁止在各消费点手写补丁。

### 数据落库

- `messages` 表新增 `outcome TEXT`、`terminal_reason TEXT` 列（`safeAddColumn` 迁移，`src/lib/db.ts`）
- `addMessage` 签名追加两个可选参数；`Message` 类型同步（`src/types/index.ts`）
- 服务端 `src/app/api/chat/route.ts` 在 result / aborted / catch 三条保存路径统一调 `deriveServerOutcome` 后落库，通知改由 `notificationForReason` 投递
- 旧消息（NULL）走 MessageItem legacy 散文解析降级，**不迁移历史数据**

### 服务端单终态守卫

`src/lib/claude-client.ts` 新增 `terminalEmitted` 标志：每轮只允许一个终态帧（result 或 aborted）。修复「stalled / 工具看门狗先发 aborted、iterator 随后抛错又补发 error 帧覆盖真实原因」的双重终态 bug。所有终态发射点（含 EOF / catch / 看门狗）先置位再发射；catch 路径若守卫已置位则直接 close。

### 消费点改造清单

| 消费点 | 改造 |
|--------|------|
| `src/components/chat/MessageItem.tsx` | `message.outcome` 优先 → `TURN_OUTCOME_META` 驱动底部三色徽标；legacy 解析仅在无 outcome 字段时启用（含悬空工具 / chat-error 代码原样保留） |
| `src/components/chat/TerminalReasonChip.tsx` | 纯渲染组件：chip/actions 全部读表；无条目或 silent → 不渲染（删除「本轮已结束」白名单兜底） |
| `src/lib/stream-session-manager.ts` | onResult 回调的正文说明 if 链（约 60 行）替换为 `noteForReason` 表驱动；finalPhase 由 `phaseForReason` 推导；tool_timeout 快照信息优先锁定 reason |
| `src/hooks/useStreamSubscription.ts` | 临时 assistant 消息构造统一走 `buildTempAssistantMessage`，携带 `outcomeFromReason(snapshot.terminalReason)`，保证 reconcile 前后状态一致 |
| `src/i18n/zh.ts` / `en.ts` | 新增 7 个 `terminal.*` 键 + 8 个 `turnOutcome.*` 键 |

## 关键映射速查

| reason | outcome | phase | 徽章 | 通知 |
|--------|---------|-------|------|------|
| （无 reason） | completed | completed | — | 「任务已完成」 |
| user_cancel | cancelled | stopped | silent | 不发 |
| error | upstream_error | error | silent | 不发 |
| max_turns / prompt_too_long / blocking_limit / rapid_refill_breaker / image_error / model_error / length | upstream_error | completed | 有（带动作） | 不发 |
| upstream_interrupted | upstream_interrupted | aborted | warning | 「任务中断」 |
| connection_lost | upstream_interrupted | completed | info | 不发 |
| stalled | stalled | aborted | error | 「任务已中止」 |
| background_wait_timeout / background_finalization_graceful | graceful_stopped | completed | info | 「本轮已收尾」 |
| background_finalization_timeout（历史死值） | graceful_stopped | aborted | warning | 「任务已中止」 |
| tool_timeout | tool_timeout | aborted | warning | 「任务已中止」 |
| hook_stopped / stop_hook_prevented | stopped | aborted | muted | 不发 |
| tool_deferred | completed | completed | info | 不发 |
| 未知 reason | stopped | aborted | 不渲染 | 不发 |

## 测试

- `src/__tests__/unit/turn-outcome.test.ts` — 总表完整性（23 reason 全枚举）、分类规则、用户报告的原矛盾场景、占位符、通知策略、deriveServerOutcome 优先级，27 用例
- 回归：`background-bash-hold`、`manual-interrupt-preservation`、`persistent-claude-session-drain`、`subagent-stream-resilience`
- 运行方式：`npx tsx --test src/__tests__/unit/xxx.test.ts`（`npm run test` 是 no-op，见项目 memory）

## 范围外

- 飞书/telegram 通道的 completed/interrupted/error 判定（独立状态机，本次只透传不重构）
- 通知投递链路实时性（4 分钟延迟另有轮询链路问题，不在本模型范围）
