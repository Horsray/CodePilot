# Hermes Agent 分析 — 与 CodePilot Native Runtime 的结合机会

> 分析日期：2026-04-09
> 项目地址：https://github.com/NousResearch/hermes-agent
> 版本：v0.8.0

## 项目概述

Hermes Agent 是 Nous Research 开发的自主学习 AI Agent 框架。核心定位：**闭环学习 Agent**——从经验中自动创建 Skill、在使用中改进、主动持久化知识、跨会话搜索历史、逐步建立用户画像。

技术栈：Python + SQLite + prompt_toolkit CLI，支持 8 个 IM 平台（Telegram/Discord/Slack/WhatsApp/Signal/Matrix/钉钉/飞书），109+ LLM Provider。

代码规模：~400 个 Python 文件，50,000+ 行核心逻辑。

## 架构要点

### Agent Loop（run_agent.py，9,660 行）

```
run_conversation(user_message)
  while iteration < budget.remaining:
    ├─ 预检压缩（token 接近上限时触发）
    ├─ 插件上下文注入（pre_llm_call hooks）
    ├─ 外部记忆预取（缓存，每轮一次）
    ├─ LLM 调用（可中断，流式输出）
    ├─ 并行工具执行（安全检查后最多 8 workers）
    ├─ 工具结果后处理 + 追加到历史
    └─ 退出条件检查（end_turn / 中断 / 预算耗尽 / 步数上限）
```

### Provider 架构

三种传输协议：
- `openai_chat` — OpenAI 兼容 API（大部分 provider）
- `anthropic_messages` — Anthropic Messages API
- `codex_responses` — Codex 协议（ChatGPT backend-api、OpenCode）

Provider 数据源：models.dev 目录 + Hermes 覆盖层 + 用户自定义端点。

辅助模型（Auxiliary Client）：用便宜模型做摘要/视觉/压缩，主模型专注推理。

### 工具系统

58 个工具模块，自注册模式：
- terminal / file / browser / web / vision / delegation / memory / skills / cron / mcp
- 每个工具声明 schema、handler、check_fn、max_result_size 等元数据
- 安全的并行执行：只读工具可并行，写操作按路径检测冲突

### 记忆系统

```
MemoryManager
  ├─ BuiltinMemoryProvider（MEMORY.md / USER.md 文件系统）
  └─ 可插拔外部 Provider（Honcho / Mem0 / Supermemory 等 9 个）
```

特点：每轮预取 + 响应后同步、XML 围栏防止模型混淆、provider 故障隔离。

### 上下文压缩

LLM 驱动的结构化压缩：
1. 裁剪旧工具结果（廉价预处理）
2. 保护头部（system + 首轮交换）
3. 保护尾部（最近 ~20K tokens）
4. 摘要中间部分（Goal / Progress / Decisions / Files / Next Steps 模板）
5. 迭代更新（多次压缩保留信息）

## 与 CodePilot 的对比

| 维度 | Hermes | CodePilot (Native Runtime) |
|------|--------|---------------------------|
| Agent Loop | Python while 循环 + 并行执行 | TS while 循环 + 顺序执行 |
| Provider | 109+ via models.dev | 28+ VENDOR_PRESETS 手动维护 |
| 工具执行 | 并行（8 workers + 安全检查） | 顺序 |
| 上下文压缩 | LLM 驱动结构化摘要 | pruneOldToolResults 简单裁剪 |
| 辅助模型 | 有（摘要/视觉/压缩） | 无 |
| Skill 系统 | 自动创建 + 学习循环 | 手动创建 + 发现/执行 |
| 记忆 | 可插拔后端 + 主动 nudge | 内置文件系统 |
| IM 网关 | 8 平台 | Telegram + 飞书 |
| 迭代预算 | 可退款 + 跨 agent 共享 | 固定 maxSteps |
| MCP | 1.2+ 含 sampling | 基础连接 + 工具调用 |
| 定时任务 | 内置 cron + 跨平台投递 | 内置 scheduler（应用内投递） |
| 编辑器集成 | ACP 协议适配器 | 无 |

## 可借鉴的能力（按优先级）

### P0 — 直接增强现有 Runtime

**1. 并行工具执行**

当前 agent-loop 每步只执行一个 tool call 的结果。AI SDK 的 `streamText` 本身支持多个 tool call 并行返回，但我们没有利用这个能力。

Hermes 的做法：
- `_should_parallelize_tool_batch()` 检查一批 tool calls 是否安全并行
- 只读工具（Read/Glob/Grep）始终可并行
- 写操作按文件路径检测冲突
- `_NEVER_PARALLEL_TOOLS` 黑名单（需要用户交互的工具）
- 最多 8 个 worker 线程

