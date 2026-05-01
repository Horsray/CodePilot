# CodePilot 预热机制全面诊断报告

## 一、问题概述

你描述的问题有三个症状：
1. **预热经常失效** — warmup 创建的 session 无法被 chat route 复用
2. **模型断开连接** — 发送消息后无响应、无报错
3. **改过之后坏了** — 之前的修改引入了回归

经过彻查，我找到了**根本原因**和**多个相互关联的缺陷**。

---

## 二、根本原因：签名不匹配

### 2.1 签名机制回顾

`buildPersistentClaudeSignature()` 根据以下字段生成 session 身份签名：

```
providerKey, cwd, model, settingSources, plugins,
systemPrompt (仅 type/preset), permissionMode,
extraArgs, pathToClaudeCodeExecutable,
includeHookEvents, env (ANTHROPIC_BASE_URL 等)
```

warmup route 和 chat route **必须产生完全一致的签名**，否则预热 session 无法被复用。

### 2.2 签名不匹配的具体原因

| 字段 | warmup route | chat route | 是否一致 |
|------|-------------|------------|----------|
| `includeHookEvents` | `true` (line 171) | `true` (line 1232) | ✅ |
| `permissionMode` | `session.permission_profile \|\| 'default'` | `effectiveMode === 'plan' ? 'explore' : 'trust'` | ❌ **不一致** |
| `cwd` | `resolvedCwd.path` | `session.sdk_cwd \|\| session.working_directory` | ⚠️ 可能不一致 |
| `settingSources` | `resolved.settingSources` | 未显式设置 | ❌ **不一致** |
| `plugins` | `getEnabledPluginConfigs(resolvedCwd.path)` | `getEnabledPluginConfigs(pluginCwd)` | ⚠️ 可能不一致 |
| `env` | `sanitizeEnv(setup.env)` | `sanitizeEnv(setup.env)` | ⚠️ 取决于 provider 解析 |
| `systemPrompt` | `{type:'preset', preset:'claude_code', append:...}` | 同上 | ✅ (append 不参与签名) |

**最关键的不一致是 `permissionMode`**：
- warmup route 使用 `session.permission_profile || 'default'`（来自 DB 的 permission_profile 字段）
- chat route 使用 `effectiveMode === 'plan' ? 'explore' : 'trust'`（来自前端发送的 mode 字段）

这意味着如果用户的 permission_profile 是 `'default'`，warmup 签名中 `permissionMode = 'default'`，而 chat route 签名中 `permissionMode = 'trust'`（因为 effectiveMode 默认是 `'code'`）。

### 2.3 代码已承认此问题

`persistent-claude-session.ts` 第 584-586 行：
```
// 签名匹配策略在实践中几乎不可能让 warmup route 和 chat route 产生完全一致的签名
// 导致 WarmQuery 永远无法被消费。改为 sessionId 直接查找。
```

代码用 `hasWarmedNativeClaudeQueryBySessionId()` 绕过了签名检查，但 `takeWarmedNativeClaudeQuery()` 仍然验证签名！这导致预热虽然被"找到"，但取不出来。

---

## 三、静默断连问题

### 3.1 持久会话的 Promise 链死锁

`acquireTurn()` 使用 Promise 链实现串行锁：

```typescript
async function acquireTurn(entry: PersistentClaudeEntry): Promise<() => void> {
  const previous = entry.turnLock;
  const current = new Promise<void>((resolve) => { release = resolve; });
  entry.turnLock = previous.then(() => current);
  await previous;  // ← 如果 previous 永远不 resolve，这里永远等待
  // ...
}
```

**场景**：如果上一轮的 SDK 子进程崩溃或超时，`release()` 永远不会被调用，后续所有 `acquireTurn()` 调用都会永远阻塞。用户发送消息后，前端 SSE 连接建立，但永远收不到任何数据。

### 3.2 Iterator 静默结束

`getPersistentClaudeTurn()` 中：

```typescript
while (true) {
  const next = await entry!.iterator.next();
  if (next.done) {
    closePersistentClaudeSession(params.codepilotSessionId);
    return;  // ← 生成器静默返回，不 yield 任何错误信息
  }
  // ...
}
```

如果 SDK 子进程在发送 `result` 之前退出（比如 OOM、被 kill），iterator 会 `done`，生成器静默返回，SSE 流关闭，前端收到空响应。

### 3.3 空闲超时后的竞态条件

当 `IDLE_TIMEOUT_MS`（30 分钟）超时触发 `closePersistentClaudeSession()` 时：
1. `closeEntry()` 调用 `entry.input.close()` 和 `entry.query.close()`
2. 但如果此时有请求正在 `await entry.iterator.next()`，这个 await 会挂起
3. `store.delete(sessionId)` 已经执行，新请求会创建新 session
4. 旧请求的 await 最终可能 reject（取决于 SDK 行为），但错误可能被吞掉

---

## 四、其他问题

### 4.1 `first-turn-warmup.ts` 被掏空

所有函数都返回 0/null：
```typescript
export function getPendingFirstTurnRemainingDelayMs(...) { return 0; }
export function shouldReleasePendingFirstTurn(...) { return true; }
export function getPendingFirstTurnStatusText(...) { return null; }
```

这意味着首轮消息队列机制完全禁用。用户发送首条消息时，不会等待预热完成，直接走冷启动路径。

### 4.2 全内存存储，重启即丢失

所有 session 状态存储在 `globalThis` 的 Map 中：
- `getStore()`: 持久会话
- `getWarmQueryStore()`: 预热查询
- `getPendingWarmupStore()`: 进行中的预热

