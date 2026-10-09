# 后台任务等待收尾（后台 Bash 不再被提前标记完成）

> 产品思考见 [docs/insights/background-task-hold.md](../insights/background-task-hold.md)
> 相关：[SDK 内部轮次抑制](./sdk-injected-turn-suppression.md)（注入轮的识别与抑制，本文是它的"等待侧"补充）

## 问题现象

助手发起了一个**后台 Bash 任务**（如上传/构建/隧道），界面却在任务还没结束时就把这一轮标成「已完成」：

- 过程块收起成「N 个已完成」，消息落定，看起来任务已交付；
- 用户此时再发消息，会被上一轮被挂起的结果（任务完成后的汇报）抢先渲染，表现为"忽略我的消息，直接渲染上一个任务本应该继续的答案"——交互竞态。

根因不是 UI 状态标记写错，而是**服务端过早发布了终态 `result`**：`result` 在协议里是「任务完成」信号，所有下游消费者（前端 `stream-session-manager`、route、bridge）都以它为准收尾。

## 根因

`streamClaude()` 主循环里，SDK 对一次用户轮会先给一个 `result`（父轮回答完毕），然后后台任务结束时会往**同一条 query** 注入 `<task-notification>` 与一轮汇总。此前**只把后台子 Agent（Task 工具）计入了「未完成工作」**：

```ts
isFinalUserTurnResult(turnTransition, pendingAgentToolUse.size, ...)
```

后台 Bash（`Bash` + `run_in_background: true`）不在 `pendingAgentToolUse` 里，于是父轮的第一个 `result` 被判为终态直接发布 ⇒ 界面收尾，但后台任务还在跑；等它结束时注入的汇总轮又打到同一条流上，落库/渲染时机全乱。

## 实现

### 1. 登记（`src/lib/claude-client.ts`）

```ts
export const BASH_TOOL_PATTERN = /^Bash$|^mcp__.*bash$/i;
export function isBackgroundBashToolUse(name: string, input: unknown): boolean
```

- `tool_use` 分支：命中 `run_in_background === true` ⇒ `pendingBackgroundBashTasks.set(block.id, {})`；
- 工具结果的 `is_error` 分支：立即清除（失败的派发不再等待）；
- `task_started` 事件：把 `task_id` 绑到对应 `tool_use_id`（`resolvePendingBackgroundBash`）。

未完成工作的统一口径：

```ts
const totalPendingBackgroundWork = () =>
  pendingAgentToolUse.size + pendingBackgroundBashTasks.size;
```

> `pendingBackgroundBashTasks` 声明在 **try 外**的函数作用域——工具看门狗闭包（循环外的定时器）也需要读它。

### 2. 挂起父轮 result（结果闸门）

`isFinalUserTurnResult(...)` 的第二个参数改为 `totalPendingBackgroundWork()`。闸门命中且仍有后台 Bash 时：

- `heldBackgroundResult = resultMsg`（保存下来给超时收尾补齐 usage/耗时）；
- 发 `status{subtype:'background_task_wait', message:'后台任务仍在运行，等待完成后汇总…'}`；
- `scheduleBackgroundWaitExpiry()` 布防 15 分钟上限；
- `break` —— **不发布该 result**，UI 保持「生成中」。

期间保活心跳（30s 间隔的 `agentWaitKeepAliveTimer`）把条件从 `pendingAgentToolUse.size > 0` 改为 `totalPendingBackgroundWork() > 0`，并持续刷新 `lastStreamActivityAt`（服务端看门狗时钟）。

### 3. 任务回报后的收尾（三种路径）

| 事件 | 处理 |
| --- | --- |
| `task_notification`（bash 分支） | 清除 pending；若 `totalPendingBackgroundWork() === 0` ⇒ `forwardFinalTurn = true` + 清等待计时器；**仅当 `swallowedFinalResult` 已存在**（主回合 result 已被拦下）才布防宽限 |
| `task_updated`（failed/killed） | 同上，仅在 `swallowedFinalResult` 存在时布防（避免打断尚未成立的等待） |
| `task_started` | 绑定 taskId，不改变等待状态 |

汇总轮的 `result` 到达时 `turnTransition === 'turn_completed'` 且无未完成工作 ⇒ 走正常终态路径发布。

**注意武装前提**：SDK 的注入汇总轮只可能在**主回合 result 之后**才被 dispatch。通知到达时若主回合仍在进行（长任务里是常态），此时武装宽限会在 30 秒后把正在干活的主回合当成"卡死"处理——详见下方「最终汇总轮宽限」一节的回归记录。

### 4. 最终汇总轮宽限（`scheduleBackgroundFinalization`，30s）

后台任务全部回报后，SDK 会在同一条 query 上注入一轮「最终汇总」。这轮**不一定按时出现**（例如注入被队列吸收但轮次未实际 dispatch），因此给一个 30 秒宽限兜底：

