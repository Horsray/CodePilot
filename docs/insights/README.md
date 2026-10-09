# 产品思考文档

记录功能设计背后的"为什么"——用户问题、设计理由、外部趋势、已知局限和未来方向。

每份文档对应一个 `docs/handover/` 中的技术交接文档，文件名保持一致，互相反向链接。

## 索引

| 文档 | 对应交接文档 | 主题 |
|------|------------|------|
| [cli-tools.md](./cli-tools.md) | [handover/cli-tools.md](../handover/cli-tools.md) | CLI 工具管理的 MCP 化、Agent-first CLI 趋势、凭证管理痛点 |
| [dashboard-generative-ui.md](./dashboard-generative-ui.md) | [handover/dashboard.md](../handover/dashboard.md) | 生成式 UI 持久化、AI-first 项目看板、系统级渲染层构想、实现后复盘 |
| [buddy-gamification.md](./buddy-gamification.md) | [handover/buddy-gamification.md](../handover/buddy-gamification.md) | Buddy 宠物伙伴设计：从工具到伙伴的用户旅程、稀有度/进化/心跳、视觉体系、审查修复决策 |
| [context-management.md](./context-management.md) | [handover/context-management.md](../handover/context-management.md) | 上下文管理：长对话失忆/PTL 问题、分级压缩策略、Claude Code 参考与取舍、Codex 审计驱动的优先级 |
| [cli-upgrade-proxy.md](./cli-upgrade-proxy.md) | [handover/cli-upgrade-proxy.md](../handover/cli-upgrade-proxy.md) | CLI 升级 + 代理透传：P0 版本问题、分渠道升级策略、系统代理无感透传、Git 依赖引导 |
| [tool-call-ux.md](./tool-call-ux.md) | [handover/tool-call-ux.md](../handover/tool-call-ux.md) | 工具调用 UX：thinking 展示设计决策、注册表 vs if/else、归组阈值、缓冲旁路、竞品对比 |
| [delivery-collapse.md](./delivery-collapse.md) | [handover/delivery-collapse.md](../handover/delivery-collapse.md) | 交付折叠：过程 vs 结论的叙事结构、触发时机两次返工的教训（复用变量前先确认语义）、手动记忆为何是单轮级 |
| [performance-memory.md](./performance-memory.md) | [handover/performance-memory.md](../handover/performance-memory.md) | 内存优化：LRU vs 定期清理、300 条上限 + reconciliation、定时器泄漏、大文件流式读取 |
| [user-audience-analysis.md](./user-audience-analysis.md) | [handover/provider-architecture.md](../handover/provider-architecture.md) | 用户受众分析：画像、需求优先级、竞品格局、品牌定位路线取舍（2026-04-04 数据快照） |
| [decouple-native-runtime.md](./decouple-native-runtime.md) | [handover/decouple-native-runtime.md](../handover/decouple-native-runtime.md) | 脱离 Claude Code：用户痛点（安装门槛/单一锁定）、双 Runtime 设计理由、OpenAI 集成、参考项目对比 |
| [fork-sync-mechanism.md](./fork-sync-mechanism.md) | [handover/fork-sync-mechanism.md](../handover/fork-sync-mechanism.md) | Fork 长期追官方的产品策略：为什么不能继续手工同步、为什么要 ownership map/patch manifest/bootstrap |
| [sdk-injected-turn-suppression.md](./sdk-injected-turn-suppression.md) | [handover/sdk-injected-turn-suppression.md](../handover/sdk-injected-turn-suppression.md) | 助手"答非所问"：为什么不是丢上下文、SDK 后台任务注入轮次的机制与自循环、拦在源头而非各消费者的取舍、MCP 指标为何不该默认报"大部分坏了" |
| [background-task-hold.md](./background-task-hold.md) | [handover/background-task-hold.md](../handover/background-task-hold.md) | 后台任务等待收尾：过早标记完成的三重伤害、为何与后台子 Agent 语义对齐而非发明第三种、15 分钟上限与"收尾 ≠ 取消"、排空模式的账要算干净 |
| [bridge-final-response.md](./bridge-final-response.md) | [handover/bridge-final-response.md](../handover/bridge-final-response.md) | 手机端要的是结论不是过程：IM 是"完成态"媒介而桌面是"进行态"媒介、为什么选只发结论而非发进展、模型"说了没做"与消息发早了为何是两件事、静默期偏长的代价与未来方向 |
| [interactive-permission-ux.md](./interactive-permission-ux.md) | [handover/interactive-permission-ux.md](../handover/interactive-permission-ux.md) | 等人工不该等于卡死：超时兜底的善意与错配、桌面端是"进行态"媒介故状态须跨窗口恢复、为何按请求性质分流而非调阈值 |
| [pinned-sessions.md](./pinned-sessions.md) | [handover/pinned-sessions.md](../handover/pinned-sessions.md) | 收藏会话（图钉）：置顶粒度从目录下沉到单个会话、图钉入口 vs 右键菜单、"固定"而非"快捷方式"的语义取舍、位置为何在绘影智能体下方、状态须完整继承 |
