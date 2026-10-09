# Commercial Agent Upgrade

> 创建时间：2026-04-17
> 最后更新：2026-04-17

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 高优先级修复：大模型死循环阻断、文件树虚拟滚动重构、异常反馈闭环补全（全局 Toast 和 Skeleton）、交互式提问（AskUserQuestion）修复 | ✅ 已完成 | 提升系统健壮性和大规模文件渲染性能 |
| Phase 2 | 中优先级优化：底层 bash 工具 Stdout 流式输出（打字机效果）、文件系统监听（File Watcher）、AppShell 状态解耦（Zustand） | ✅ 已完成 | 提升开发者体验和响应速度 |
| Phase 3 | UI重构与体验升级：废弃臃肿的 AgentTimeline，全面换用类似 Trae Solo 风格的极简 ToolActionsGroup | ✅ 已完成 | 让工具调用不再占用过多屏幕空间，更具现代感 |

## 决策日志

- 2026-04-17: 启动 Commercial Agent Upgrade 计划。评估发现虽然流式渲染表现优异，但缺乏 Doom Loop 阻断机制导致了极端场景下的 Token 浪费风险。同时文件树缺乏虚拟滚动支持，在大型单体仓库下有性能隐患。分三阶段逐步实现对齐顶尖商业产品的能力。
- 2026-04-17: Phase 1 完成。`agent-loop.ts` 中已实现针对相同失败工具调用的 3 次容忍阈值阻断。`FileTree` 和 `EnhancedFileTree` 组件均已使用 `react-virtuoso` 实现扁平化虚拟滚动渲染，彻底解决超大型项目下的渲染性能问题。`ChatListPanel` 补充了全局 Toast 异常反馈闭环。修复了 `AskUserQuestion` 在 Next.js 多进程架构下的 Promise 假死问题。
- 2026-04-17: Phase 2 完成。重写了 `bash.ts` 中的执行逻辑，结合 `stream-session-manager.ts` 和 `useSSEStream` 将命令行的标准输出/错误流式转发至前端，实现了打字机效果。新增 `chokidar` 支持，在 `/api/workspace/events` 中暴露 SSE 事件并在前端订阅以实现文件修改时自动刷新。AppShell 中臃肿的状态已通过 `zustand` 抽离至 `panelStore.ts`。
- 2026-04-17: Phase 3 完成。移除笨重且样式杂乱的 `AgentTimeline`，全面采用 Trae Solo 风格的 `ToolActionsGroup`。

## 详细设计

### 目标
提升 CodePilot 桌面端的商业级体验，补齐容错机制、性能短板及终端交互体验，使之对标 Cursor / Cline 等成熟产品。

### 拆分步骤

**Phase 1: 高优先级**
1. **Doom Loop 阻断**：修改 `src/lib/agent-loop.ts`，完善连续调用相同失败工具的检测逻辑，阈值到达时抛出特定异常，打断模型推理并提示用户接管。
2. **文件树重构**：修改 `src/components/ai-elements/file-tree.tsx` 及相关使用方，引入 `react-virtuoso` 进行虚拟树渲染，支持十万级目录顺畅展开。
3. **完善异常 UI 反馈**：检查并修复静默失败的 Catch 块，添加 Skeleton 骨架屏组件，集成到会话加载和耗时操作中。
4. **修复 AskUserQuestion 假死**：引入 SQLite 数据库轮询，解决跨 Next.js Worker 通信导致的 Promise 挂起问题。

**Phase 2: 中优先级**
1. **终端流式输出**：改造 `bash.ts` 等执行工具，通过子进程的 `stdout.on('data')` 实时向 `agent-loop.ts` 抛出数据，在前端实现打字机效果回显。
2. **File Watcher 集成**：在 Node 层引入 `chokidar` 监听工作区，并通过 WebSocket/SSE 将文件和 Git 状态变化实时推送到前端组件。
3. **AppShell 状态管理**：引入 `zustand` 将 `AppShell.tsx` 中臃肿的 UI 状态提取出来。

**Phase 3: UI 升级**
1. **Trae Solo 风格重构**：移除旧版的 `AgentTimeline`，将流式和历史消息统一渲染为紧凑、可展开的极简 `ToolActionsGroup` 列表。

### 依赖项
- 新增 `react-virtuoso` 依赖用于文件树重构。
- 新增 `zustand` 依赖用于状态解耦。
- 新增 `chokidar` 用于文件监听。

### 验收标准
- 故意构造错误提示词，Agent 在连续调用 3 次错误工具后能够被自动阻断并通知用户。
- 打开 React 或 Next.js 源码级的大型仓库并全量展开 node_modules，页面不卡顿。
- Bash 工具执行耗时命令（如 `npm install`）时，前端能实时看到输出过程而非等待结束后一次性显示。
- AskUserQuestion 的交互选择能够正确被后台接收并让 Agent 继续执行。
- 工具调用界面呈现单行极简风格，不再是巨大的带边框卡片。