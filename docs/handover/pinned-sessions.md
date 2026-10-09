# 收藏会话（图钉）— 技术交接

> 产品思考见 [docs/insights/pinned-sessions.md](../insights/pinned-sessions.md)

## 这个功能是什么

左侧会话列表里，每个会话行右侧有一个**图钉按钮**。点击后：

- 该会话从原项目分组**隐藏**，固定到列表顶部的「**收藏会话**」模块中（模块位于工作区分组「绘影智能体」正下方）；
- 收藏模块中的行**完整继承**任务运行态（转圈）、完成未读（蓝点）、待批准（铃铛）指示；
- 再次点击图钉（取消收藏）即还原回原项目分组。

没有收藏时不渲染该模块——行右侧的图钉按钮就是唯一入口。

## 涉及文件

| 文件 | 角色 |
|------|------|
| `src/lib/db.ts` | **数据层**。`pinned_at` 列迁移（`safeAddColumn`）+ `updateSessionPinned(id, pinned, now?)` |
| `src/types/index.ts` | `ChatSession.pinned_at?: string`（空/未定义 = 未收藏） |
| `src/app/api/chat/sessions/[id]/route.ts` | PATCH 支持 `body.pinned: boolean` |
| `src/components/layout/SessionListItem.tsx` | **图钉按钮**（行右侧，三点菜单左侧）+ 时间戳让位逻辑 |
| `src/components/layout/PinnedSessionsSection.tsx` | **新建**。收藏模块分组头 + 折叠动画（`children` 由调用方注入） |
| `src/components/layout/ChatListPanel.tsx` | 过滤（收藏从原分组隐藏）、`handleTogglePin`（乐观更新）、`renderSessionItem` 共用渲染、模块位置编排 |
| `src/components/layout/chat-list-utils.ts` | `loadPinnedCollapsed()` / `savePinnedCollapsed()`（localStorage `codepilot:pinned-collapsed`） |
| `src/i18n/{en,zh}.ts` | `chatList.pinnedSessions` / `chatList.pinSession` / `chatList.unpinSession` / `error.pinSessionFailed` |
| `src/__tests__/unit/session-pin.test.ts` | **新建**。数据层单测（默认未收藏 / 收藏-取消 / 时间戳格式 / 列表可见性） |

## 数据模型

`chat_sessions` 增加一列（迁移在 `migrateDb` 内，与 `last_opened_at` 相邻）：

```sql
ALTER TABLE chat_sessions ADD COLUMN pinned_at TEXT NOT NULL DEFAULT ''
```

- **空字符串 = 未收藏**，非空 = 收藏时间（`'YYYY-MM-DD HH:MM:SS'`，与 `last_opened_at` 等字段同一格式约定）。
- 用**时间戳而不是布尔值**：收藏模块按 `pinned_at` 倒序排列（最近收藏在前），且字符串序即时间序。

## 数据流

```
点击图钉（SessionListItem）
  → handleTogglePin（ChatListPanel）
      → 乐观更新 setSessions（立即切换 pinned_at，UI 无延迟）
      → PATCH /api/chat/sessions/{id} { pinned: true|false }
          → updateSessionPinned()（服务端生成权威时间戳）
      → 成功：用响应中的 session 覆盖校准
      → 失败：回滚 pinned_at 并 toast
```

**过滤（客户端，不在服务端）**：

- `filteredSessions` = `sessions.filter(s => !s.pinned_at)` → 喂给 `groupSessionsByProject`，这就是"从原项目列表隐藏"；
- `pinnedSessions` = `sessions.filter(s => !!s.pinned_at)`，按 `pinned_at` 倒序；
- 之所以不在 API 层过滤：`getAllSessions()` 还有其他消费方（Bridge、全局搜索等），收藏只影响侧栏的呈现，不改数据可见性。

### 模块位置编排

「绘影智能体」= 助手工作区分组（由 `workspacePath` 标识，`ProjectGroupHeader` 的 `isWorkspace` 分支），它被 `projectGroups` 逻辑固定在第一位。收藏模块的插入规则（ChatListPanel 渲染段）：

| 情况 | 收藏模块位置 |
|------|------------|
| 工作区分组存在 | 紧跟在它之后（Fragment 内 `groupIsWorkspace` 判断） |
| 工作区分组不存在 | 列表最前（`groupIndex === 0 && !groupIsWorkspace`） |
| 没有任何项目分组（全部会话都被收藏） | 单独占据列表首部（`projectGroups.length === 0 && pinnedSection`） |

**空工作区兜底**：当工作区的会话**全部被收藏**时，`filteredSessions` 里不再有该目录的会话，分组本会消失。为避免助手入口（记忆数 / 心跳信息）被收藏功能"吃掉"，`projectGroups` 会在"该 workspace 有过会话但现在被过滤空"时注入一个 `sessions: []` 的空分组头（仅保留标题行）。

### 状态继承

项目分组与收藏模块共用 **同一个 `renderSessionItem(session, isWorkspaceGroup)` 函数**（ChatListPanel 内）。运行态（`isSessionRunning`）、完成未读（`unreadCompletions`）、待批准（`pendingApprovalSessionIds`）都来自同一份 props，因此收藏不会改变任何状态指示 —— 这正是"继承任务运行状态和完成态"的实现方式，不需要额外的同步逻辑。

## 图钉按钮的显示规则（行右侧）

按钮位置是 absolute 定位：**图钉 `right-[26px]`**、三点菜单 `right-1`（三点从原 `right-2` 左移 4px 给图钉腾位，视觉几乎无差）。

| 状态 | 图钉 | 时间戳 | 转圈（运行中） |
|------|------|--------|--------------|
| 未收藏、未 hover | 隐藏 | 显示 | — |
| 未收藏、hover | 显示（常规色） | 隐藏（让位给按钮） | 隐藏（原逻辑） |
| 已收藏、非运行 | **常驻**（`text-primary` 填充） | 隐藏 | — |
| 已收藏、运行中 | 隐藏（让位） | — | **显示**（运行态优先） |

关键约束：常驻元素不能压住标题（标题右边界在行右 46px 处）和运行中转圈（占行右 32–46px）。因此"已收藏 + 运行中"时图钉让位给转圈，hover 时图钉照常出现可操作。

## 边界情况

- **删除收藏的会话**：`handleDeleteSession` 更新 `sessions` 后，两个列表自然同步（收藏模块随 `pinnedSessions` 变空而消失）。
- **分屏（split）**：收藏模块与项目列表一样排除 `splitSessionIds`（split 组优先显示，避免同一会话渲染两处）。
- **批量操作**：全选/批量删除基于 `filteredSessions`（不含收藏会话）—— 与"收藏已从原列表移出"的语义一致。
- **折叠状态**：收藏模块的折叠偏好独立持久化（localStorage `codepilot:pinned-collapsed`），默认展开。

## 验证记录（2026-10-09）

- `npx tsc --noEmit` 通过；`session-pin.test.ts` 4/4 通过。
- CDP 实测（dev server + chrome-devtools MCP）：
  - 收藏 → 会话从「本地安装程序」分组消失、收藏模块出现在「绘影科技智能体」下方、PATCH 返回 200、DB `pinned_at` 写入正确格式；
  - 取消收藏 → 模块消失、会话回到原分组、DB 还原为空串；
  - 折叠/展开 → 行隐藏/显示正确，localStorage 持久化生效；
  - 状态继承 → 将**运行中**会话收藏后，收藏模块内的行同样显示转圈。
