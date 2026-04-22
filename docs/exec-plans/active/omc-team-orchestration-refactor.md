# OMC Team Orchestration Refactor

> 创建时间：2026-04-23
> 最后更新：2026-04-23

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 架构设计与文档编写 | ✅ 已完成 | 确定了动态路由、DAG 执行和闭环验证的方案 |
| Phase 1 | DAG 任务生成器（Planner Upgrade） | ✅ 已完成 | 重写 `team-runner.ts` 的入口，调用 Planner 生成执行图 |
| Phase 2 | 并发执行引擎（Parallel Execution） | ✅ 已完成 | 实现 `runTeamDAG`，用 `Promise.all` 替代 `for...of` |
| Phase 3 | 模型智能路由（Multi-Head Routing） | ✅ 已完成 | 将 `tools/agent.ts` 中的模型分流逻辑下沉并复用 |
| Phase 4 | 验证反馈闭环（Verification Loop） | ✅ 已完成 | 实现 `verifier` 失败自动拉起 `debugger` -> `executor` 的重试机制 |
| Phase 5 | 前端 UI 兼容性适配 | ✅ 已完成 | 确保 SSE 事件和 `TeamLeaderWidget` 兼容并行输出 |

## 决策日志

- 2026-04-23: 决定彻底废弃硬编码的 `search -> planner -> executor -> verifier` 串行管线，改为真正的 OMC 多智能体动态编排（DAG 并发 + 智能路由 + 验证死循环）。

## 详细设计

### 1. 目标
解决当前 `/team` 模式仅为串行 POC 玩具的问题，彻底激活系统内配置的 20+ 个智能体，实现：
1. **动态路由**：根据用户指令动态决定使用哪些 Agent（如 UI 任务唤醒 `designer`，测试任务唤醒 `test-engineer`）。
2. **并发执行**：无依赖关系的 Agent（如 `explore` 和 `document-specialist`）并行运行。
3. **闭环迭代**：测试不通过时自动触发 Debugger 进行修复。

### 2. 技术方案

#### Phase 1: 动态 DAG 计划生成
- 在 `team-runner.ts` 中，当收到 `goal` 时，首先唤醒 `planner`。
- 向 `planner` 注入系统内所有可用子 Agent 的清单（`getSubAgents()`）。
- 强制 `planner` 输出一个标准化的 JSON 结构（Task DAG），例如：
  ```json
  {
    "tasks": [
      { "id": "t1", "role": "explore", "prompt": "探索项目结构" },
      { "id": "t2", "role": "document-specialist", "prompt": "查阅支付 API", "dependsOn": [] },
      { "id": "t3", "role": "designer", "prompt": "设计 UI", "dependsOn": ["t1"] },
      { "id": "t4", "role": "executor", "prompt": "实现代码", "dependsOn": ["t2", "t3"] },
      { "id": "t5", "role": "verifier", "prompt": "跑测试验证", "dependsOn": ["t4"] }
    ]
  }
  ```

#### Phase 2: 并发执行器 (`runTeamDAG`)
- 构建一个任务调度器。
- 维护一个 `completedTasks` 集合。
- 循环检查哪些任务的 `dependsOn` 已经满足，如果满足则丢入 `Promise.all` 中并行执行 `runAgentLoop`。
- 将已完成任务的 Report 累加到全局上下文中，供后续依赖任务使用。

#### Phase 3: 模型路由
- 复用 `provider-resolver`，针对不同角色分配最优模型。
- `haiku`: `explore`, `search`, `writer`, `document-specialist`
- `sonnet`: `executor`, `debugger`, `verifier`
- `opus`: `architect`, `planner`, `critic`

#### Phase 4: 验证反馈死循环
- 特殊处理 `verifier` 或 `qa-tester` 的执行结果。
- 若报告中出现明显的失败标志（需提示模型输出明确的状态），调度器拦截结束信号。
- 动态向 DAG 中追加新的任务节点：`debugger` (根因分析) -> `executor` (修复代码) -> `verifier` (重试)。
- 设置全局 `max_retries = 3` 以防止无限循环。

### 3. 影响范围
- `src/lib/team-runner.ts`：核心重构
- `src/lib/tools/agent.ts`：提取模型路由公共函数
- UI 组件（`TeamLeaderWidget` 等）：需确认多事件并发时的渲染稳定性。
