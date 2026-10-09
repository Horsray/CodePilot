# 统一任务终止态模型（TurnOutcome）

> 创建时间：2026-10-10
> 最后更新：2026-10-10

## 背景

用户报告「一会中断了任务却是完成的，一会完成了任务却是中断的」，徽章出现「本轮已结束」随即消失。根因审计确认：**终止态从未被当作数据建模**，而是由 9 个产生点各自合成 reason 字符串、5 个推导点各自重新分类、渲染时反向解析正文里的中文散文推断状态。同一条消息在不同界面（消息底部徽标 / 通知 / 徽章 / 会话列表）结论互相矛盾。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 定义 TurnOutcome 枚举 + 单一推导表（src/lib/turn-outcome.ts） | ✅ 完成 | 8 大类 + 23 行 REASON_TABLE |
| Phase 2 | 落库：messages 加 outcome / terminal_reason 列，服务端写入 | ✅ 完成 | safeAddColumn 迁移；deriveServerOutcome 统一推导 |
| Phase 3 | 消费点接入：MessageItem 状态徽标、通知分类、TerminalReasonChip、finalPhase | ✅ 完成 | 全部消费点改读表；terminalEmitted 单终态守卫 |
| Phase 4 | 测试 + 文档 + CDP 验证 | ✅ 完成 | 27 用例全绿；回归 67 用例 0 失败；handover+insights 文档对已交付；CDP 实测正常完成/手动中断两场景通过（优雅收尾场景由单测与代码路径审查覆盖） |

## 决策日志

- 2026-10-10: 终止态分两层：`TurnOutcome`（大类，所有 UI 面的统一判定标准）+ `terminal_reason`（细因，驱动徽章文案与动作按钮）。UI 一致性只看 outcome，文案细节只看 reason。
- 2026-10-10: 新增 reason 只需在 turn-outcome.ts 总表加一行——取代此前「每加一个原因要改 4 个文件还互相打架」的补丁模式。
- 2026-10-10: 旧消息（无 outcome 字段）保留 MessageItem 现有解析作为 legacy 降级；新消息绝不走散文解析。不迁移历史数据。
- 2026-10-10: **未知 reason → stopped + 完全静默**（无徽章、无通知、无正文说明），绝不误报「任务完成」，也绝不渲染黄色警示。比初版「按语义映射 muted 徽章」更安全——fail-safe 静默。
- 2026-10-10: TurnOutcome 最终定为 8 值（初版 7 值 + `stopped`）：`stopped` 承载「本轮已结束但原因未知」（未知 reason、hook 中止、aborted 兜底），语义上区别于 cancelled（明确手动中断）。
- 2026-10-10: 服务端落库推导 `deriveServerOutcome` 优先级：明确中止原因（user_cancel/stalled/upstream_interrupted/tool_timeout/error）> hasError > result 携带 terminal_reason > completed。
- 2026-10-10: 服务端 `terminalEmitted` 单终态守卫：每轮只允许一个终态帧（result 或 aborted），修复「stalled/工具看门狗先发 aborted、iterator 再抛错补发 error 帧覆盖真实原因」的双重终态 bug。
- 2026-10-10: `background_finalization_timeout` 服务端已不再发出（死代码），表中保留映射防止旧数据/旧版本回流误判。
- 2026-10-10: 徽章动作 id 迁移入 turn-outcome.ts（ACTION_LABEL_KEYS / ACTION_VARIANTS），TerminalReasonChip 只做渲染。
- 2026-10-10: **宽限竞态兜底捕获**（claude-client.ts stream_event 转发点）：主回合 result 被拦下后，任何真正转发给用户的主线程正文即置位 `summaryRelayed`，不再依赖注入轮识别（forwardFinalTurn/finalSummaryTurn）。修复「总结已展示给用户、宽限到期却误报『未等到最终汇总』」的竞态。子 Agent 帧（parentAgentId）不计入。
- 2026-10-10: CDP 实测结论：正常完成 → 「任务完成」绿标无徽章；手动中断 → 「任务中断」+ 思考全收进折叠卡片 + 无徽章（user_cancel silent）+ 无重复消息。曾一度出现「本轮已结束」徽章，定位为 dev server HMR 失效跑旧代码，刷新后消失——新代码行为正确。

## 详细设计

### 现状审计（问题清单）

**数据模型**：messages 表无终止态字段；`StreamSnapshot.terminalReason` 是内存态，流结束即消失。

**9 个产生点**：
1. SDK 原生 `terminal_reason`（claude-client.ts:3404）
2. `is_error` → 硬编码 `'error'`（:3420，覆盖原生 reason）
3. `background_finalization_graceful`（最终汇总宽限到期，:2477）
4. `background_wait_timeout`（15 分钟等待上限，:2530）
5. `upstream_interrupted`（status 事件，:3541）
6. `stalled`（全流无进度看门狗）
7. `user_cancel`
8. `background_finalization_timeout`（后台任务返回但主任务未接收）
9. `connection_lost`（前端本地合成，stream-session-manager.ts:1329）

