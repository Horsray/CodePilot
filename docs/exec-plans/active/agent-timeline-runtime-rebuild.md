# 智能体时间线交互系统重构

> 创建时间：2026-04-10
> 最后更新：2026-04-10

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状梳理与重构边界确认 | ✅ 已完成 | 已确认当前仅有 `thinking/tool_use/tool_result/status` 粒度，缺少步骤实体 |
| Phase 1 | 统一时间线步骤模型与流式事件归并层 | 🔄 进行中 | 新增 timeline step/event 数据结构，兼容现有消息存储 |
| Phase 2 | 聊天区时间线 UI 重构 | 📋 待开始 | 将 `StreamingMessage` / `MessageItem` 切换为步骤式渲染 |
| Phase 3 | 连接保持、断线恢复、自动重试 | 📋 待开始 | 强化 keepalive、静默断流识别、状态恢复 |
| Phase 4 | 错误分类、工具失败自修复、回滚入口整合 | 📋 待开始 | 打通工具失败反馈、rewind/checkpoint 回滚能力 |
| Phase 5 | 验证与回放一致性修正 | 📋 待开始 | 覆盖流式态、落库态、页面重挂载、错误态 |

## 决策日志

- 2026-04-10: 不新建独立 timeline 表，优先把 timeline 作为 `messages.content` 的结构化 block 持久化，避免先做 DB 迁移扩大风险面。
- 2026-04-10: 时间线层采用“统一步骤模型 + 流式归并器”方案，替代当前 `toolUses/toolResults/statusText` 的松散拼接。
- 2026-04-10: 保留现有 `rewind/checkpoint` 机制，先将其接入时间线步骤与文件变更卡片，避免破坏既有回滚链路。

## 详细设计

### 目标

- 在一次智能体执行中，按时间顺序展示明确的步骤实体，而不是只展示零散的工具调用。
- 每个步骤包含：状态、思考过程、文本产出、工具调用、修改内容、diff 摘要、依赖关系、错误信息、重试信息。
- 流式展示与历史回放使用同一套步骤模型，保证“正在执行时看到的内容”和“刷新后的历史消息”一致。
- 在现有架构上做增量重构，不打断当前消息持久化、rewind、工具权限与原生 runtime 逻辑。

### 核心方案

- 在 `src/types/index.ts` 中新增 timeline 相关类型，并扩展 `MessageContentBlock`，允许 assistant 消息携带 `timeline` block。
- 在 `src/lib/agent-timeline.ts` 中实现步骤归并器：
  - 接收 thinking / text / tool_use / tool_result / status(step_complete) 等事件
  - 维护“当前步骤”
  - 提取文件改动摘要与 diff 预览
  - 输出稳定的 `TimelineStep[]`
- 在 `stream-session-manager` 中维护流式 timeline snapshot：
  - 流式 UI 直接消费步骤数组
  - stream 结束时将 timeline 一并写入 `finalMessageContent`
  - 为后续断线恢复保留可序列化 snapshot 基础
- 在 `chat/route.ts` 的落库收集阶段，同步构建 timeline block，保证回放一致。
- 在 `StreamingMessage` / `MessageItem` 中渲染 Trae 风格时间线：
  - 步骤状态标识
  - 思考内容
  - 工具调用明细
  - 代码修改与 diff 卡片
  - 错误与恢复信息
  - 步骤依赖提示

### 恢复与错误治理方向

- keepalive / idle timeout 保留，并将“静默断流”显式标记为可恢复错误。
- stream snapshot 序列化为可恢复状态，为页面重挂载和后续自动恢复预留基础。
- 工具失败保留原结果，同时生成可重试/可修复的 timeline 状态，避免整轮执行直接卡死。
- 回滚先复用 `rewind/checkpoint`，在时间线文件卡片处提供统一入口。

### 验收标准

- 流式消息区能按步骤展示执行过程，且工具调用、思考、diff、状态可追踪。
- 消息落库后刷新页面，历史消息仍按时间线形式正确回放。
- 工具失败、流中断、手动停止三种场景能显示明确状态，不再只表现为散乱文本。
- 不破坏现有对话发送、权限请求、rewind、消息导入与上下文组装流程。