```ts
const BACKGROUND_FINALIZATION_GRACE_MS = 30_000;
```

**武装前提（2026-10-09 回归修复）**：宽限只允许在**主回合 result 已被拦下**（`swallowedFinalResult` 非空）之后武装。被拦下的 result 在结果闸门处统一保存：

```ts
swallowedFinalResult = resultMsg;   // 闸门拦截时最先执行
// 挂起路径（等待后台任务）：另存 heldBackgroundResult + 15 分钟上限
// 等待注入轮路径（turn_completed && hasPendingFinalSummary）：武装宽限
```

**解除条件**：注入消息（`<task-notification>`）到达并被识别为最终汇总轮时，`clearBackgroundFinalizationTimer()` 立即解除倒计时——轮次已经开始，交给它自身与流看门狗负责收尾。

**到期行为**：优雅收尾，**不是 abort**：

1. 用 `swallowedFinalResult ?? heldBackgroundResult` 作为终态载体，`expiryDurationMs` 用真实墙钟挂起时长；
2. 发 `status{subtype:'background_finalization_graceful'}` + `result{terminal_reason:'background_finalization_graceful', usage, …}` + `done` + `controller.close()`；
3. 置 `backgroundFinalizationExpired = true` + 进入排空模式；不销毁持久会话；
4. 无可转发 result 时直接放弃（交给流看门狗/EOF 分类），不制造 abort。

**回归记录（2026-10-09）**：该特性初版在通知到达时**无条件**武装 30 秒倒计时，且到期后 `abortController.abort()` 整轮查询。而实测中（打包构建等长任务）通知总是在**主回合进行中**到达，SDK 侧注入轮还在队列里排队；30 秒一到，主回合被一刀砍掉 ⇒ `aborted{reason:'background_finalization_timeout'}` ⇒ 前端注入「后台任务已返回，但主任务未能接收结果」+ chat-error + 500ms 自动继续 ⇒ 新回合重演，形成死循环（取证：`~/.claude/projects/<project>/*.jsonl` 中每轮 `queue-operation enqueue` 与回合结束时间精确相差 30 秒，且被杀的回合内模型仍在正常调用工具）。修复后宽限起算点后移至「主回合 result 被拦下」，到期改优雅收尾，前端不再产生中断标注与自动继续。

### 5. 15 分钟等待上限（`scheduleBackgroundWaitExpiry`）

```ts
const BACKGROUND_BASH_WAIT_TIMEOUT_MS = 15 * 60_000;   // 客户端等待上限
const BACKGROUND_DRAIN_TIMEOUT_MS   = 60 * 60_000;     // 排空上限（须 ≥ 会话侧 60 分钟）
```

到点后**优雅收尾**（不是中断、不是失败）：

1. 置 `backgroundWaitExpired = true`、进入排空模式 `drainingBackground = true`；
2. `expiryDurationMs` 用真实墙钟挂起时长（`backgroundHoldStartedAt`）而不是被挂起 result 里的早期耗时；
3. 发 `status{subtype:'background_wait_timeout', …}` + 终态 `result{terminal_reason:'background_wait_timeout', usage, num_turns, session_id}` + `done` + `controller.close()`。

**刻意不走 `aborted`**：`aborted` 会被前端归类为中断/失败（`isAborted` 列表），而这里是"任务仍健康、只是本轮不再等"。阶段保持 `completed`。

### 6. 排空模式

`controller.close()` 之后循环**不停**，切换为排空：

```ts
if (drainingBackground) {
  if (Date.now() > backgroundDrainDeadline) break;
  continue;   // 丢弃后续帧（含注入汇总轮），不发第二个终态
}
```

- 排空期间错误（iterator 抛错）静默收束（`backgroundWaitExpired` 分支提前 `return`），不销毁持久会话；
- `finally` 的会话销毁守卫加 `&& !backgroundWaitExpired`——**排空期间绝不 close persistent session**，否则会杀掉仍在运行的后台任务、丢失会话上下文；
- 工具看门狗对 `pendingBackgroundBashTasks.has(toolUseId)` 的条目 `continue`——等待中的后台任务不是卡死。

### 7. 会话侧上限（`src/lib/persistent-claude-session.ts`）

持久会话自己的等待截止也要认识后台 Bash：

```ts
const BACKGROUND_TASK_WAIT_TIMEOUT_MS = 60 * 60_000;  // 必须 > 客户端 15 分钟
```

- `isBackgroundDispatchTool(name, input)` = `run_in_background && (AGENT_TOOL_NAMES.has(name) || BASH_TOOL_PATTERN.test(name))`；
- `pendingBgAgents` 值类型扩展为 `{ taskId?: string; kind: 'agent' | 'bash' }`；
- 等待截止：`bashPending > 0 ? BACKGROUND_TASK_WAIT_TIMEOUT_MS : SUBAGENT_WAIT_TIMEOUT_MS`。

