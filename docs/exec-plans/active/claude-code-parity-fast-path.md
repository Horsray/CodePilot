# Claude Code Parity Fast Path

> 创建时间：2026-04-28
> 最后更新：2026-04-29

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状梳理：确认 CLI 模式下的能力裁剪点 | ✅ 已完成 | 已定位 `settingSources=[]`、`--bare`、`FILEMAP` 未前置 |
| Phase 1 | 恢复 CLI Full Capabilities 默认路径 | ✅ 已完成 | Claude Code SDK 默认优先保留原生发现链路 |
| Phase 2 | 实现 `FILEMAP.md` 前置上下文策略 | ✅ 已完成 | 项目存在索引时优先注入索引文件 |
| Phase 3 | 设置页补齐控制项与说明 | ✅ 已完成 | 新增 Full Capabilities 开关，并将运行时主路径收敛为 Claude Code 优先 |
| Phase 4 | 自检与验证 | ✅ 已完成 | 诊断通过，`npm run test` 通过 |
| Phase 5 | 统一技能发现为轻量目录注入 | ✅ 已完成 | 技能改为目录摘要注入，执行仍走 `Skill` 工具按需展开 |
| Phase 6 | 恢复插件与 hooks 生命周期主链路 | ✅ 已完成 | 显式注入已启用插件，并开启 hook 生命周期事件可观测性 |
| Phase 7 | 修复新会话首条消息竞态 + 前移 warmup | 🔄 进行中 | 解决首条消息无反馈、首轮冷启动过慢 |
| Phase 8 | 建立通用规则发现/分类/注入机制 | 🔄 进行中 | 对齐 Trae 式多来源规则编排，面向多项目复用 |
| Phase 9 | 规则瘦身与可视化验收 | ✅ 已完成 | 已区分“已发现”和“本轮实际注入” |
| Phase 10 | 统一 MCP / Skills 注册表与迁移 | 🔄 进行中 | 前端展示、运行时加载、Claude 原生发现统一到单一真相源 |
| Phase 11 | 终端版行为回归：删除宿主额外编排 | 🔄 进行中 | 回退 system prompt 组装、宿主自动 MCP 注入、历史压缩与再编码 |

## 决策日志

- 2026-04-28：优先做最小高收益改造，不先大拆运行时。先修 CLI parity 和 `FILEMAP` 前置，两者对体感提升最大。
- 2026-04-28：长期学习层（知识库、技能、工作流发现）暂不删除，先避免它们继续抢占 Claude Code 原生执行链路。
- 2026-04-28：第二阶段继续收敛用户可见主路径，弃用“native 作为日常可选引擎”的产品表达，改为“Claude Code 主路径 + 自动 fallback”。
- 2026-04-28：项目规则匹配改为基于当前工作目录的规范化路径命中，兼容子目录与 worktree 场景。
- 2026-04-28：技能相关上下文统一为“先注入轻量目录，再通过 Skill 工具按需展开”，避免每轮注入整篇 `SKILL.md` 带来的 token 膨胀与注意力稀释。
- 2026-04-28：查明 hooks 之前被关掉的直接原因是早期 SDK/CLI 的 `hook_callback` 控制帧污染问题；本轮先恢复“已启用插件显式注入 + includeHookEvents 可观测性”，不直接重开应用侧控制 hooks，避免旧问题复燃。
- 2026-04-28：后续不再把“首轮性能/bug”和“规则系统”拆成两个独立任务。统一目标是“首轮一次等待可接受，后续快速响应，同时把规则系统改成多项目通用机制，而不是只优化当前仓库”。
- 2026-04-28：warmup 方案采用“新会话打开即预热 + 首条消息排队可视化 + 超时兜底直发”，优先解决第一条消息无反馈的问题。
- 2026-04-28：规则系统不做当前项目特判，改为通用规则发现器 + 分类器 + 注入编译器。兼容 DB 全局规则、DB 项目规则、`CLAUDE.md`、`CLAUDE.local.md`、`AGENTS.md`、`.trae/rules/rules.md`、`FILEMAP.md` 等来源。
- 2026-04-29：MCP 与 Skills 进入第三阶段收口，不再允许“前端显示一套、Claude SDK 读取一套、宿主动态注入一套”。统一为单一有效注册表，并把遗留 `.mcp.json` / `claude.json` 项目配置迁入 Claude 原生配置链。
- 2026-04-29：终端版对齐目标调整为“宿主最小化”。停止继续添加 CodePilot 自己的策略引导，优先回退桌面聊天里额外的 system prompt 拼装、宿主自动 MCP 注入、历史压缩与再编码，让 Claude Code 自己决定 skills / agent / 联网工具的使用。

## 详细设计

### 目标

