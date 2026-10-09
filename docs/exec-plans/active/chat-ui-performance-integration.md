# 聊天 UI 与性能整合

> 创建时间：2026-04-17
> 最后更新：2026-04-17

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状审查与回补边界确认 | ✅ 已完成 | 已确认 AskUserQuestion、skill nudge、CompletionBar、文件审查 API、referenced_contexts 主体仍在 |
| Phase 1 | 首轮响应链路诊断与低风险提速 | 🔄 进行中 | 先压首轮阻塞和首个可见反馈延迟 |
| Phase 2 | 工具过程 UI 收口与折叠策略重构 | 📋 待开始 | 运行中展开当前项，结束后自动折叠 |
| Phase 3 | 文件审查入口与上下文可见性接回 | 📋 待开始 | 恢复全局审查条、引用上下文与历史可回看 |
| Phase 4 | 验证与体验回归 | 📋 待开始 | 类型、单测、UI 检查、首轮链路验证 |

## 决策日志

- 2026-04-17: 不回滚到旧 Trae 风格整套实现，改为保留官方主链路，只回补高价值能力。
- 2026-04-17: 优先做“可见反馈 + 低风险提速”，避免用户把静默等待误判为卡死。
- 2026-04-17: 文件审查能力保留双入口，消息内 `CompletionBar` 用于本轮摘要，全局 `FileReviewBar` 用于统一待审查队列。
- 2026-04-17: 上下文展示采用“收集上下文”分组和引用标签，不恢复旧版大块冗余时间线。

## 目标

- 降低聊天首轮的首个可见状态时间与首个文本时间。
- 保留官方对话策略、权限流和技能提示逻辑，同时补回 fork 的可见性与审查能力。
- 将工具调用展示收敛为紧凑模式，避免命令、详情和输出默认铺开。
- 恢复“本轮改了哪些文件、可以点开 diff、可以统一审查”的主路径体验。

## 非目标

- 不整包回滚到旧版 Trae 时间线组件。
- 不重做 provider/runtime 架构。
- 不在本轮引入新的数据库表或大规模 schema 迁移。

## 详细设计

### Phase 1: 首轮响应链路提速

- `src/app/api/chat/route.ts`
  - 为首轮前关键阶段补充 trace 与可见 status：上下文装配、工具准备、启动模型。
  - 对“短历史 + 非 assistant workspace”的普通聊天跳过高成本上下文估算/压缩预检。
  - 尽早发送 `referenced_contexts` 事件，避免前端只能等首个文本才知道加载了哪些规则。
- `src/lib/context-assembler.ts`
  - 为 assistant workspace 的索引与装配阶段补充可观测信息。
  - 避免将非必要的重量级操作放在普通聊天首轮主路径。
- `src/lib/stream-session-manager.ts`
  - 将文本节流恢复到更平滑的阈值。
  - 为引用上下文与初始化状态保留 snapshot。

### Phase 2: 工具过程 UI 收口

- `src/components/ai-elements/tool-actions-group.tsx`
  - 运行中只展开当前项。
  - 完成后自动折叠，折叠态仅保留工具摘要。
  - `bash` 运行中只显示命令摘要 + 最近少量输出，完成后默认收起详情。
  - 上下文工具合并为“收集上下文”分组，完成后折叠为摘要。
- `src/components/chat/StreamingMessage.tsx`
  - 接入更紧凑的工具展示和更明确的状态文案。
- `src/components/chat/MessageList.tsx`
  - 修正 O(n²) 的 rewind 映射逻辑。

### Phase 3: 审查入口与上下文可见性

- `src/components/chat/ChatView.tsx`
  - 将 `FileReviewBar` 接回主聊天视图。
  - 将 stream snapshot 中的引用上下文透传到流式消息。
- `src/components/chat/MessageItem.tsx`
  - 保留历史消息中的引用上下文标签和文件变更摘要。
- `src/app/api/chat/route.ts`
  - 将 assistant 消息的 `referenced_contexts` 一并落库，确保刷新后仍可回看。

## 验收标准

- 首轮聊天在无文本前，用户能看到明确状态而不是长时间静默。
- 工具执行过程默认不再铺开大量命令/详情/输出，只保留当前运行项展开。
- 本轮修改文件后，消息内能查看变更摘要，聊天区还能看到统一待审查入口。
- 历史消息刷新后仍能看见引用上下文标签与文件变更摘要。
- AskUserQuestion、skill nudge、权限请求等官方交互能力保持可用。