**5 个推导点**（互相打架）：
1. useSSEStream.ts:601 — EOF 无终态兜底 `upstream_interrupted`
2. stream-session-manager.ts:1112-1120 — 硬编码字符串清单 → finalPhase；graceful/wait_timeout/connection_lost 故意判 completed
3. stream-session-manager.ts:1029-1067 — 按 reason 往正文写中文散文
4. MessageItem.tsx:638-735 — 渲染时**反向解析正文散文**（含 6 段中文子串匹配 + chat-error 解析 + 悬空工具判定）→ completed/interrupted/failed
5. TerminalReasonChip.tsx:102-113 — 10 项白名单，其余 → 黄徽章「本轮已结束」

**消费点矛盾实例**：
- `background_wait_timeout`：phase=completed + 通知「任务已完成」，但 MessageItem 从散文解析出 interrupted → 黄「任务中断」。同一条消息自相矛盾。
- `stalled`：通知「任务已完成」（route.ts:1096 只判 hasError/user_cancel），消息底部黄「任务中断」。反方向矛盾。
- fork 自定义 reason 不在白名单 → 「本轮已结束」误报，快照消费后消失（用户看到的"过一会自己没了"）。

### 目标模型

```ts
// types/index.ts（最终 8 值）
export type TurnOutcome =
  | 'completed'              // 正常完成
  | 'cancelled'              // 用户手动中断
  | 'upstream_error'         // 模型上游报错（is_error / HTTP / 鉴权 / 限流）
  | 'upstream_interrupted'   // 上游连接中断（EOF 无终态 / 连接丢失）
  | 'stalled'                // 上游长时间无响应（看门狗）
  | 'graceful_stopped'       // 优雅收尾（宽限到期 / 等待上限 / 汇总未接收）
  | 'tool_timeout'           // 工具无进度超时
  | 'stopped';               // 本轮已结束但原因未知（未知 reason / hook 中止）
```

### 单一推导点：src/lib/turn-outcome.ts

一张总表，每行声明一个 reason 的全部消费语义：

```ts
interface TurnOutcomeEntry {
  reason: string;
  outcome: TurnOutcome;
  phase: StreamPhase;                    // 兼容现有 snapshot.phase
  chip?: { tone: Tone; silent?: boolean; actions?: TerminalActionId[] }; // 徽章
  messageNote?: string;                  // 正文说明（用户可读散文，由表生成）
  notification?: { titleKey: string; bodyKey: string };  // 通知（null = 不发）
}
```

导出函数：
- `outcomeFromReason(reason, isError)` — 唯一分类入口；未知 reason 按语义最接近大类映射
- `entryForReason(reason)` — chip / note / notification 消费
- `legacyTextStatus(message)` — 仅旧消息降级用（迁自 MessageItem 现有解析）

### 落库

- `messages` 表 safeAddColumn：`outcome TEXT`、`terminal_reason TEXT`（db.ts 迁移）
- `addMessage` 加可选参数；route.ts 落库时写入最终 outcome/reason
- user_cancel 路径（route.ts:1123 catch）写入 `cancelled`
- `Message` 类型加 `outcome?: TurnOutcome | null`、`terminal_reason?: string | null`
- 前端本地合成（user_cancel / connection_lost）由服务端最终落库覆盖，不另写

### 消费点改造

| 消费点 | 改造 |
|--------|------|
| MessageItem.tsx | 读 `message.outcome` 决定绿/黄/红徽标与文案；散文解析降级为 legacy（仅无 outcome 字段的旧消息） |
| TerminalReasonChip.tsx | 白名单并入总表（fork reason 补全）；tone 由 outcome 大类决定；未知 reason → muted，不再「本轮已结束」警示 |
| route.ts 通知 | 按 outcome：completed →「任务已完成」；graceful_stopped →「本轮已收尾，后台任务仍在运行」；interrupted/stalled/tool_timeout →「任务中断」+ 原因；cancelled → 不发 |
| stream-session-manager.ts | finalPhase 与正文散文改由总表推导，删除硬编码清单与手写散文 |
| claude-client.ts | 合成终态的 reason 字符串收拢为常量（至少 9 处不再手写） |

### 范围外（后续对齐）

- 飞书/telegram 通道的 completed/interrupted/error 判定（独立状态机，本次只透传不重构）
- 通知投递链路实时性（4 分钟延迟另有轮询链路问题，不在本模型范围）

### 验收标准

1. 任何 reason → outcome 映射唯一且全链路一致：消息底部徽标、通知、徽章、phase 结论相同
2. background_wait_timeout / graceful：不再出现「任务完成」通知 +「任务中断」徽标并存
3. stalled / upstream_interrupted：通知明确说中断，不再发「任务已完成」
4. 未知 reason 不出现「本轮已结束」黄色误报
5. 旧消息渲染行为不回退（legacy 降级）
6. `tsx --test` 全绿；CDP 验证正常完成 / 手动中断 / 优雅收尾三种场景
