# 设计 Agent 结构化输出修复

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 复现问题 + 根因确认 | ✅ 已完成 | 已确认按钮状态和 `systemPromptAppend` 正常发送，但链路仍退化成普通聊天 |
| Phase 1 | 接入结构化输出约束 | ✅ 已完成 | 已使用 SDK `outputFormat` 约束 image request / batch plan 输出 |
| Phase 2 | 回填现有图片交互链路并验证 | ✅ 已完成 | 已补充简单请求直达图片卡片兜底，并完成浏览器验证 |

## 决策日志

- 2026-04-08: 当前设计 agent 不是独立模式，而是普通聊天请求附加一段系统提示词；这会导致弱遵循模型直接输出自然语言，从而绕开图片生成 UI。
- 2026-04-08: 优先使用 Claude Agent SDK 已支持的 `outputFormat`，而不是继续堆提示词，因为问题本质是输出契约不稳定。
- 2026-04-08: 为减少回归风险，后端把结构化输出转换回现有的 fenced block 文本，前端图片确认与批量预览组件保持不变。
- 2026-04-08: 用户当前 `env` provider 实际指向 `http://127.0.0.1:8000` 上的替身模型（`Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit`），简单图片请求不应继续依赖其规划速度和结构化能力，因此增加“简单请求直达 image-gen-request”的快速路径。

## 详细设计

### 目标

- 修复点击“设计 Agent”后请求退化为普通对话的问题。
- 让单张生成和批量生成都稳定进入现有图片确认/预览流程。
- 保持消息持久化格式与前端解析逻辑兼容，避免改动范围扩散。

### 已确认根因

- `src/components/chat/MessageInput.tsx` 里设计 agent 仍然走标准 `onSend(...)`，只是附加 `IMAGE_AGENT_SYSTEM_PROMPT`。
- `src/app/api/chat/route.ts` 只通过 `systemPromptAppend.includes('image-gen-request')` 判定是否是图片 agent 模式。
- `src/components/chat/StreamingMessage.tsx` / `src/components/chat/MessageItem.tsx` 只有在 assistant 文本中真正出现 ```image-gen-request``` 或 ```batch-plan``` 代码块时，才会切到图片生成 UI。
- 当前模型若没有严格遵守提示词，即使识别到这是设计 agent 模式，也只会返回普通文本。

### 方案

- 新增 image agent 的 JSON Schema，显式约束输出只能是单张生成或批量计划两种结构之一。
- 在 chat route 识别到设计 agent 模式时，把该 schema 通过 `outputFormat` 传给 `streamClaude(...)`。
- 在 `claude-client` 收到 SDK 的 `structured_output` 后，转换为现有的 ```image-gen-request``` / ```batch-plan``` fenced block，并继续通过现有 SSE `text` 事件下发。
- 对简单的单图请求，直接在 chat route 生成 `image-gen-request`，跳过慢模型规划；批量/文档类请求仍走模型分析。
- 保持前端解析和消息渲染组件不变，只增强后端输出稳定性。

### 验收标准

- 点击“设计 Agent”后发送“画一个红色苹果”，页面进入图片确认或批量计划预览，而不是普通助手文本。
- 继续支持参考图和 `useLastGenerated` 的编辑模式。
- `npm run typecheck` 通过。
- 本地浏览器实际验证设计 agent 流程，无新的 console 报错。
