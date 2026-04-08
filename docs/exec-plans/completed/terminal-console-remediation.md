# Terminal / Console 修复与联动优化

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 复现问题 + 根因确认 | ✅ 已完成 | 已确认 PTY 后端、SSE 首包丢失、React 重建抖动、dev 路由上下文隔离 |
| Phase 1 | 终端稳定性修复 | ✅ 已完成 | 恢复真实 PTY，修正 xterm 生命周期与首屏输出 |
| Phase 2 | Console 可用性修复 | ✅ 已完成 | 增加 runtime/browser 日志通路与清空接口 |
| Phase 3 | Trae 风格交互优化 | ✅ 已完成 | 底部面板保活、低打断切换、工作区绑定重建 |

## 决策日志

- 2026-04-08: 当前 `spawn + script` 替代 `node-pty` 的改动与前端重复初始化同时存在，优先恢复真实 PTY 并稳定会话生命周期，而不是继续在假 PTY 上加补丁。
- 2026-04-08: 终端和 Console 共用底部面板，因此会按“底层会话稳定 + 日志统一汇聚”的方式一起修，而不是拆成两个孤立问题。
- 2026-04-08: Next.js dev 环境下不同 route chunk 不能依赖模块级 Map 共享终端状态，因此终端 session 和输出缓冲统一提升到 `globalThis`。
- 2026-04-08: 参考 Trae “all your context and tools, in one place / real-time feedback loop”的思路，终端和 Console 改成底部保活面板，切 tab 不重建终端会话。

## 详细设计

### 目标

- 修复内置终端黑屏、闪烁、无法输入或反复断开的回归。
- 修复 Console 面板无有效日志、无法作为调试观察面的回归。
- 借鉴 Trae 的产品方式，让终端成为稳定、持续、和工作区状态联动的能力，而不是一次性组件。

### 已确认根因

- `src/lib/pty-manager.ts` 从 `node-pty` 改成 `spawn + script`，改变了真实 PTY 行为和 resize/exit 语义。
- `src/components/layout/panels/WebTerminalPanel.tsx` 依赖整个 terminal controller 对象，状态变化会让 `XtermTerminal` 反复销毁重建，直接导致黑屏和闪烁。
- `src/components/console/ConsolePanel.tsx` 只监听前端自定义事件，没有消费服务端 runtime log，导致“控制台”基本失去观察价值。

### 方案

- 终端后端恢复 `node-pty`，保留现有 REST + SSE 契约，减少前端接口改动。
- 前端终端面板改成稳定 controller 引用和显式会话状态机，避免因为 React re-render 重建 xterm。
- Console 增加统一日志源：runtime log、browser console、自定义 build 输出。
- 终端交互优化参考 Trae 的方向：
  - 会话尽量长生命周期，不因为轻微 UI 状态变化重建
  - 工作区切换时明确同步 cwd 和状态
  - 终端与 Console 分工清晰但共享底部观察面
  - 错误提示和重试路径内建，不让用户面对纯黑屏

### 验收标准

- 打开底部终端后，xterm 不闪烁、不反复重建，可正常输入并收到 shell 输出。
- 终端在 resize、切换 tab、切回终端时不会自动丢失会话。
- Console 面板可以看到服务端运行日志，并继续展示浏览器/构建事件。
- `npm run test` 通过；UI 变更经本地启动和浏览器实际验证。
