# 交互式权限/提问卡片的生命周期与超时策略

> 产品思考见 [docs/insights/interactive-permission-ux.md](../insights/interactive-permission-ux.md)
>
> 修复「切窗口回来，选项卡片消失、这一轮直接结束」时确立的行为契约。
> 涉及 SDK 与 Native 两条 runtime 的等待路径、权限注册表的超时语义、前端卡片恢复。

## 问题现象

用户在会话视图中等待 `AskUserQuestion` 卡片时切到别的窗口，过一段时间切回来：

- 卡片不见了
- 这一轮对话也「直接结束了」，没有停在等他作答的状态
- AI 有时会重发一张卡片（截图里那句「选项卡片已重新发出，等你选」即由此而来）

## 根因

卡片本身没有超时，**等待期间挂着三把「铡刀」**，其中任意一把都会把等待连同这一轮一起掐断：

| # | 位置 | 阈值 | 后果 |
|---|------|------|------|
| 1 | `permission-registry.ts` `TIMEOUT_MS` | 5 分钟 | 自动把未答请求 resolve 成 `deny`（"Permission request timed out"），DB 记录标 `timeout` |
| 2 | `claude-client.ts` `toolWatchdogTimer` / `streamWatchdogTimer` | `toolTimeoutSeconds`（默认 600s） | 判工具/上游「无进度」→ `abort(stalled)` |
| 3 | 前端 `stream-session-manager` idle 检查 | 330s / 600s（思考期） | 静默超时 → `abortController.abort()` |

第 1 条是主因，且**先于另外两条触发**（300s < 330s < 600s）。链路：

```
用户切走
  → 服务端 permission-registry 倒计时照走（不关心窗口是否聚焦）
  → 5 分钟到点，自动 resolve 成 deny
  → SDK 把 deny 当作工具结果继续跑
  → AI 拿不到答案（或重发卡片），本轮结束
  → 前端收到流结束 → snapshot.pendingPermission 被清成 null
  → 用户切回来：卡片没了，对话已结束
```

**为什么切窗口会放大问题**：Electron 窗口失焦/被遮挡时 Chromium 会节流渲染进程的定时器（`backgroundThrottling` 默认开），**前端时钟被拖慢，服务端倒计时不受影响**。

**为什么切回来也救不回卡片**：卡片只活在内存快照（`stream-session-manager` 的 `pendingPermission`）。`GET /api/chat/permission` 本来能从 DB 把 pending 捞回来，但此前**前端没有任何调用方**，快照一清空就没有第二条恢复路径（刷新页面也不行）。

## 设计决策：把「等人工」从「超时」里摘出来

`AskUserQuestion` / `ExitPlanMode` 在 `permission-checker.ts` 里被列为 `ALWAYS_ASK_TOOLS` —— 它们的存在意义**就是**等用户操作。给这类请求挂「自动拒绝兜底」在语义上是矛盾的：模型问「A 还是 B」，5 分钟后系统替用户答「拒绝，超时了」。

因此按请求性质分流：

- **交互式请求**（`isAlwaysAskTool(toolName)` 为真）：不设墙钟自动拒绝，等待时长由人决定
- **其余工具权限**：沿用 5 分钟自动拒绝兜底

## 实现要点

### 1. `permission-registry.ts` — 注册选项

```ts
registerPendingPermission(id, toolInput, {
  interactive: true,        // 不设墙钟超时
  signal: abortController?.signal, // 仅在本轮真正终止时释放
})
```

交互式请求的结束路径只有三条：

1. 用户作答（`POST /api/chat/permission` 命中内存，或 1s 间隔的 DB 轮询发现跨 worker 写入）
2. `signal` 触发 —— 本轮确实终止（用户手动停止 / 会话被替换 / SSE 连接断开）
3. 进程退出（内存随之释放）

`signal` 已中止时同步 settle 并**不登记** map，避免留下死条目。

### 2. `claude-client.ts` — 等待期暂停看门狗

新增 `waitingPermissionDepth` 挂起计数，两个看门狗回调在 `depth > 0` 时直接返回：

- `streamWatchdogTimer` 额外把 `lastStreamActivityAt` 推前，避免用户作答后因积压时长立刻被误判 `stalled`
- `toolWatchdogTimer` 跳过卡死判定

`AskUserQuestion` handler 与 `canUseTool` 两条路径都按 `isAlwaysAskTool(toolName)` 决定是否走交互式分支。