对我们的意义：AI SDK 已经在一次 `streamText` 中返回多个 tool-call，我们只需要确保 tool execute 可以并行。当前 AI SDK 默认就是并行执行 tool calls 的——我们不需要额外改动，只需确认没有序列化瓶颈。

**2. LLM 驱动的上下文压缩**

当前 `pruneOldToolResults` 只做简单裁剪（保留最近 6 轮的 tool result 细节，更早的替换为摘要占位）。长对话中上下文质量会显著下降。

Hermes 的做法：
- 保护头部（system prompt + 首轮）和尾部（最近 ~20K tokens）
- 中间部分用辅助模型生成结构化摘要
- 摘要模板：Goal / Progress / Decisions / Files Modified / Next Steps
- 多次压缩时保留之前的摘要内容

建议接入方式：
- 在 `context-pruner.ts` 中加 `compressWithLLM()` 路径
- 用 `text-generator.ts` 调用当前 provider 的小模型（如 Haiku）做摘要
- 触发条件：当 `estimateTokens()` 超过上下文窗口 70% 时

**3. 辅助模型（Auxiliary Client）**

当前所有操作（对话、工具结果处理、摘要）都用同一个主模型。Hermes 用便宜模型做：
- 网页内容提取摘要
- 工具结果过长时的裁剪摘要
- 上下文压缩
- 视觉分析（截图理解）

建议接入方式：
- 在 provider-resolver 中加 `resolveAuxiliaryModel()` 函数
- 默认用同 provider 的最小模型（Anthropic→Haiku，OpenAI→GPT-5.4-Mini）
- 压缩和摘要场景调用辅助模型而非主模型

**4. 迭代预算优化**

当前固定 `maxSteps=50`，不区分操作类型。Hermes 的 `IterationBudget` 支持：
- 非交互工具调用（execute_code）退款——不消耗预算
- 父子 agent 共享总预算（防止子 agent 无限消耗）
- 接近预算时发出警告

建议：在 agent-loop 中加预算管理，Read/Glob/Grep 不计入步数。

### P1 — 中期集成

**5. Skill 自动创建**

Hermes 在完成复杂多步任务后，主动建议"要不要把这个流程保存为 Skill"。我们有 Skill 系统（parser/discovery/executor）但没有自动创建能力。

接入方式：在 agent-loop 结束时检查步数和工具调用复杂度，超过阈值时在 system prompt 中加 nudge 提示。

**6. 记忆 Plugin 框架**

我们的记忆系统是内置的（assistant workspace + memory files）。Hermes 的可插拔设计允许用户选择不同的记忆后端。

长期可考虑：定义 `MemoryProvider` 接口，内置实现保持不变，允许通过 MCP 或配置挂载外部记忆服务。

**7. Session 搜索**

Hermes 有 `session_search_tool`，用 SQLite FTS5 在历史会话中全文搜索。我们的 DB 有完整消息历史但没有搜索工具暴露给模型。

### P2 — 长期参考

| 能力 | 说明 |
|------|------|
| models.dev Provider 目录 | 比手动维护 VENDOR_PRESETS 更可持续，OpenCode 也用这个 |
| ACP 协议适配 | 让 Cursor/VSCode 直接调用 CodePilot 的 Agent 能力 |
| 定时任务跨平台投递 | 任务完成后推送到 Telegram/Discord |
| RL 训练数据生成 | 对话 trajectory 压缩 → 微调数据 |
| Codex Responses Transport | 结构化的 Codex 协议适配器，比 custom fetch 拦截器更规范 |

## 不建议借鉴的部分

| 部分 | 原因 |
|------|------|
| Python 实现 | 我们是 TS/Next.js 栈，直接移植不现实 |
| 9,660 行单文件 agent loop | 已知技术债，Hermes 自己也在拆分 |
| 网关的 355KB 单文件 | 同上 |
| 完整的 browser 工具 | 我们有 chrome-devtools MCP，功能重叠 |
| 多平台网关 | 我们的 bridge 系统已经支持 Telegram/飞书，架构不同 |

## 总结

Hermes 最值得我们学习的不是具体实现（Python vs TS），而是**设计理念**：

1. **工具安全并行** — 不是所有工具都必须串行
2. **上下文压缩不是裁剪而是摘要** — LLM 驱动的结构化压缩远优于简单裁剪
3. **辅助模型降本** — 不是所有操作都需要最强模型
4. **学习闭环** — Agent 应该从经验中主动创建可复用知识
5. **预算而非步数** — 不同操作的"代价"不同，应该区分计量
