# 桥接只发最终结论 + 未完成自动续跑

> 产品思考见 [docs/insights/bridge-final-response.md](../insights/bridge-final-response.md)

## 问题现象

2026-10-07 用户反馈（微信桥接）：手机收到的是**一串过程叙述**而不是结论，而且句子停在半句上，
看起来像任务"没做完就停了"：

```
让我直接在服务器上查一下 MySQL 和环境配置：…让我 SSH 到服务器上查：
看到了！服务器上的 user-700244.db 有 65536 字节…让我查一下：
SQLite 库里没有 horsray 用户！…让我看看这个管理系统是不是有 MySQL 配置但没开：   ← 停在冒号
```

用户原话："手机不可能显示流式的思考构成，它把思考过程当结论发给我了，导致对话中断了…
或者发阶段性结论，但不能终止任务啊，这都没完成就停了"。

## 根因（三层叠加）

### 1. 过程叙述被整轮拼接成回复

`src/lib/bridge/conversation-engine.ts` 的 `consumeStream()` 把一轮 query 里**所有** text 块
`join('')` 当作回复。但 assistant 在两次 `tool_use` 之间的解说词（"让我查一下…"）**本身就是 text 块**，
于是发出去的全是"我要做什么"，而不是"结论是什么"。

### 2. 模型"说了但没做"就 end_turn

取证自 `~/.claude/projects/<project>/442780eb-*.jsonl`（925 行）最后两条：

```
assistant  stop_reason=end_turn  blocks=['thinking']
assistant  stop_reason=end_turn  blocks=['text']   ← "…让我看看这个管理系统是不是有 MySQL 配置但没开："
```

`stop_reason=end_turn` 且**没有 tool_use**——模型宣告要调用工具，却提前结束了回合，
SDK 认为该轮正常完成。这是 deepseek 等中转模型在长链工具调用中的高发形态。

> 注意：这不是"长度截断"。该条回复仅 814 字符，远未触及微信 4096 的分片上限；
> 用户感知的"截断"是**语义截断**（句子停在冒号上）。

### 3. 错误提示被半截文本吞掉

`bridge-manager.ts` 里发送逻辑是 `if (result.responseText) {…} else if (result.hasError) {…}`。
只要有任何文本产出，真正的失败原因（provider 报错、流异常中止）**永远不会**送到用户手里。

## 实现

### 1. 只取最终结论（纯函数）

`src/lib/bridge/conversation-engine.ts`：

```ts
export function extractFinalResponseText(blocks: MessageContentBlock[]): string
```

- 定位**最后一个** `tool_use` / `tool_result`，只取它之后的文本块
- 末尾无文本（模型调用完工具直接收尾）→ 回退到**最后一个非空文本块**，保证不空发
- 只有 thinking → 返回空串，由调用方决定提示文案

### 2. 未完成轮次检测（纯函数）

```ts
export type IncompleteReason = 'dangling_tool_use' | 'trailing_intent';
export function detectIncompleteTurn(blocks): { incomplete: boolean; reason?: IncompleteReason }
```

| 信号 | 判据 | 置信度 |
| --- | --- | --- |
| `dangling_tool_use` | 某个 `tool_use` 没有配对的 `tool_result`（工具调用悬空 ⇒ 流被中断） | 硬 |
| `trailing_intent` | 结论以 `：` / `:` / `…` 收尾**且**带前瞻词（让我/我来/接下来/接着/下面我/现在我） | 软（启发式） |

软信号刻意收紧：`"查询结果如下："` 这类正常收尾**不会**命中（无前瞻词）。

### 3. 未完成自动续跑

`src/lib/bridge/bridge-manager.ts`，在 `processMessage()` 返回后：

```ts
for (let round = 0; round < CONTINUE_MAX; round++) {
  if (taskAbort.signal.aborted || result.hasError || !result.incomplete) break;
  const next = await engine.processMessage(binding, CONTINUE_PROMPT, …);
  // 续跑产出新结论就用它，否则保留上一轮文本
}
```

