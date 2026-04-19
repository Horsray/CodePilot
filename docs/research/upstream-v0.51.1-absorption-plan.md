# upstream v0.51.1 吸收评估与方案

调研日期：2026-04-19

## 结论

建议吸收 upstream `v0.51.1`，优先级高。

本地当前版本为 `0.51.0`，upstream/main 最新 tag 为 `v0.51.1`。共同基线是 `v0.51.0`，本 fork 相对 upstream 为 ahead 35 / behind 3。官方新增范围小，但修复的是长会话 compact 后 Claude Code SDK resume 与 fallback history 交互导致的严重问题：模型把工具调用写成纯文本、反复自动压缩、compact 状态不更新、summary 覆盖边界误判。

## upstream 变化范围

新增 upstream commits：

| commit | 主题 |
| --- | --- |
| `cd42f15` | 修复 reactive compact 不再把伪工具调用模式教给模型 |
| `2bfb2bd` | compact 覆盖边界改为 rowid，并重做 SDK resume handoff |
| `85f7f06` | release v0.51.1 |

文件范围：

| 类型 | 文件 |
| --- | --- |
| release/version | `RELEASE_NOTES.md`, `package.json`, `package-lock.json` |
| compact 核心 | `src/lib/context-compressor.ts`, `src/lib/message-normalizer.ts`, `src/lib/claude-client.ts`, `src/app/api/chat/route.ts`, `src/lib/db.ts`, `src/types/index.ts` |
| 测试 | `src/__tests__/unit/context-compressor-handoff.test.ts`, `src/__tests__/unit/message-normalizer.test.ts`, `src/__tests__/unit/sse-stream.test.ts` |
| 文档 | `docs/handover/compact-coverage-boundary.md`, `docs/handover/context-management.md`, `docs/handover/README.md` |

## 冲突与风险

`git merge-tree --write-tree HEAD upstream/main` 预演结果：

| 文件 | 状态 | 处理策略 |
| --- | --- | --- |
| `src/lib/db.ts` | 内容冲突 | 手动合并。保留 fork 的 `team_mode` / `orchestration_tier` / `orchestration_profile_id` 迁移，并追加 upstream 的 `context_summary_boundary_at` 和 `context_summary_boundary_rowid` 迁移。`getSessionSummary` / `updateSessionSummary` 改为 upstream 新签名。 |
| `src/app/api/chat/route.ts` | 双边都改，可自动合并 | 人工复核。必须保留 fork 的 permission mode 映射、`referencedContexts` 持久化和 token duration，同时吸收 upstream 的 `/compact` 不入 DB、boundary filter、`streamSdkSessionId` handoff、`sessionSummaryBoundaryRowid` 传递。 |
| `src/lib/claude-client.ts` | 双边都改，可自动合并 | 人工复核。必须保留 fork 的 persistent session、on-demand MCP、bare/permission 策略等本地优化，同时吸收 upstream 的 XML prior-tool markers、reactive boundary rowid、retry stream session_id/result forwarding、统一 `context_compressed` 事件。 |
| `src/types/index.ts` | 双边都改，可自动合并 | 添加 `Message._rowid`、`ConversationHistoryItem`、`ClaudeStreamOptions.sessionSummaryBoundaryRowid`，同时保留 fork 的 `referenced_contexts`、duration/context usage 等类型。 |
| `src/__tests__/unit/sse-stream.test.ts` | 双边都改，可自动合并 | 保留本地 SSE 覆盖，并加入 upstream `buildContextCompressedStatus` dispatch 测试。 |
| `package.json`, `package-lock.json` | 双边都改，可自动合并 | 仅升级版本到 `0.51.1`，不引入依赖变化。 |
| `docs/handover/README.md` | 双边都改，可自动合并 | 加入 `compact-coverage-boundary.md` 索引，保留 fork 文档索引。 |

同步报告显示 upstream 独有 7 个文件、双边都改 8 个文件。fork 独有 287 个文件主要是既有 fork 增量，不属于本次 upstream 新变化的冲突范围。

## 吸收价值

值得吸收的原因：

1. 影响核心聊天可靠性。问题发生在长会话、自动压缩、手动 `/compact`、Claude Code SDK resume 的交叉路径，属于高频核心链路风险。
2. upstream 的修复包含 schema、route、SDK retry、SSE、normalizer、测试和交接文档，是闭环修复，不是局部补丁。
3. 与 fork 能力兼容。新增 boundary rowid 与我们已有的 provider overlay、Git 面板、文件树、媒体网关没有直接架构冲突。
4. 合并成本可控。实际文本冲突只有 `src/lib/db.ts` 一处，其他是语义复核。

