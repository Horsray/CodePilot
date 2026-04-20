# Hermes-Inspired Unified Memory & Learning System

> 创建时间：2026-04-21
> 状态：Active
> 目标：清理当前混乱的记忆/技能/图谱系统，吸收 Hermes Agent 的闭环学习（Closed Learning Loop）能力。

## 1. 现状诊断 (The Chaos)

当前系统存在 4 套平行的认知机制，互相重叠且没有闭环：

1. **Markdown 记忆 (Obsidian 风格)**：`memory.md`, `daily/*.md`, `soul.md`。用于记录事实和偏好。
2. **MCP Memory (动态图谱)**：基于 SQLite，存储 Entity 和 Observation。
3. **Graphify (静态图谱)**：AST 扫描代码结构，强制同步到 MCP Memory，导致严重的数据冗余和不同步。
4. **Skills 系统**：既有物理的 `SKILL.md` 工具，又有纯 Prompt 角色扮演的 `Oh-My-Claudecode` (OMC)。

**为什么感觉“断档”和“不聪明”？**
- **只记结果，不记过程**：Markdown 记忆只写了“我修了 bug”，没存“我是怎么修的”（缺乏 Trajectory Recall）。
- **技能是死数据**：目前的技能靠人手写，AI 踩坑解决问题后，不会自动把经验封装成新技能（缺乏 Auto-Skill Crystallization）。
- **图谱和记忆割裂**：查图谱查不到业务决策，查 Markdown 查不到代码关联。

## 2. 架构重构方案 (The Hermes Way)

我们将把这 4 套系统整合成一个**统一的“闭环学习运行时”**：

### Phase 1: 认知收敛 (Consolidation)
- **剥离静态与动态**：Graphify 纯粹作为代码检索工具（只读），**停止**将其强行同步进 MCP Memory。
- **统一 Memory MCP**：MCP Memory 只负责存储“动态业务逻辑、架构决策、用户偏好”。
- **废弃 OMC 角色扮演**：清理掉纯文本的 OMC 冗余提示词，技能必须是可执行的物理实体。

### Phase 2: 自动技能结晶 (Auto-Skill Crystallization)
- **机制**：当 AI 成功完成一个复杂任务（特别是经过多次 Bash 报错重试后成功的），系统在任务结束前，强制 AI 总结这次的“成功执行轨迹 (Trajectory)”。
- **落盘**：AI 自动调用 `codepilot_skill_create`，把经验写成一个 `.claude/skills/` 下的物理技能文件。下次再遇到，直接调用该技能。

### Phase 3: 记忆夜间反刍 (Nightly Compaction)
- **机制**：利用现有的定时任务（Cron），每天晚上触发一个后台 Agent。
- **动作**：它会把今天的 `daily/*.md` 读一遍，提取出高价值的 Entity 写入 MCP Memory，并把核心偏好更新到 `user.md`，然后清空冗余的 daily 琐碎日志。

## 3. 执行步骤

- [ ] **Step 1**: 编写并确认本执行计划。
- [ ] **Step 2**: 清理 `knowledge-graph-provider.ts`，切断静态代码向 MCP Memory 的无效同步。
- [ ] **Step 3**: 在 `TodoWrite` 或 Agent Loop 结束判定处，注入“技能结晶”提示词和 `codepilot_skill_create` 工具。
- [ ] **Step 4**: 创建 `compaction-agent` 定时任务逻辑，实现记忆的反刍。

