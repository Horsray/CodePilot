# 多Agent编排架构重构 V2 — 对齐 OMC 策略

> 创建时间：2026-04-25
> 最后更新：2026-04-25
> 前置依赖：docs/exec-plans/active/omc-team-orchestration-refactor.md（已完成，V1 基础）

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 架构调研与方案设计 | ✅ 已完成 | 对比 OMC 源码，确认差距和可行路径 |
| Phase 1 | 去除 planner LLM，父 agent 直接编排 | ✅ 已完成 | 核心架构变更，父 agent 直接调 Agent tool 编排 |
| Phase 2 | 子 agent 非嵌套约束 + 上下文隔离 | ✅ 已完成 | spawn 模式移除 Agent/Team 工具 + system prompt 约束 |
| Phase 3 | 验证协议 + 熔断升级机制 | ✅ 已完成 | verifier 结构化证据协议 + 编排 prompt 熔断升级 |
| Phase 4 | 作者/审查分离 + 质量评估 | ✅ 已完成 | code-reviewer 独立审查协议 + 编排 prompt 审查分离 |
| Phase 5 | UI 兼容性验证 + 回归测试 | ⏸ 暂缓 | 非必要，SSE 事件格式未变，dev 环境验证即可 |

## 决策日志

- 2026-04-25: 基于 OMC 源码对比分析，确认当前 DAG planner 架构是 token 浪费的根因。决定从"程序化 DAG 调度"转向"父 agent 直接编排"，与 OMC 策略对齐。
- 2026-04-25: 用户明确要求保留现有 UI 渲染样式（子 agent 卡片、team leader 卡片、紫色团队协作卡片）。SSE 事件结构不变。
- 2026-04-25: Phase 1-4 全部完成。Phase 5 暂缓（SSE 事件格式未变，dev 环境验证即可）。核心架构从"DAG planner LLM"转向"父 agent 直接编排"，与 OMC 策略对齐。
- 2026-04-25: 发现并修复 `runTeamPipeline()` 中的两个关键 bug：(1) `prompt` 和 `systemPrompt` 都设置为 `orchestrationPrompt`，导致模型收到重复/混乱的指令；(2) 父 agent 使用 `executionMode: 'spawn'`，导致 Agent/Team 工具被排除，父 agent 无法 spawn 子 agent。这两个 bug 是"模型未返回任何内容"错误的根因。

## 问题诊断

### 根因：V1 架构的 token 浪费

当前 `runTeamPipeline()` 的执行链路：

```
用户消息
  → generateTeamDAG()
    → executeAgentTask(role='planner')     ← 额外 LLM 调用，~5000-10000 token
      → runAgentLoop(planner)              ← planner 的 thinking + 工具调用
      → 输出 JSON DAG
  → 对 DAG 中每个任务:
    → executeAgentTask(task)
      → truncateToTokenBudget(accumulatedContext, 15000)  ← 累积上下文膨胀
      → runAgentLoop(agent)                               ← 每个子 agent 独立 loop
        → 子 agent 可调用 tools/agent.ts                  ← 递归嵌套
  → verifier 失败 → 追加 3 个任务（debugger + executor + verifier）
  → 最多重试 3 次 = 额外 9 个任务
```

一个分析类任务可以触发 20+ 子任务，消耗 15-30 万 token。

### OMC 的做法

```
用户消息
  → Claude（同一个 LLM）在正常推理中决定:
    "这个任务需要 3 个 agent 并行，我直接 spawn"
  → 3 次 spawn_agent（Claude Code 原生并行）
  → worker 完成 → SendMessage 报告
  → Claude 收到结果 → 决定下一步或结束
```

没有额外 planner 调用。没有上下文累积。没有递归嵌套。~2-3 万 token。

### 报告遗漏的关键问题

对比报告（`CodePilot多Agent系统分析报告.md`）识别了 5 个功能短板，但遗漏了：

1. **Token 浪费** — 未分析 planner 额外调用和上下文累积的成本
2. **任务过度分解** — 未识别 20 任务膨胀问题
3. **递归嵌套** — 未提及子 agent 可以再派子 agent 的问题
4. **架构方向** — 建议在 DAG 上加功能，而非换架构