主要风险：

1. `updateSessionSummary` 签名变为三参，会破坏未同步调用点。当前本地调用点主要在 `src/app/api/chat/route.ts` 和 `src/lib/claude-client.ts`，合并后必须全仓 `rg "updateSessionSummary\\("` 确认无旧签名。
2. `conversationHistory` 增加 `_rowid` 后，需要确保桥接、agent-loop 等非 DB 来源调用不强制要求 rowid。
3. `claude-client.ts` 是 fork 热点。自动合并可能把 upstream retry 修复插入到本地 persistent session/on-demand MCP 结构中，需要跑单测和一次长会话 compact 手测。

## 推荐吸收方案

### Phase 0 - 开隔离分支

从当前 `codex/main0510` 开同步分支，例如：

```bash
git switch -c codex/main/upstream-v0.51.1
npm run sync:bootstrap
```

不要在主分支直接 merge。

### Phase 1 - 先合入 upstream 并解决唯一硬冲突

执行：

```bash
git merge upstream/main
```

解决 `src/lib/db.ts`：

- 在 `context_summary_updated_at` 后同时保留 fork 三个编排字段和 upstream 两个 compact boundary 字段。
- `getSessionSummary` 返回 `{ summary, updatedAt, boundaryRowid }`。
- `updateSessionSummary(sessionId, summary, boundaryRowid)` 写入 `context_summary_boundary_rowid`。
- 保留 fork `createSession` 中 team/orchestration 字段插入逻辑。

### Phase 2 - 复核 shared 接缝

重点复核：

- `src/app/api/chat/route.ts`
  - `/compact` 不调用 `addMessage`。
  - `historyMsgs` 从 boundary filter 后生成，并携带 `_rowid`。
  - auto pre-compression 写入 `rowsToCompress.last._rowid`。
  - 压缩后 `updateSdkSessionId(session_id, '')`，本轮 `streamSdkSessionId` 改为 `undefined`。
  - `streamClaude` 同时保留 `referencedContexts` 与 `sessionSummaryBoundaryRowid`。

- `src/lib/claude-client.ts`
  - `buildFallbackContext` 使用 XML marker 说明。
  - reactive `CONTEXT_TOO_LONG` 使用 `resolveReactiveCompactBoundaryRowid`。
  - retry stream 转发新的 SDK `system init` 和 `result.session_id`。
  - 不能误删 fork 的 persistent session、on-demand MCP、bare startup、权限策略和 duration 采集。

- `src/types/index.ts`
  - `Message` 保留 `referenced_contexts` 并新增 `_rowid`。
  - `ClaudeStreamOptions` 保留 `referencedContexts`，新增 typed `ConversationHistoryItem[]` 和 `sessionSummaryBoundaryRowid`。

### Phase 3 - 测试与手测

至少执行：

```bash
npm run test
npm run sync:ownership
```

建议追加定向测试：

```bash
npm run test -- context-compressor-handoff
npm run test -- message-normalizer
npm run test -- sse-stream
```

手测：

1. 启动 `PORT=3001 npm run dev`，避免占用主目录默认端口。
2. 打开一个长会话，执行 `/compact`。
3. 确认 UI 收到 `context_compressed`，DB 不新增“上下文已压缩...” assistant 消息。
4. 继续发送需要工具调用的问题，确认模型发真实 tool_use，而不是输出 `(used Read: ...)` 或 XML marker 文本。
5. 检查 `chat_sessions.context_summary_boundary_rowid` 只前进不后退，`sdk_session_id` 在 compact handoff 后按预期刷新。

### Phase 4 - 文档和版本

- 保留 upstream `RELEASE_NOTES.md` 的 `0.51.1` 用户说明。
- 更新 `docs/handover/README.md`，加入 upstream compact boundary 文档索引。
- 如合并中调整了 fork 特有逻辑，补充 `docs/research/upstream-v0.51.1-absorption-plan.md` 的实际差异记录。

## 不建议吸收的内容

没有发现需要拒绝吸收的 upstream 改动。唯一需要避免的是用 upstream 整文件覆盖本 fork 的 shared 文件，尤其是：

- `src/app/api/chat/route.ts`
- `src/lib/claude-client.ts`
- `src/lib/db.ts`
- `src/types/index.ts`

这些文件必须按接缝合并，不能整文件替换。
