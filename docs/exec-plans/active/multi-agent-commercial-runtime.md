# 多Agent商用级编排能力补齐

> 创建时间：2026-04-25
> 最后更新：2026-04-25

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | `/team` 确定性入口与 Agent/Team 入口收敛 | 已完成 | `/team` 直接进入 Team pipeline |
| Phase 2 | 持久化 Team Job / Task / Event runtime | 已完成 | `.omc/state/team-jobs/` 保存状态、事件、handoff |
| Phase 3 | Stage pipeline、handoff、token/模型路由与验证闭环 | 已完成 | DAG fallback 按 stage 写入 handoff 和 token 估算事件 |
| Phase 4 | 统一测试与回归验证 | 已完成 | `npm run test` + `npm run test:smoke` 通过 |

## 决策日志

- 2026-04-25: 先采用文件型 runtime 而非 DB migration，原因是当前工作区已有大量改动，文件状态可恢复、可审计，且更接近 OMC 的 `.omc/state` 设计。
- 2026-04-25: `/team` 必须进入确定性 Team pipeline，不能只依赖 system prompt 诱导模型调用 `Agent`。
- 2026-04-25: 子 agent 进度用于 UI，父 agent 汇总只消费结构化报告与 handoff，降低 token 噪音。
- 2026-04-25: 验证通过 `npm run test` 和 `npm run test:smoke`，本阶段收敛为可恢复的 V1 runtime。

## 详细设计

目标是把当前“单次 SSE 流里的嵌套 agent-loop”升级为可观测、可恢复、可验证的 Team runtime。

### Phase 1：入口收敛

- `/team <goal>` 在 chat API 直接调用 Team pipeline。
- `Team` 工具继续保留，但作为同一 pipeline 的工具入口。
- `/team` 不再只追加 prompt，避免模型先写 Todo 而不 spawn 子 agent。

### Phase 2：持久化 Runtime

- 新增 `.omc/state/team-jobs/{jobId}/state.json`。
- 新增 `.omc/state/team-jobs/{jobId}/events.jsonl`。
- 新增 `.omc/state/team-jobs/{jobId}/handoffs/*.md`。
- 所有 stage/task/worker/subagent 事件先写盘，再发 SSE。

### Phase 3：编排控制

- 使用固定 stage：`team-plan -> team-exec -> team-verify -> team-fix -> complete/failed`。
- 轻量任务走单 agent fast path；复杂任务走 DAG fallback。
- 每个 stage 写 handoff，下一 stage 只读取 handoff 和依赖报告。
- 验证阶段必须独立执行，失败后生成 bounded fix loop。

### Phase 4：测试

- 单元测试覆盖 runtime 文件、事件顺序、`/team` 入口确定性、子 agent 完成落盘。
- 统一运行 `npm run test`；如涉及 UI 行为，再运行 smoke/E2E。
