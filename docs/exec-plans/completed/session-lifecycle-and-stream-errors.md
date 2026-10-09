# 会话生命周期与流式错误可见性执行计划

**状态：** 已完成（2026-10-09）  
**目标：** 上游错误（包括欠费）显示原始可理解信息；用户中断不会被迟到事件改写；侧栏每项目默认展示 5 条、清理过期历史，并为折叠项目显示未读完成蓝点。

## 设计决策

- 错误保持上游正文，不将欠费等问题伪装为正常结束；`result.is_error` 也是一条防御性错误信号。
- 用户取消具有最高优先级：取消后的 `error`、`result`、`aborted` 迟到帧不得覆盖已保存的内容或取消终态。
- 显示上限与保留策略独立：每项目显示 5 条；每项目最新 10 条永久保留，排名其后的会话仅在 7 天未打开时删除。
- 自动清理排除运行中、等待权限、被定时任务或渠道绑定的会话；已有会话迁移时把最后打开时间初始化为迁移时刻，提供完整 7 天缓冲。

## 影响文件

| 文件 | 责任 |
|---|---|
| `src/lib/claude-client.ts` | 从 SDK assistant/result 帧提取、转发错误；取消终态不发错误。
| `src/app/api/chat/route.ts` | 记录真实错误正文；用户取消后拒绝迟到错误覆盖。
| `src/hooks/useSSEStream.ts` | 将 `result.is_error/errors` 映射为错误终态；取消流不再接受后续终态。
| `src/lib/db.ts` | `last_opened_at` 迁移、访问标记和受保护会话的过期清理。
| `src/types/index.ts` | 会话访问时间字段与清理辅助类型。
| `src/app/api/chat/sessions/route.ts` | 会话打开标记与节流式过期清理。
| `src/app/chat/[id]/page.tsx` | 明确标记用户进入会话，而不是让刷新 GET 改写访问时间。
| `src/components/layout/ChatListPanel.tsx` | 展示上限 5、项目未读完成聚合。
| `src/components/layout/ProjectGroupHeader.tsx` | 折叠项目的蓝色完成指示器。
| `src/i18n/en.ts`、`src/i18n/zh.ts` | 指示器无障碍提示。
| `src/__tests__/unit/sse-stream.test.ts` | 欠费/结果错误和取消后迟到帧回归用例。
| `src/__tests__/unit/session-retention.test.ts` | 迁移、每项目保留、7 天边界和保护规则。

## 实施任务

### 1. 先锁定流式终态契约（TDD） ✅

- [ ] 在 `src/__tests__/unit/sse-stream.test.ts` 新增：`result` 事件 `{ is_error: true, errors: ['余额不足'] }` 会调用一次 `onError('余额不足')`，并以 `terminalReason: 'error'` 完成。
- [ ] 运行该单测，确认它在实现前失败（当前 `result` 分支忽略 `is_error` 与 `errors`）。
- [ ] 新增：在 `aborted: { reason: 'user_cancel' }` 后输入 `error` 或错误 `result`，回调仍只保留取消终态与既有文本。
- [ ] 在 `useSSEStream.ts` 引入单一终态守卫；`user_cancel` 锁定后忽略后续错误终态。错误 `result` 优先使用 `errors[]`，缺失时使用稳定的兜底文案；正常 `result` 行为不变。
- [ ] 重新运行单测，确认新增用例与现有流测试均通过。

### 2. 保留并持久化 SDK 上游错误（TDD） ✅

- [ ] 在 `src/__tests__/unit/sse-stream.test.ts` 或现有 route 静态回归测试中加入断言：SDK `SDKResultError.errors` 在 `claude-client.ts` 产生错误 SSE；assistant 的 `error` 正文也可成为候选错误。
- [ ] 先运行用例，确认当前实现没有转发 `errors`。
- [ ] 在 `src/lib/claude-client.ts` 收集最终 assistant 错误，并在两个 result 发送点（主路径与压缩重试路径）传递 `errors`、`terminal_reason: 'error'`。先送 `error` SSE，再送最终 result；若 abort controller 已取消，不发送该错误。
- [ ] 在 `src/app/api/chat/route.ts` 读取 `result.errors`，为 `is_error` 写入同一条详细 `errorMessage`，但当 `abortReason === 'user_cancel'` 时不写错误消息或错误状态。
- [ ] 运行目标测试，确认欠费文案写入会话且用户取消仍显示“任务已由用户手动中断”。

### 3. 增加安全的会话访问时间和自动清理（TDD） ✅

- [ ] 创建 `src/__tests__/unit/session-retention.test.ts`，在隔离 SQLite 数据库中覆盖：现有行迁移后有 `last_opened_at`；每项目最近 10 条不会删除；第 11 条及后的 7 天边界；更新访问时间后可续期；运行/等待权限、定时任务、渠道绑定会话均受保护。
- [ ] 运行新测试，确认缺失 schema 与清理函数导致失败。
- [ ] 在 `src/lib/db.ts` 为 `chat_sessions` 增加 `last_opened_at` 和索引；使用 `safeAddColumn` 增量迁移，并一次性回填空值。新增 `markSessionOpened(id)`、`cleanupStaleSessions(now)`；清理按 `working_directory` 分区、`updated_at DESC, id DESC` 排名，使用现有 `deleteSession()` 事务。
- [ ] 在 `src/types/index.ts` 补充会话字段；在 `src/app/api/chat/sessions/route.ts` 增加显式打开标记端点或参数，并在列表 GET 中以服务器端节流触发清理。
- [ ] 在 `src/app/chat/[id]/page.tsx` 仅在实际路由进入时调用打开标记；不会由 `ChatView` 的刷新读取触发。
- [ ] 运行保留测试，确认数据库行为及保护条件通过。

### 4. 调整侧栏可见性与项目完成提示（TDD） ✅

- [ ] 为 `ChatListPanel`/`ProjectGroupHeader` 添加渲染回归测试：每组默认只显示 5 条；收起且有未读完成显示蓝点；运行中绿点与蓝点可以同时存在；展开或进入会话后蓝点不显示。
- [ ] 运行测试，确认当前 10 条上限和缺少项目蓝点令其失败。
- [ ] 在 `ChatListPanel.tsx` 将显示常量设为 5，并从现有 `unreadCompletions` 汇总 `hasUnreadCompletion` 传给项目头。保留活动会话强制可见的既有行为。
- [ ] 在 `ProjectGroupHeader.tsx` 新增独立的蓝色完成指示器，仅在折叠时渲染；不复用或替换绿色运行指示器。
- [ ] 同步 `src/i18n/en.ts`、`src/i18n/zh.ts` 的 tooltip/aria 文案。
- [ ] 运行相关单测与 TypeScript 检查。

### 5. 集成验证 ✅

- [ ] 运行 `npm run test`。
- [ ] 启动当前工作区的开发服务并用 CDP 验证：每项目只展示五条、折叠项目出现蓝点、点击会话清除蓝点；检查浏览器 console 无错误。
- [ ] 手动或测试桩验证：欠费结果显示详细错误；主动停止后内容保留且不再变成错误。
- [ ] 检查 `git diff --check` 和 `git status --short`，确保只报告本任务新增改动，绝不覆盖当前已有的用户改动。