> 注意：这里**故意**重新传入了 `abortController.signal`（旧注释曾要求不要传）。前提是等待期不会有 idle/watchdog 误触发 abort —— 前端 idle 由 15s `keep_alive` 保活（`KEEPALIVE_INTERVAL_MS = 15_000`，远小于 330s 阈值），服务端看门狗已被上面的 `waitingPermissionDepth` 暂停。此时 signal 只对应「本轮真的不再继续」。

### 3. `agent-tools.ts` — Native runtime 同一策略

Native 路径走 `wrapWithPermissions`，同样按 `isAlwaysAskTool(name)` 传 `interactive`，并绑定 `ctx.abortSignal`。

### 4. 前端恢复 — `adoptPendingPermission`

`stream-session-manager.ts` 新增：

```ts
adoptPendingPermission(sessionId, event) // 已有 pending 时不覆盖；无活动流则用 seedSnapshotPatch 撑起占位快照
```

`ChatView` 在**挂载时**与**窗口重新可见/聚焦时**（`visibilitychange` + `focus`）查询 `GET /api/chat/permission?sessionId=`，命中 `status === 'pending'` 就注入。

> **踩过的坑（务必保留广播）**：`seedSnapshotPatch` 只做 `map.set`、**不发事件**，其注释假设
> 「ChatView 会在挂载时重新订阅」。这个假设在恢复场景**不成立** —— 视图早已挂载并订阅好了，
> 没有事件通知就永远渲染不出卡片。现象是：接口返回 200、记录了 pending，但界面一片空白。
> 因此占位分支之后必须补一次 `emit(seeded, 'permission-request')`
> （用 `permission-request` 而非 `snapshot-updated`，顺带同步 `pendingApprovalSessionId`，
> 与「已有流」分支同一语义）。回归测试见 `src/__tests__/unit/adopt-pending-permission.test.ts`。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/permission-registry.ts` | 待审批注册表、超时/释放策略 |
| `src/lib/permission-checker.ts` | `ALWAYS_ASK_TOOLS` / `isAlwaysAskTool()` 单一真相源 |
| `src/lib/claude-client.ts` | SDK runtime 权限等待、看门狗 |
| `src/lib/agent-tools.ts` | Native runtime 权限包装 |
| `src/lib/stream-session-manager.ts` | 前端流快照、`adoptPendingPermission` |
| `src/components/chat/ChatView.tsx` | 卡片恢复触发点 |
| `src/components/chat/PermissionPrompt.tsx` | 卡片 UI（`NEVER_AUTO_APPROVE` 保证 full_access 下仍显示） |
| `src/app/api/chat/permission/route.ts` | GET 查 pending / POST 作答 |

## 验证记录

- **单元测试**：`permission-registry-interactive.test.ts`（5 条：非交互仍超时兜底 / 交互不超时 / signal 释放 / 预中止不遗留死条目 / DB 轮询跨 worker 作答）、`adopt-pending-permission.test.ts`（4 条：占位分支必须广播 / 可读回 / 不覆盖已有 / 无 id 不建空快照）。
  后者的有效性做过对照验证：注释掉 `emit` 那行后测试转红，恢复后转绿。
- **端到端（CDP 实测）**：向 DB 插入一条 `status='pending'` 的 `AskUserQuestion` 记录 → 打开该会话页面 → 卡片自动渲染（此前为空白）→ 模拟 `blur`/`focus`/`visibilitychange` 后卡片仍在 → 选中选项并提交 → `permission_requests.updated_input.answers` 正确落库、`status` 转 `allow`、卡片消失。测试记录已从 DB 清除。
- **回归**：`npm run test` 全绿；`npm run test:smoke` 6/6 通过。

## 已知边界

- **Bridge（IM 远程渠道）不支持作答选择**：`permission-broker.ts` 只处理 Allow/Deny，IM 用户看到的是通用权限卡，无法选选项。需要各平台交互卡片（Telegram inline keyboard / 飞书 interactive card）才能完整支持 —— 见 `builtin-tools/ask-user-question.ts` 顶部注释，属独立跟进项。
- **页面刷新 / Electron 渲染进程重载**：会断开 SSE，服务端 `request.signal` abort → 流终止 → pending 落库 `aborted`，此时 DB 里已无 pending，恢复机制无从生效。这是「连接即会话」的既有约束，非本次范围。
- **`expirePermissionRequests()`**（`db.ts`）目前无调用方，`expires_at` 与前端恢复查询无关（GET 只按 `status = 'pending'` 过滤）。