报告的价值在于：熔断升级、验证协议、作者/审查分离 这 3 个建议是独立于架构的，应该并入本计划。

## 详细设计

### Phase 1: 去除 planner LLM，父 agent 直接编排

**目标**：消除 `generateTeamDAG()` 的额外 LLM 调用，让父 agent 自己决定如何编排。

**方案**：

1. **重构 Team 模式入口**
   - 当前：用户消息 → `runTeamPipeline()` → `generateTeamDAG()` → planner LLM → DAG 执行
   - 改为：用户消息 → 父 agent `runAgentLoop()`（带 OMC 风格 system prompt）→ 父 agent 直接调用 Agent tool spawn 子 agent
   - `runTeamPipeline()` 改为"启动父 agent loop 并注入 team 编排 system prompt"

2. **System prompt 注入 OMC 风格编排指令**
   ```
   你是 Team Leader。根据用户目标决定是否需要子 agent 协作。

   规则：
   - 简单任务（分析、审查、解释）直接完成，不 spawn 子 agent
   - 需要并行时，一个 turn 内调用多次 Agent tool
   - 最多 4 个并发子 agent
   - 子 agent 不允许再 spawn 子 agent
   - 验证：所有代码修改必须经过独立审查
   - 熔断：连续 2 次失败后质疑策略，而非继续重试
   ```

3. **保留 `buildFallbackDAG()` 作为降级路径**
   - 如果父 agent 无法正常编排（如模型不支持工具调用），降级到现有的 DAG 模式
   - 这是安全网，不是主要路径

**修改文件**：
- `src/lib/team-runner.ts` — 重构 `runTeamPipeline()` 入口
- 新建 `src/lib/team-orchestration-prompt.ts` — 编排 system prompt 模板

**验收标准**：
- 简单分析任务（<80 字符）不触发 planner 调用，直接由父 agent 完成
- 复杂任务由父 agent 直接 spawn 子 agent，不经过 planner LLM
- 保留 `buildFallbackDAG()` 降级路径
- SSE 事件格式不变

### Phase 2: 子 agent 非嵌套约束 + 上下文隔离

**目标**：阻断递归嵌套，减少上下文累积。

**方案**：

1. **非嵌套约束**
   - 在 `tools/agent.ts` 的子 agent system prompt 中注入：
     ```
     你是子 agent。禁止：
     - 使用 Agent tool 再 spawn 子 agent
     - 调用任何 team/orchestration 相关工具
     - 直接完成任务并返回报告
     ```
   - 在 `assembleTools()` 中，当 `executionMode === 'spawn'` 时，移除 Agent tool

2. **上下文隔离**
   - 当前：`accumulatedContext` 累积所有任务报告，传递给后续任务
   - 改为：每个子 agent 只接收父 agent 的任务描述 + 前置依赖的关键摘要（<2000 token）
   - 移除 `accumulatedContext += report` 的累积逻辑

**修改文件**：
- `src/lib/tools/agent.ts` — 注入非嵌套约束
- `src/lib/agent-tools.ts` — spawn 模式下移除 Agent tool
- `src/lib/team-runner.ts` — 改变上下文传递策略

**验收标准**：
- 子 agent 无法调用 Agent tool（工具列表中不存在）
- 子 agent system prompt 包含非嵌套约束
- 后续任务不接收前序任务的完整报告，只接收关键摘要

### Phase 3: 验证协议 + 熔断升级机制

**目标**：引入 OMC 的验证协议和熔断升级（报告 P0 建议）。

**方案**：

1. **结构化验证协议**
   - verifier 的 prompt 增加证据标准：
     ```
     验证时必须提供：
     1. 具体的证据（文件路径、行号、测试输出）
     2. 明确的 pass/fail 判定
     3. 如果 fail，列出具体的失败项
     ```
   - 参考 OMC: "Verify before claiming completion. Size appropriately."

