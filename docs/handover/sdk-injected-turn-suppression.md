# SDK 内部轮次抑制（后台任务通知不再被当成回答）

> 产品思考见 [docs/insights/sdk-injected-turn-suppression.md](../insights/sdk-injected-turn-suppression.md)

## 问题现象

微信桥接的助手会话表现为「丢上下文、答非所问」：用户提一个问题，收到的回答里混进一句
与问题无关的**上一轮后台任务完成语**，例如：

- 「后台 SSH 隧道任务已完成 📮 还有什么需要帮你的吗？🐰」
- 「SSH 隧道任务已完成 📮 还在等你回复呢～ 🐰」

落库后这条消息的时间戳与用户的**下一条**消息完全相同，看起来就像它在回答那个新问题。

## 根因

Claude Code SDK 对长时间运行的 Bash 命令会**自动转入后台**。命令结束时，SDK 会往
**同一条 query** 里追加一条合成 user 消息：

```xml
<task-notification>
<task-id>bwehs6gf3</task-id>
<tool-use-id>call_7dd060ae65f042d8b7d69a16</tool-use-id>
<output-file>/private/tmp/claude-501/.../tasks/bwehs6gf3.output</output-file>
<status>completed</status>
<summary>Background command "建立SSH隧道到远程数据库" completed (exit code 0)</summary>
</task-notification>
```

这条消息**不是用户输入**，但 SDK 会因此**额外再跑一轮模型**，并把这一轮的 assistant
输出打到同一条消息流上。而持久会话的 SSE 流是一直挂着的，下游消费者
（`src/app/api/chat/route.ts`、`src/lib/bridge/conversation-engine.ts`）会把这一轮的文本
并进「仍然打开」的用户回复缓冲区，在流结束时一起落库 ⇒ 变成用户问题的"回答"；
Bridge 场景下还会直接推送到微信。

**为什么形成循环**：隧道命令写的是 `ssh ... "echo '隧道已建立'; sleep 120"`，
`sleep` 一到隧道必断 → 下次重连 → 又产生一条 task-notification → 又一轮注入回答。

> 关键取证：`~/.claude/projects/<project>/<sdk_session_id>.jsonl` 里能看到
> `queue-operation` 入队记录、字符串型 user 消息（即注入消息）以及紧随其后的自动回答。
> 这类问题**不是上下文丢失**，同一个 SDK session 是连续复用的。

## 实现

### 1. 识别（纯函数）

`src/lib/claude-client.ts`：

```ts
export function detectSdkInjectedUserTurn(content: unknown): { source: string; summary: string } | null
```

- 只认「以 `<task-notification>` 开头」的字符串型 user 消息（正文里提到标签不算）
- 抽出 `status` / `summary` / `task-id` 拼成一行摘要用于观测，不污染日志

### 2. 状态机

```ts
export class SdkInjectedTurnTracker {
  markUserMessage(content): { source, summary } | null
  shouldSuppress(messageType): boolean
  get isInjectedTurn(): boolean
  onResult(): 'internal_end' | 'suppressed_start' | 'turn_completed'
}
```

状态迁移：

| 时序 | 行为 |
| --- | --- |
| 本轮答完（`onResult` → `turn_completed`）之后收到注入消息 | 立刻进入抑制态 |
| 本轮**回答途中**就收到注入消息 | 先挂起（`pendingInternalTurn`），**不立刻抑制** |
| 上一情况中本轮的 result 到达 | 从这一刻起进入抑制态，承接随后那一轮输出 |
| 注入轮自己的 result 到达 | 退出抑制态（`internal_end`），恢复正常转发 |

「挂起」这一步是必需的：若在用户本轮途中就抑制，会把**用户自己的回答和 result 一起吞掉**。

### 3. 在流循环中生效

`streamClaude()` 主循环（`for await (const message of conversation)`）：

- 循环开头：`if (sdkInjectedTurn.shouldSuppress(message.type)) continue;`
  —— 丢弃注入轮的 `assistant` / `stream_event` / `tool_use` / `tool_result`，
  **放行 `system` 与 `result`**（`system` 维持任务/模式状态，`result` 是轮次结束信号）
- `case 'user'` 的字符串分支：调用 `markUserMessage()`，命中则发一个
  `status{subtype:'internal_turn_start', _internal:true}`
- `rewind_point` 发射条件追加 `!sdkInjectedTurn.isInjectedTurn`
  —— 注入消息不是用户输入点，不应产生回滚锚点
- `case 'result'` 顶部：先跑 `onResult()`；`internal_end` 时发
  `status{subtype:'internal_turn_end', _internal:true}` 并 `break`，
  **不透传该轮 result**，避免污染本轮 usage / 耗时 / session_id 统计

`_internal: true` 是既有约定，前端 `useSSEStream` 会直接跳过这类 status 事件，
不会渲染成状态提示。

## 下游影响

**无需改动**。抑制发生在最上游，下游根本收不到注入轮的可见输出。
已核对两个消费者：

| 消费者 | `status` 处理 | 结论 |
| --- | --- | --- |
| `src/app/api/chat/route.ts:814` | 只读 `session_id` / `model` | 无影响 |
| `src/lib/bridge/conversation-engine.ts:433` | 只读 `session_id` / `skill_nudge` | 无影响 |
| `src/hooks/useSSEStream.ts:229` | `_internal` 直接 return | 已跳过 |

## 已知边界

- **PTL 重试路径未覆盖**：prompt-too-long 重试是独立的 `for await (const msg of retryConversation)`
  循环（约 3100 行），不复用主循环的抑制状态机。该路径仅在上下文超限时触发，
  期间恰好撞上后台任务通知属于极端边角，暂不处理。
- **只识别 `<task-notification>`**：SDK 若新增其他注入型合成 user 消息，
  需在 `detectSdkInjectedUserTurn()` 里扩展。
- **`sleep N` 式隧道仍是隐患来源**：抑制只是止血；根治要靠
  `~/.claude/skills/connect-ssh-server/scripts/ssh-tunnel.sh`（autossh + `-f -N`，
  调用秒回，不产生需要等待的前台命令）。

## 测试

`src/__tests__/unit/sdk-injected-turn.test.ts`（10 例）：

- 识别：真实报文样本、前导空白、正文含标签不误判、非字符串、缺 summary 回退与长度截断
- 状态机：普通轮次、答完后通知、途中通知（挂起→接管）、真实场景回放、连续多次通知

真实报文样本直接取自本机 `442780eb-b56d-403f-b313-dd057f817acd.jsonl`，
字段顺序与额外标签（tool-use-id / output-file）保持原样，用来锁死解析健壮性。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/claude-client.ts` | `detectSdkInjectedUserTurn` / `SdkInjectedTurnTracker` / 流循环接入 |
| `src/components/chat/McpStatusChip.tsx` | 配套修复：pending（启动中）不再计入「异常」 |
| `src/__tests__/unit/sdk-injected-turn.test.ts` | 单元测试 |
| `~/.claude/skills/connect-ssh-server/scripts/ssh-tunnel.sh` | 隧道根治脚本（技能侧，不在本仓库） |