**为什么会话侧必须更大**：客户端 15 分钟先收尾并进入排空，会话侧若只有 5 分钟（子代理的旧上限）会先掐断生成器，排空根本等不到任务自然结束。60 分钟 > 15 分钟保证排空随生成器自然结束而终止。

### 8. 前端（`src/lib/stream-session-manager.ts` + `MessageItem.tsx`）

- `terminalReason === 'background_wait_timeout'` ⇒ 正文追加 `*(后台任务仍在运行，本轮已结束等待；任务完成后的结果会保留在会话中，可直接继续对话)*`；
- **不加入 `isAborted` 列表** ⇒ `finalPhase` 保持 `completed`，不触发「自动继续」；
- `MessageItem` 的状态解析识别该说明 ⇒ `status = 'interrupted'`，避免绿色「任务完成」徽标误导。

## 数据流（时序）

```
用户消息 ──► 父轮回答 ──► tool_use: Bash(run_in_background)
                          │ 登记 pendingBackgroundBashTasks
                          ▼
        ┌── task_notification 在主回合进行中到达（长任务常态）
        │   ⇒ forwardFinalTurn = true；不武装宽限（主回合还在干活）
        │
        ▼
  父轮 result ──► 闸门：仍有未完成工作 / 等待注入汇总轮
        │ swallowedFinalResult = result（所有拦截场景统一保存）
        │ keep_alive 每 30s（刷新看门狗）
        ├─ 仍有后台 Bash ⇒ heldBackgroundResult + 状态"等待完成后汇总…"
        │     └─ 之后 task_notification 到达 ⇒ 清 pending；此时才武装 30s 宽限
        ├─ 只差注入汇总轮（hasPendingFinalSummary）⇒ 立刻武装 30s 宽限
        │
        └─（并行）15 分钟仍无回报 ⇒ 优雅收尾（result + done + close）→ 排空模式
              │
        ┌─────┴──────────────────────────┐
        ▼                                ▼
  注入汇总轮出现                     宽限 30s 到期
  解除宽限，轮内输出转发             优雅收尾（result + done + close）
  汇总轮 result ⇒ 终态发布           terminal_reason: background_finalization_graceful
                                     │ 排空模式（直到生成器结束/60 分钟）
                                     ▼
                               UI：completed（无中断标注、无自动继续）
```

## 已知边界

- **>60 分钟的残留帧**：排空上限内生成器未结束、任务超 60 分钟后才回报时，其注入帧依赖既有的「流开始时残留注入轮抑制」兜底。极端窄边界，未做代际移交。
- **只识别 `run_in_background === true`**：SDK 若以其他字段表达后台派发，需要扩展 `isBackgroundBashToolUse`。
- **超时是"不再等"而非"取消任务"**：后台任务继续运行，其结果会保留在会话中；用户下次对话仍可能收到任务完成通知（这是刻意保留的行为）。

## 测试

`src/__tests__/unit/background-bash-hold.test.ts`（9 例）：

- 行为（SSE 脚本回放，含 Promise gate 模拟"等待期间流保持打开"）：
  1. 等待期间 `phase === 'active'` 且不出现 `completed`；汇总放行后一并收尾；
  2. 超时收尾：`phase === 'completed'` + `terminalReason === 'background_wait_timeout'` + 说明注入 + 不触发自动继续；
  3. 宽限优雅收尾：`phase === 'completed'` + `terminalReason === 'background_finalization_graceful'` + 无「未能接收结果」文案 + 不触发自动继续；
- 源码断言 6 例：claude-client 接线 / persistent-claude-session 接线（含两侧上限大小关系）/ 前端注解与状态标记；
- 回归断言（2026-10-09）3 例：通知分支武装宽限的前置守卫（主回合进行中不得武装）、宽限到期不 abort（段内无 `.abort()` 与旧 reason）、注入轮开始即解除倒计时。

`src/__tests__/unit/subagent-stream-resilience.test.ts` 同步更新：宽限断言从旧 abort 文案改为「优雅收尾」文案，防回归。

> 构造 SSE 脚本时注意 `result` / `status` 事件的 `data` 必须是**字符串化的 JSON**（与 `formatSSE` 一致）；直接放对象会在消费者侧 `JSON.parse` 失败并静默降级为 `onResult(null)`——调试时最容易踩的坑。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/claude-client.ts` | 登记/闸门/等待上限/排空模式/看门狗豁免 |
| `src/lib/persistent-claude-session.ts` | 会话侧派发识别、`kind` 分类、60 分钟等待截止 |
| `src/lib/stream-session-manager.ts` | 超时说明注入、`isAborted` 归类边界 |
| `src/components/chat/MessageItem.tsx` | 状态标记识别（非「任务完成」） |
| `src/__tests__/unit/background-bash-hold.test.ts` | 单元测试 |