- 在保留现有项目增强能力的前提下，让主路径尽量接近原生终端版 Claude Code 的能力与反馈速度。
- 优先修复“CLI 模式却像裁剪版 Claude Code”的问题。
- 让 `FILEMAP.md` 从软规则变成真正的前置索引策略。
- 解决“新会话首条消息无反馈、第二次才正常”的竞态问题。
- 把规则系统升级成面向多项目复用的通用机制，而不是只对当前仓库特判。

### 范围

- `src/lib/provider-resolver.ts`
- `src/app/api/settings/app/route.ts`
- `src/components/settings/CliSettingsSection.tsx`
- `src/app/chat/page.tsx`
- `src/app/chat/[id]/page.tsx`
- `src/components/chat/ChatView.tsx`
- `src/app/api/chat/warmup/route.ts`
- `src/lib/context-assembler.ts`
- `src/lib/agent-system-prompt.ts`
- `src/lib/pending-session-message.ts`
- `src/components/settings/RulesSection.tsx`
- `src/i18n/en.ts`
- `src/i18n/zh.ts`

### 实施步骤

1. 将 Claude Code SDK 的 Full Capabilities 改为 CLI 主路径默认开启，保留显式关闭入口。
2. 在设置页增加可见开关与说明，避免用户误以为 CLI 模式天然等于原生完整能力。
3. 在系统提示装配阶段引入 `FILEMAP.md` 前置策略：
   - 若项目根存在 `FILEMAP.md`
   - 且用户请求属于代码定位 / 改动 / 检索类任务
   - 则把 `FILEMAP.md` 作为高优先级项目索引注入上下文与 referenced contexts
4. 跑诊断并检查关键文件无明显回归。

### 第二阶段：首轮性能与规则系统一体化改造

1. 修复新会话首条消息 handoff 竞态：
   - 首条消息在新会话页进入“已排队待发送”状态
   - `ChatView` 不再依赖脆弱的 250ms effect 重跑
   - warmup 完成、超时或失败后自动发送，不需要用户第二次点击
2. 前移 warmup 触发时机：
   - 新会话创建成功后立即启动 warmup
   - 会话页挂载后继续复用/接力 warmup，而不是重新冷启动
   - 首轮 UI 显示明确状态文案，例如“正在准备 Claude Code 环境”
3. 建立通用规则发现器：
   - 统一发现 DB 全局规则、DB 项目规则、`CLAUDE.md`、`CLAUDE.local.md`、`AGENTS.md`、`.trae/rules/rules.md`、`FILEMAP.md`
   - 修复 `.trae/rules/rules.md` 仅按 `cwd` 固定路径发现的问题，兼容项目根、子目录、worktree
4. 建立规则分类与注入编译器：
   - `hard_rule`：始终保留全文
   - `soft_rule`：摘要化
   - `repo_instruction`：按块注入
   - `index_doc`：仅在定位/检索/改动类任务优先注入
5. 补充调试可视化与验收：
   - 明确显示“发现了哪些规则”
   - 明确显示“本轮实际注入了哪些规则/索引/技能目录”
   - 对比首轮 connected 时间、首字时间、后续连续发送时间

### 第三阶段：MCP / Skills 统一入口与迁移闭环

1. 建立统一 MCP 有效注册表：
   - 外部 MCP 统一读取 Claude 原生配置链
   - CodePilot 内置 MCP 单独标记为 `builtin`
   - 当前会话按需动态挂载的 MCP 标记为 `session-on-demand`
2. 建立项目级 MCP 迁移链：
   - 识别项目 `.mcp.json` 与项目 `claude.json`
   - 非破坏性迁移到 `~/.claude.json` 的 `projects[{cwd}].mcpServers`
   - UI 与运行时优先读取迁移后的 Claude 原生配置
3. 统一 Skills 有效注册表：
   - `Skills` 管理页、`/` 弹窗、`Skill` 工具共享同一份扫描结果
   - 去掉前后端各自独立扫描造成的能力偏差
4. 回补自动调用闭环：
   - Claude Code 主路径下，迁移后的外部 MCP 与技能目录能够进入原生自动发现链
   - FAST 路径仍通过统一注册表补齐显式注入，避免“存了但本轮不可用”

### 验收标准

- CLI 模式默认不再因为三方 provider 而退回 `settingSources=[]` 的裁剪路径。
- 设置页可见 Full Capabilities 开关，默认行为清晰。
- 涉及代码定位/检索的请求中，若项目存在 `FILEMAP.md`，会优先进入上下文。
- 最近修改文件无新增诊断错误。
- 新会话首条消息不再需要“发第二次”才启动。
- 首轮等待期间有明确可见状态，不再表现为“没有任何反馈”。
- 规则系统支持多项目通用发现与分类，不依赖当前仓库特判。
- 上下文显示能区分“已发现”和“本轮实际注入”，避免用户误判。
- MCP 页面展示的有效项与当前运行时加载链一致，不再出现“前端看到的配置”和“AI 当前真实可用能力”不一致。
- Skills 管理页、Slash 弹窗与 `Skill` 工具使用同一份注册表，避免存量技能只显示不生效。