Next.js 热重载、服务器重启都会导致所有预热状态丢失。虽然 `session.sdk_session_id` 存在 DB 中允许 resume，但预热优化完全失效。

### 4.3 WarmQuery 的 one-shot 限制

WarmQuery 只能消费一次。消费后：
- 第一轮：快（WarmQuery 已预热）
- 第二轮：需要创建新的 persistent session，显示 "Reconnecting to previous conversation..."

代码有 `ensurePersistentClaudeSession()` 试图同时创建 persistent session，但 warmup route 只调用了 `warmupPersistentClaudeSession()`，没有调用 `ensurePersistentClaudeSession()`。

---

## 五、建议方案

### 方案 A：修复当前机制（最小改动）

**优先级：高**

1. **统一 permissionMode 计算**：
   ```typescript
   // warmup/route.ts 中改为与 chat route 一致
   const permissionMode = (session?.mode === 'plan') ? 'explore' : 'trust';
   ```

2. **统一 settingSources**：
   确保 warmup route 和 chat route 使用相同的 `settingSources` 值。

3. **修复 takeWarmedNativeClaudeQueryBySessionId**：
   不验证签名，直接按 sessionId 取出。

4. **添加 Promise 链超时**：
   ```typescript
   async function acquireTurn(entry: PersistentClaudeEntry, timeoutMs = 60_000): Promise<() => void> {
     const release = await Promise.race([
       originalAcquireLogic(entry),
       new Promise<never>((_, reject) =>
         setTimeout(() => reject(new Error('Turn lock timeout')), timeoutMs)
       ),
     ]);
     return release;
   }
   ```

5. **添加 iterator 超时**：
   在 `getPersistentClaudeTurn()` 的 `while(true)` 循环中添加超时检测。

### 方案 B：本地 Session 存储机制（你提到的方案）

**架构**：
```
┌─────────────────────────────────────────────┐
│              SQLite (已有的 db.ts)            │
│  sessions 表：sdk_session_id, signature,     │
│  warmup_status, last_used_at, options_hash   │
└─────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│         SessionManager (新模块)              │
│  - loadSession(id) → 从 DB 恢复元数据        │
│  - saveSession(id, metadata) → 持久化        │
│  - getOrCreateSession(id, signature)         │
│  - 智能匹配：签名模糊匹配 + sessionId 优先   │
└─────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│      PersistentClaudeSession (现有)          │
│  - 内存中的 SDK 子进程管理                    │
│  - 重启后根据 DB 元数据决定 resume 或 fresh   │
└─────────────────────────────────────────────┘
```

**优点**：
- 重启后能恢复 session 元数据，智能决定 resume vs fresh
- 签名可以持久化，重启后仍能匹配
- 可以记录 session 健康状态（最后成功时间、错误次数）

**缺点**：
- SDK 子进程本身无法持久化（它是运行中的进程）
- 重启后仍需冷启动 SDK 子进程，只是 resume 更快
- 增加了复杂度

### 方案 C：简化方案（推荐）

**核心思路**：放弃精确签名匹配，改用"sessionId 优先 + 签名模糊匹配"策略。

1. **预热只按 sessionId 匹配**：
   - warmup 创建 session 时，用 `warmup:${sessionId}` 作为 key
   - chat route 消费时，直接按 sessionId 查找
   - 不再比较签名

2. **签名只用于"是否需要重建"判断**：
   - 如果签名差异在可容忍范围内（如只有 permissionMode 不同），复用
   - 只有关键字段变化时（model、cwd、provider）才重建

3. **添加健康检查**：
   - 复用前发送一个 ping 消息，验证 session 存活
   - 如果 ping 超时，销毁并重建

4. **简化 first-turn-warmup.ts**：
   - 恢复基本的等待逻辑
   - 首轮消息等待预热完成（最多 5 秒），超时后走冷启动

---

## 六、实施建议

### 立即修复（解决静默断连）

1. 在 `acquireTurn()` 添加超时机制
2. 在 `getPersistentClaudeTurn()` 的 iterator 循环添加超时
3. 在 `closePersistentClaudeSession()` 中确保所有等待中的 promise 被 reject

### 短期修复（解决预热失效）

1. 统一 warmup route 和 chat route 的 `permissionMode` 计算
2. `takeWarmedNativeClaudeQueryBySessionId()` 移除签名验证
3. warmup route 同时调用 `ensurePersistentClaudeSession()`

### 中期优化

1. 实现方案 C 的"sessionId 优先 + 签名模糊匹配"
2. 恢复 `first-turn-warmup.ts` 的基本等待逻辑
3. 添加 session 健康状态到 DB

### 长期考虑

如果需要更强的可靠性，可以实现方案 B 的本地 session 存储，但这需要较大改动，且收益有限（SDK 子进程仍需在内存中运行）。

---

## 七、总结

你的预热机制**设计思路是对的**，但有两个关键缺陷：

1. **签名不匹配**：warmup route 和 chat route 的 `permissionMode` 计算逻辑不同，导致签名永远不一致。代码虽然用 sessionId 直接查找绕过了签名检查，但 `takeWarmedNativeClaudeQueryBySessionId()` 仍然验证签名，形成逻辑矛盾。

2. **缺乏容错**：持久会话的 Promise 链和 iterator 缺乏超时机制，SDK 子进程崩溃时会导致静默死锁。

**不需要**做一个完整的本地 session 存储机制。修复签名不匹配 + 添加超时容错，就能解决 90% 的问题。如果需要更强的可靠性，可以实现方案 C 的简化匹配策略。