- `CONTINUE_MAX = 2`（最多续跑两轮，防死循环）
- `CONTINUE_PROMPT` 明确要求"直接执行工具调用并把事情做完，最后给出结论"
- 续跑轮**不落库用户消息**（`processMessage` 新增 `persistUserMessage = false`），
  避免"继续"污染会话历史
- 续跑轮**不做流式预览**（`onPartialText` 传 `undefined`），避免预览文字来回抖动
- 续跑到上限仍未完成 → 用 `trimTrailingIntent()` 裁掉末尾的"让我…："式宣言句，
  再追加 `⚠️ 任务可能尚未完成，回复「继续」可接着做。`

```ts
export function trimTrailingIntent(text: string): string
```

从**末尾**逐段裁剪：仅当末段以 `：` / `:` / `…` 收尾**且**含前瞻词时弹出该段，
裁到只剩一段即停（防止把整条回复裁空）。正常结论（`"查到了，horsray 属于花生国风空间。"`）不受影响。

### 4. 错误必须可见

发送逻辑拆成两个独立分支，不再互斥：

```ts
if (result.responseText) { /* 发正文 */ }
if (result.hasError)      { /* 另发一条 ⚠️ 错误说明 */ }
```

## 数据流

```
用户消息 (IM)
  └─ bridge-manager.handleMessage
       └─ conversation-engine.processMessage
            └─ streamClaude() ── SSE ──> consumeStream()
                 ├─ contentBlocks（跨整轮累积，含 thinking / tool_use / tool_result / text）
                 ├─ 落库：剔除 thinking 后写 messages 表
                 ├─ responseText = extractFinalResponseText(blocks)   ← 只取末尾结论
                 └─ incomplete  = detectIncompleteTurn(blocks)
       ├─ 续跑循环（最多 2 轮，不落库用户消息、不做预览）
       └─ deliverResponse() / deliver(错误提示)
```

## 落库侧同步修正

原先落库时 `hasStructuredBlocks` 把 `thinking` 也算作结构化块，导致整轮被 `JSON.stringify`
存进 `messages.content`。这些原始推理文本（多为英文，如
`"The background SSH tunnel task completed..."`）会被 `getMessages()` 当作会话历史回放给模型，
污染后续推理。现在**落库前统一剔除 thinking 块**。

## 已知边界

- **软信号是启发式**：`trailing_intent` 可能漏判（模型换个措辞）或误判（正常以冒号收尾且含前瞻词）。
  误判成本是多重跑一轮，可接受；根治要靠模型行为本身。
- **续跑消耗额外 token**：`CONTINUE_MAX = 2` 意味着一轮最坏情况跑 3 次 `processMessage`。
- **未根治模型提前 end_turn**：这是中转模型的能力/输出限制问题，本次只是兜底。
  见 `docs/exec-plans/tech-debt-tracker.md`。
- **PTL 重试路径**同样未覆盖续跑（与 `sdk-injected-turn-suppression.md` 的边界一致）。

## 测试

`src/__tests__/unit/bridge-final-response.test.ts`（12 例）：

- 提取（5）：真实实测样本（三段过程叙述 + 两个工具调用）、纯对话、末尾连续多段、末尾无文本回退、仅 thinking
- 检测（4）：悬空 tool_use、前瞻式收尾、正常结论不误判、以冒号收尾但无前瞻词不误判
- 裁剪（3）：逐段裁掉末尾前瞻句保留结论、正常结论原样返回、只剩一段时不裁（防空回复）

样本直接取自 2026-10-07 微信桥接实测的那一轮，保证判据贴合真实形态。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/bridge/conversation-engine.ts` | `extractFinalResponseText` / `detectIncompleteTurn` / `trimTrailingIntent` / 落库剔除 thinking / `persistUserMessage` |
| `src/lib/bridge/bridge-manager.ts` | 续跑循环、错误可见、`CONTINUE_MAX` / `CONTINUE_PROMPT` |
| `src/__tests__/unit/bridge-final-response.test.ts` | 单元测试 |
| `docs/handover/sdk-injected-turn-suppression.md` | 同源问题：SDK 注入轮次（`<task-notification>`）的抑制 |