2. **熔断升级**
   - 当前：`MAX_RETRIES=1`（已从 3 降到 1）
   - 增加熔断逻辑：连续 2 次失败后，不是继续重试，而是：
     a. 输出诊断报告（失败原因、尝试过的方案）
     b. 建议用户介入（换模型、简化任务、手动干预）
   - 参考 OMC: "If 3+ fix attempts fail, question the architecture rather than trying variations"

**修改文件**：
- `src/lib/agent-registry.ts` — verifier 的 prompt 更新
- `src/lib/team-runner.ts` — 熔断升级逻辑

**验收标准**：
- verifier 输出包含结构化证据
- 连续失败后输出诊断报告而非继续重试

### Phase 4: 作者/审查分离 + 质量评估

**目标**：实现代码修改的独立审查（报告 P1 建议）。

**方案**：

1. **作者/审查分离**
   - executor 完成代码修改后，自动触发独立的 code-reviewer 或 verifier 审查
   - 在 system prompt 中强制："代码修改完成后，必须经过独立审查才能声称完成"
   - 参考 OMC: "Keep authoring and review as separate passes"

2. **子 agent 结果质量评估**
   - 父 agent 收到子 agent 报告后，评估质量：
     - 报告是否为空或过于简短
     - 是否包含具体的证据（文件路径、代码片段）
     - 是否有明确的完成/失败状态
   - 低质量报告触发重试或换 agent

**修改文件**：
- `src/lib/team-orchestration-prompt.ts` — 审查分离指令
- `src/lib/team-runner.ts` — 质量评估逻辑

### Phase 5: UI 兼容性验证 + 回归测试

**目标**：确保所有改动不影响现有 UI 渲染。

**方案**：

1. **SSE 事件兼容性**
   - 必须继续发送的事件类型：
     - `subagent_start` — 触发子 agent 卡片创建
     - `subagent_progress` — 更新子 agent 卡片进度
     - `subagent_complete` — 子 agent 卡片完成状态
     - `team_start` / `team_dag_ready` / `team_done` — 紫色团队协作卡片
     - `tool_output` — 工具输出显示
   - 新的父 agent 编排模式必须在适当时机发送这些事件

2. **UI 回归测试**
   - 启动 dev server → CDP 打开页面 → 发送 Team 任务 → 验证：
     - 紫色团队协作卡片正常显示
     - 子 agent 卡片正常创建和更新
     - Team leader 卡片正常显示
     - 展开后可以看到任务详情

**修改文件**：
- `src/lib/team-runner.ts` — 确保 SSE 事件发送逻辑不变
- `src/components/chat/SubAgentTimeline.tsx` — 验证渲染逻辑（只读，不修改）

## 影响范围

| 文件 | 改动类型 | 风险 |
|------|----------|------|
| `src/lib/team-runner.ts` | 重构 | 高 — 核心编排逻辑 |
| `src/lib/tools/agent.ts` | 修改 | 中 — 非嵌套约束 |
| `src/lib/agent-tools.ts` | 修改 | 中 — 工具过滤 |
| `src/lib/agent-registry.ts` | 修改 | 低 — prompt 更新 |
| `src/lib/team-orchestration-prompt.ts` | 新建 | 低 — 纯 prompt 模板 |
| UI 组件 | 不修改 | 无 — 只验证不改 |

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 父 agent 不擅长编排决策 | 中 | 任务分解质量下降 | 保留 `buildFallbackDAG()` 降级路径 |
| 子 agent 工具受限导致功能缺失 | 低 | 某些任务无法完成 | spawn 模式保留除 Agent 外的所有工具 |
| SSE 事件时序变化导致 UI 异常 | 中 | 卡片渲染问题 | Phase 5 专项验证 |
| 模型不支持并行 Agent 调用 | 低 | 无法并行执行 | 降级到串行模式 |

## 验收标准

1. 简单分析任务不触发额外 LLM 调用，直接完成
2. 复杂任务的子 agent 数量 ≤ 4（不含 verifier）
3. 子 agent 无法递归 spawn 子 agent
4. Token 消耗比 V1 减少 50%+（同等任务）
5. 紫色团队协作卡片、子 agent 卡片、team leader 卡片正常渲染
6. 所有现有测试通过
