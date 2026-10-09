# 上游中断与 CLI 压缩可观测性

> 创建时间：2026-10-08  
> 最后更新：2026-10-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 证据定位与回归用例 | ✅ 已完成 | 已确认 `ECONNRESET` 与无 result 的正常 EOF 会误标完成 |
| Phase 1 | SDK 终态协议修复 | ✅ 已完成 | 无 `result` 的迭代结束会显式中断 |
| Phase 2 | CLI 压缩生命周期透传 | ✅ 已完成 | 捕获 PreCompact/PostCompact 与 compact_boundary |
| Phase 3 | 客户端状态持久化与 UI | ✅ 已完成 | 展示中断原因及压缩来源；会话不被标完成 |
| Phase 4 | 自动化与 UI 验证 | ✅ 已完成 | 单测、typecheck、开发环境 CDP 验证通过 |

## 决策日志

- 2026-10-08：将“用户会话连续性”与 SDK 内部 session 轮换分开。CodePilot 自己的摘要交接可更换底层 SDK session，但不能结束、拆分或静默完成用户会话。
- 2026-10-08：CLI 没有可用百分比时只展示“正在整理上下文”，不伪造进度；SDK hook 与 compact boundary 事件分别覆盖开始、完成及兜底。
- 2026-10-08：SDK 流在没有 `result` 的情况下结束，统一定义为 `upstream_interrupted`，不能再发送成功 `done`。

## 验收标准

1. 上游 `api_error` / `api_retry` 变成可见“模型上游中断，正在重试”状态。
2. CLI 自动压缩的开始与完成都进入同一条会话时间线，并标注来源为 CLI。
3. 无 SDK `result` 的 EOF 会保存“模型上游中断”并以中断状态结束，绝不标记任务完成。
4. 现有 CodePilot 压缩事件继续可见；内部 SDK session 轮换不影响用户会话连续性。
