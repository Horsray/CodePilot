# CodePilot Codebase Index

> **用途**：AI 执行任务时的快速查找表。先查此文件定位目标，避免全项目搜索。
> **维护**：每次新增/删除页面、组件、API 路由、lib 文件后更新此索引。
> **最后更新**：2026-04-28

---

## 目录

1. [按功能查找](#1-按功能查找) — "我要改 XX 功能，该去哪个文件？"
2. [页面 → 组件映射](#2-页面--组件映射) — 页面用了哪些组件
3. [UI 组件 → 文件映射](#3-ui-组件--文件映射) — 界面元素对应的组件文件
4. [API 路由速查](#4-api-路由速查) — 后端接口一览
5. [核心 lib 文件](#5-核心-lib-文件) — 业务逻辑入口
6. [Hooks 速查](#6-hooks-速查) — React 状态管理
7. [Electron 主进程](#7-electron-主进程)
8. [依赖热路径](#8-依赖热路径) — 改动影响最大的文件

---

## 1. 按功能查找

### 聊天功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| 聊天主界面 | `src/app/chat/page.tsx` | `src/app/api/chat/route.ts` (POST) | `src/lib/claude-client.ts` |
| 聊天会话视图 | `src/app/chat/[id]/page.tsx` | — | `src/lib/stream-session-manager.ts` |
| 首轮消息挂起与转交 | `src/app/chat/page.tsx` → `src/app/chat/[id]/page.tsx` | `src/app/api/chat/warmup/route.ts` | `src/lib/pending-session-message.ts` |
| 消息列表 | `src/components/chat/MessageList.tsx` | `src/app/api/chat/sessions/[id]/messages/route.ts` | `src/lib/db.ts` getMessages |
| 消息输入框 | `src/components/chat/MessageInput.tsx` | — | `src/lib/message-input-logic.ts` |
| 流式消息渲染 | `src/components/chat/StreamingMessage.tsx` | — | `src/lib/agent-timeline.ts` |
| 消息气泡 | `src/components/chat/MessageItem.tsx` | — | `src/components/ai-elements/message.tsx` |
| 权限提示 | `src/components/chat/PermissionPrompt.tsx` | `src/app/api/chat/permission/route.ts` | — |
| 模式切换 | `src/components/chat/ModeIndicator.tsx` | `src/app/api/chat/mode/route.ts` | — |
| 模型选择 | `src/components/chat/ModelSelectorDropdown.tsx` | `src/app/api/chat/model/route.ts` | `src/lib/resolve-session-model.ts` |
| 会话列表(侧栏) | `src/components/layout/ChatListPanel.tsx` | `src/app/api/chat/sessions/route.ts` | `src/lib/db.ts` getAllSessions |
| 回退/重播 | — | `src/app/api/chat/rewind/route.ts` | `src/lib/file-checkpoint.ts` |
| 代码审查 | — | `src/app/api/chat/review/route.ts` | `src/lib/diff-utils.ts` |
| 后台任务 | — | `src/app/api/chat/background/route.ts` | `src/lib/background-job-manager.ts` |
| Prompt 优化 | — | `src/app/api/chat/optimize-prompt/route.ts` | `src/lib/text-generator.ts` |

### 设置功能

| 功能 | 前端文件 | 后端 API |
|------|---------|----------|
| 设置主页 | `src/app/settings/page.tsx` → `src/components/settings/SettingsLayout.tsx` | — |
| 通用设置 | `src/components/settings/GeneralSection.tsx` | `src/app/api/settings/app/route.ts` |
| 外观/主题 | `src/components/settings/AppearanceSection.tsx` | — |
| 服务商管理 | `src/components/settings/ProviderManager.tsx` | `src/app/api/providers/route.ts` |
| 服务商表单 | `src/components/settings/ProviderForm.tsx` | `src/app/api/providers/[id]/route.ts` |
| 服务商选项 | `src/components/settings/ProviderOptionsSection.tsx` | `src/app/api/providers/options/route.ts` |
| 服务商诊断 | `src/components/settings/ProviderDoctorDialog.tsx` | `src/app/api/doctor/route.ts` |
| CLI 设置 | `src/components/settings/CliSettingsSection.tsx` | `src/app/api/claude-status/route.ts` |
| 用量统计 | `src/components/settings/UsageStatsSection.tsx` | `src/app/api/usage/stats/route.ts` |
| 助手工作区 | `src/components/settings/AssistantWorkspaceSection.tsx` | `src/app/api/settings/workspace/route.ts` |
| 自定义规则 | `src/components/settings/RulesSection.tsx` | `src/app/api/settings/custom-rules/route.ts` |
| Widget 配置 | `src/components/settings/WidgetsSection.tsx` | `src/app/api/dashboard/route.ts` |
| Telegram 配置 | — | `src/app/api/settings/telegram/route.ts` |
| 飞书配置 | — | `src/app/api/settings/feishu/route.ts` |
| Discord 配置 | — | `src/app/api/settings/discord/route.ts` |
| QQ 配置 | — | `src/app/api/settings/qq/route.ts` |
| 微信配置 | — | `src/app/api/settings/weixin/route.ts` |

### Git 功能

| 功能 | 前端文件 | 后端 API |
|------|---------|----------|
| Git 面板入口 | `src/components/layout/panels/GitPanel.tsx` → `src/components/git/GitPanel.tsx` | — |
| 工作区状态 | `src/components/git/GitStatusSection.tsx` | `src/app/api/git/status/route.ts` |
| 提交历史 | `src/components/git/GitHistorySection.tsx` | `src/app/api/git/log/route.ts` |
| 提交详情 | `src/components/git/GitCommitDetailDialog.tsx` | `src/app/api/git/commit-detail/[sha]/route.ts` |
| Diff 查看 | `src/components/git/GitDiffViewer.tsx` | `src/app/api/git/diff/route.ts` |
| Stash 管理 | `src/components/git/GitStashSection.tsx` | `src/app/api/git/stash/route.ts` |
| Worktree 管理 | `src/components/git/GitWorktreeSection.tsx` | `src/app/api/git/worktrees/route.ts` |
| 分支切换 | `src/components/git/GitBranchSelector.tsx` | `src/app/api/git/checkout/route.ts` |
| Push 对话框 | `src/components/git/PushDialog.tsx` | `src/app/api/git/push/route.ts` |
| AI 审查 | — | `src/app/api/git/ai-review/route.ts` |
| Git 服务层 | — | — | `src/lib/git/service.ts` |

### MCP / 插件功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| MCP 管理页 | `src/app/mcp/page.tsx` | `src/app/api/plugins/mcp/route.ts` | `src/lib/mcp-connection-manager.ts` |
| MCP 加载 | — | — | `src/lib/mcp-loader.ts` |
| MCP 工具适配 | — | — | `src/lib/mcp-tool-adapter.ts` |

### Skills 功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| Skills 管理页 | `src/app/skills/page.tsx` | `src/app/api/skills/route.ts` | `src/lib/skill-discovery.ts` |
| Skill 解析 | — | — | `src/lib/skill-parser.ts` |
| Skill 执行 | — | — | `src/lib/skill-executor.ts` |

### 媒体 / 图片生成功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| 媒体画廊 | `src/app/gallery/page.tsx` | `src/app/api/media/gallery/route.ts` | — |
| 图片生成 | `src/components/chat/ImageGenCard.tsx` | `src/app/api/media/generate/route.ts` | `src/lib/image-generator.ts` |
| 批量生成 | `src/components/chat/batch-image-gen/` | `src/app/api/media/jobs/route.ts` | `src/lib/job-executor.ts` |
| 图片参考存储 | — | — | `src/lib/image-ref-store.ts` |
| 媒体保存 | — | — | `src/lib/media-saver.ts` |

### Bridge (远程渠道) 功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| Bridge 管理页 | `src/app/bridge/page.tsx` | `src/app/api/bridge/route.ts` | `src/lib/bridge/bridge-manager.ts` |
| 渠道路由 | — | `src/app/api/bridge/chat/route.ts` | `src/lib/bridge/channel-router.ts` |
| 会话引擎 | — | — | `src/lib/bridge/conversation-engine.ts` |
| Telegram 适配 | — | — | `src/lib/bridge/adapters/telegram-adapter.ts` |
| 飞书适配 | — | — | `src/lib/bridge/adapters/feishu-adapter.ts` |
| Discord 适配 | — | — | `src/lib/bridge/adapters/discord-adapter.ts` |
| QQ 适配 | — | — | `src/lib/bridge/adapters/qq-adapter.ts` |
| 微信适配 | — | — | `src/lib/bridge/adapters/weixin-adapter.ts` |

### 终端功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| 终端面板 | `src/components/layout/panels/WebTerminalPanel.tsx` | — | — |
| xterm 组件 | `src/components/terminal/XtermTerminal.tsx` | — | — |
| PTY 管理 | — | `src/app/api/terminal/route.ts` | `src/lib/pty-manager.ts` |
| 终端输出存储 | — | `src/app/api/terminal/stream/route.ts` | `src/lib/terminal-output-store.ts` |

### 定时任务功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| 定时任务页 | `src/app/scheduled-tasks/page.tsx` | `src/app/api/tasks/route.ts` | `src/lib/task-scheduler.ts` |
| 通知管理 | — | `src/app/api/tasks/notify/route.ts` | `src/lib/notification-manager.ts` |

### 知识库功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| 知识库页 | `src/app/knowledge-base/page.tsx` | `src/app/api/knowledge-base/route.ts` | `src/lib/knowledge-graph-provider.ts` |
| 记忆客户端 | — | — | `src/lib/memory-client.ts` |
| 记忆提取 | — | — | `src/lib/memory-extractor.ts` |

### Dashboard / Widget 功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| Dashboard 面板 | `src/components/layout/panels/DashboardPanel.tsx` | `src/app/api/dashboard/route.ts` | `src/lib/dashboard-store.ts` |
| Widget 渲染 | `src/components/chat/WidgetRenderer.tsx` | — | `src/lib/widget-sanitizer.ts` |
| Widget 沙箱 | — | — | `src/lib/widget-css-bridge.ts` |

### CLI Tools 功能

| 功能 | 前端文件 | 后端 API | 核心逻辑 |
|------|---------|----------|----------|
| CLI 工具页 | `src/app/cli-tools/page.tsx` | `src/app/api/cli-tools/route.ts` | `src/lib/cli-tools-mcp.ts` |

---

## 2. 页面 → 组件映射

```
src/app/layout.tsx                          # 根布局
  └─ ThemeProvider → ThemeFamilyProvider → I18nProvider → AppShell

src/app/chat/page.tsx                       # /chat 新聊天
  ├─ ChatEmptyState                         # 空状态（无目录/无服务商提示）
  ├─ MessageList                            # 消息列表
  │   ├─ MessageItem                        # 单条消息
  │   │   ├─ ai-elements/message.tsx        # 消息气泡渲染
  │   │   ├─ ReferencedContexts             # 引用上下文
  │   │   └─ ImageLightbox                  # 图片灯箱
  │   └─ StreamingMessage                   # 流式消息
  │       ├─ ai-elements/shimmer.tsx        # 加载动画
  │       └─ ai-elements/tool-actions-group # 工具调用组
  ├─ MessageInput                           # 输入框
  │   ├─ MessageInputParts                  # 输入子部件
  │   ├─ SlashCommandPopover                # 斜杠命令弹窗
  │   ├─ ModelSelectorDropdown              # 模型选择
  │   ├─ EffortSelectorDropdown             # 推理强度选择
  │   ├─ ImageGenToggle                     # 图片生成开关
  │   └─ CliToolsPopover                    # CLI 工具弹窗
  ├─ ChatComposerActionBar                  # 操作栏（模式/权限/控制台）
  ├─ ChatPermissionSelector                 # 权限选择器
  ├─ PermissionPrompt                       # 权限确认提示
  ├─ FolderPicker                           # 文件夹选择器
  └─ OnboardingWizard                       # 新手引导

src/app/chat/[id]/page.tsx                  # /chat/:id 会话视图
  └─ ChatView                               # 完整会话视图

src/app/settings/page.tsx                   # /settings 设置
  └─ SettingsLayout                         # 设置布局（侧栏导航 + 内容区）
      ├─ GeneralSection                     # 通用设置
      │   └─ AppearanceSection              # 外观设置
      ├─ ProviderManager                    # 服务商管理
      │   ├─ ProviderForm                   # 服务商表单
      │   ├─ PresetConnectDialog            # 预设连接对话框
      │   └─ ProviderDoctorDialog           # 服务商诊断
      ├─ ProviderOptionsSection             # 服务商选项
      ├─ CliSettingsSection                 # CLI 设置
      │   └─ ImportSessionDialog            # 导入会话对话框
      ├─ UsageStatsSection                  # 用量统计
      ├─ AssistantWorkspaceSection          # 助手工作区
      │   └─ AssistantSettingsCard          # 助手设置卡片
      ├─ LangOptSettingsSection             # 语言优化设置
      ├─ RulesSection                       # 自定义规则
      └─ WidgetsSection                     # Widget 配置

src/components/layout/AppShell.tsx          # 根布局壳
  ├─ ChatListPanel                          # 左侧会话列表
  │   ├─ SessionListItem                    # 单个会话行
  │   └─ ProjectGroupHeader                 # 项目分组头
  ├─ UnifiedTopBar                          # 顶部导航栏
  ├─ PanelZone                              # 面板渲染区
  │   ├─ AssistantPanel                     # 助手面板
  │   ├─ DashboardPanel                     # 仪表盘面板
  │   ├─ GitPanel                           # Git 面板
  │   ├─ PreviewPanel                       # 预览面板
  │   ├─ FileTreePanel                      # 文件树面板
  │   └─ WebTerminalPanel                   # 终端面板
  ├─ BrowserTabView                         # 内嵌浏览器
  ├─ BottomPanelContainer                   # 底部面板容器
  ├─ SplitChatContainer                     # 分屏聊天
  ├─ GlobalSearchDialog                     # Cmd+K 全局搜索
  ├─ UpdateDialog / UpdateBanner            # 更新提示
  └─ FeatureAnnouncementDialog              # 新功能公告
```

---

## 3. UI 组件 → 文件映射

### 按界面区域查找

| 界面区域 | 组件文件 | 说明 |
|---------|---------|------|
| 顶部导航栏 | `src/components/layout/UnifiedTopBar.tsx` | 包含导航、搜索、更新提示 |
| 左侧会话栏 | `src/components/layout/ChatListPanel.tsx` | 会话列表、搜索、新建 |
| 聊天输入区 | `src/components/chat/MessageInput.tsx` | 文本输入、附件、斜杠命令 |
| 聊天操作栏 | `src/components/chat/ChatComposerActionBar.tsx` | 发送、工具、模式切换 |
| 消息气泡 | `src/components/ai-elements/message.tsx` | Markdown 渲染、代码块、操作按钮 |
| 代码块 | `src/components/ai-elements/code-block.tsx` | 语法高亮、复制、运行 |
| 工具调用显示 | `src/components/ai-elements/tool-actions-group.tsx` | 工具调用分组、完成进度 |
| 流式加载动画 | `src/components/ai-elements/shimmer.tsx` | 骨架屏 |
| Agent 时间线 | `src/components/chat/AgentTimeline.tsx` | Agent 执行步骤时间线 |
| 子Agent时间线 | `src/components/chat/SubAgentTimeline.tsx` | 多 Agent 执行时间线 |
| 图片生成卡片 | `src/components/chat/ImageGenCard.tsx` | AI 生成图片结果 |
| 批量生成面板 | `src/components/chat/batch-image-gen/` | 批量图片生成（5个文件） |
| Widget 渲染器 | `src/components/chat/WidgetRenderer.tsx` | Dashboard widget iframe 渲染 |
| Diff 摘要 | `src/components/chat/DiffSummary.tsx` | 代码变更摘要 |
| 运行时徽章 | `src/components/chat/RuntimeBadge.tsx` | 当前运行时标识 |
| 上下文用量条 | `src/components/chat/ContextUsageIndicator.tsx` | 上下文窗口使用率 |
| 会话状态点 | `src/components/chat/SessionStatusIndicator.tsx` | 连接状态指示 |
| 权限确认 | `src/components/chat/PermissionPrompt.tsx` | 工具权限审批 |
| Git 状态区 | `src/components/git/GitStatusSection.tsx` | 工作区变更列表 |
| Git 历史区 | `src/components/git/GitHistorySection.tsx` | 提交历史列表 |
| Git Diff 查看 | `src/components/git/GitDiffViewer.tsx` | 代码 Diff 视图 |
| Git Stash | `src/components/git/GitStashSection.tsx` | Stash 管理 |
| Git Worktree | `src/components/git/GitWorktreeSection.tsx` | Worktree 管理 |
| 终端模拟器 | `src/components/terminal/XtermTerminal.tsx` | xterm.js 终端 |
| 内嵌浏览器 | `src/components/browser/BuiltinBrowser.tsx` | 地址栏 + 网页视图 |
| 文件树 | `src/components/project/EnhancedFileTree.tsx` | 完整文件树 |
| 文件预览 | `src/components/layout/panels/PreviewPanel.tsx` | 代码预览 + 高亮 |

### 基础 UI 组件 (`src/components/ui/`)

| 组件 | 文件 | 用途 |
|------|------|------|
| Button | `button.tsx` | 按钮（default/outline/ghost 等变体） |
| Input | `input.tsx` | 文本输入 |
| Textarea | `textarea.tsx` | 多行输入 |
| Card | `card.tsx` | 卡片容器 |
| Dialog | `dialog.tsx` | 模态对话框 |
| AlertDialog | `alert-dialog.tsx` | 确认对话框 |
| Select | `select.tsx` | 下拉选择 |
| Badge | `badge.tsx` | 状态/分类标签 |
| Switch | `switch.tsx` | 开关 |
| Checkbox | `checkbox.tsx` | 复选框 |
| Label | `label.tsx` | 表单标签 |
| Tabs | `tabs.tsx` | Tab 导航 |
| Toast | `toast.tsx` | 通知提示 |
| Tooltip | `tooltip.tsx` | 悬浮提示 |
| DropdownMenu | `dropdown-menu.tsx` | 下拉菜单 |
| ContextMenu | `context-menu.tsx` | 右键菜单 |
| ScrollArea | `scroll-area.tsx` | 自定义滚动条 |
| Sheet | `sheet.tsx` | 侧滑面板 |
| Command | `command.tsx` | Cmd+K 命令面板 |
| Spinner | `spinner.tsx` | 加载动画 |
| Icon | `icon.tsx` | Phosphor 图标库 |
| ErrorBanner | `error-banner.tsx` | 错误横幅 |

---

## 4. API 路由速查

### Chat 路由 (`src/app/api/chat/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/chat` | POST | 发送消息，SSE 流式响应 |
| `/api/chat/warmup` | POST | 会话预热，提前启动 SDK 子进程 |
| `/api/chat/messages` | POST/PUT | 创建/编辑消息 |
| `/api/chat/sessions` | GET/POST | 会话列表/新建 |
| `/api/chat/sessions/[id]` | GET/PATCH/DELETE | 单会话 CRUD |
| `/api/chat/sessions/[id]/messages` | GET | 分页消息 |
| `/api/chat/sessions/by-cwd` | GET | 按工作目录查会话 |
| `/api/chat/permission` | GET/POST | 权限状态/审批 |
| `/api/chat/model` | POST | 切换模型 |
| `/api/chat/mode` | POST | 切换模式 |
| `/api/chat/rewind` | POST | 回退对话 |
| `/api/chat/interrupt` | POST | 中断生成 |
| `/api/chat/search` | GET | 搜索消息 |
| `/api/chat/review` | GET/POST | 代码审查 |
| `/api/chat/background` | POST | 后台执行 |
| `/api/chat/optimize-prompt` | POST | Prompt 优化 |

### Bridge 路由 (`src/app/api/bridge/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/bridge` | GET/POST | Bridge 状态/启停 |
| `/api/bridge/channels` | GET | 渠道列表 |
| `/api/bridge/settings` | GET/PUT | Bridge 设置 |
| `/api/bridge/chat` | POST | 渠道消息发送 |
| `/api/bridge/feishu/register/*` | POST | 飞书注册流程 |

### Provider 路由 (`src/app/api/providers/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/providers` | GET/POST | 服务商列表/新增 |
| `/api/providers/[id]` | GET/PUT/DELETE | 单服务商 CRUD |
| `/api/providers/[id]/activate` | POST | 激活服务商 |
| `/api/providers/[id]/models` | GET/POST/DELETE | 模型管理 |
| `/api/providers/options` | GET/PUT | 服务商选项 |
| `/api/providers/set-default` | POST | 设置默认 |
| `/api/providers/test` | POST | 测试连接 |

### Git 路由 (`src/app/api/git/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/git/status` | GET | 工作区状态 |
| `/api/git/log` | GET | 提交历史 |
| `/api/git/branches` | GET | 分支列表 |
| `/api/git/diff` | GET | 文件 Diff |
| `/api/git/stage` | POST | 暂存文件 |
| `/api/git/unstage` | POST | 取消暂存 |
| `/api/git/commit` | POST | 创建提交 |
| `/api/git/checkout` | POST | 切换分支 |
| `/api/git/push` | POST | 推送 |
| `/api/git/pull` | POST | 拉取 |
| `/api/git/stash` | GET/POST | Stash 管理 |
| `/api/git/discard` | POST | 丢弃更改 |
| `/api/git/ai-review` | POST | AI 审查 |
| `/api/git/worktrees` | GET | Worktree 列表 |
| `/api/git/worktrees/derive` | POST | 创建 Worktree |

### Media 路由 (`src/app/api/media/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/media/gallery` | GET | 画廊列表 |
| `/api/media/serve` | GET | 媒体文件服务 |
| `/api/media/[id]` | GET/DELETE | 单媒体 CRUD |
| `/api/media/[id]/tags` | PUT | 更新标签 |
| `/api/media/[id]/favorite` | PUT | 收藏切换 |
| `/api/media/generate` | POST | 图片生成 |
| `/api/media/jobs` | GET/POST | 批量任务管理 |
| `/api/media/jobs/[id]/*` | POST/GET | 任务控制 |

### Settings 路由 (`src/app/api/settings/`)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/settings` | GET/PUT | Claude 设置 |
| `/api/settings/app` | GET/PUT | 应用设置 |
| `/api/settings/workspace` | GET/PUT/PATCH | 工作区配置 |
| `/api/settings/custom-rules` | CRUD | 自定义规则 |
| `/api/settings/telegram` | GET/PUT | Telegram 配置 |
| `/api/settings/feishu` | GET/PUT | 飞书配置 |
| `/api/settings/discord` | GET/PUT | Discord 配置 |
| `/api/settings/qq` | GET/PUT | QQ 配置 |
| `/api/settings/weixin` | GET/PUT | 微信配置 |

### 其他路由

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/files/*` | GET/POST | 文件操作（浏览/读写/删除） |
| `/api/plugins/mcp/*` | GET/PUT/POST/DELETE | MCP 服务器管理 |
| `/api/skills/*` | GET/POST/PUT/DELETE | Skills 管理 |
| `/api/tasks/*` | GET/POST/PUT/PATCH/DELETE | 定时任务管理 |
| `/api/dashboard/*` | GET/POST/PUT/DELETE | Dashboard Widget |
| `/api/workspace/*` | GET/POST | 助手工作区 |
| `/api/claude-status` | GET | Claude CLI 状态 |
| `/api/doctor/*` | GET/POST | 系统诊断 |
| `/api/terminal` | GET/POST | 终端管理 |
| `/api/knowledge-base` | GET/POST | 知识库 |
| `/api/health` | GET | 健康检查 |
| `/api/setup` | GET/PUT | 初始化向导 |
| `/api/search` | GET | 全局搜索 |

---

## 5. 核心 lib 文件

### AI / Agent 核心

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `src/lib/claude-client.ts` | AI 客户端中心，流式响应 | `streamClaude()`, `streamClaudeSdk()`, `testProviderConnection()` |
| `src/lib/persistent-claude-session.ts` | SDK 持久会话池，预热与复用 | `warmupPersistentClaudeSession()`, `getPersistentClaudeTurn()`, `buildPersistentClaudeSignature()` |
| `src/lib/agent-loop.ts` | Native AI SDK Agent 循环 | `runAgentLoop()` |
| `src/lib/agent-system-prompt.ts` | 系统提示词组装 | `buildSystemPrompt()` |
| `src/lib/agent-routing.ts` | Agent 模型路由 | `resolveAgentModel()` |
| `src/lib/agent-timeline.ts` | 时间线步骤解析 | `extractTimelineStepsFromBlocks()` |
| `src/lib/agent-tools.ts` | Agent 工具集构建 | Tool definitions |
| `src/lib/stream-session-manager.ts` | 流式会话状态管理 | `startStream()`, `stopStream()`, `subscribe()`, `getSnapshot()` |
| `src/lib/pending-session-message.ts` | 首轮消息暂存与会话跳转交接 | `stagePendingSessionMessage()`, `consumePendingSessionMessage()` |

### Provider / 模型

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `src/lib/provider-resolver.ts` | 解析活跃服务商 | `resolveProvider()` |
| `src/lib/provider-catalog.ts` | 预设服务商目录 | `getPreset()`, `getDefaultModelsForProvider()` |
| `src/lib/provider-doctor.ts` | 服务商诊断 | `runDiagnosis()`, `runLiveProbe()` |
| `src/lib/provider-presence.ts` | 服务商可用性检查 | `hasCodePilotProvider()` |
| `src/lib/text-generator.ts` | 文本生成（非流式） | `generateTextFromProvider()` |
| `src/lib/ai-provider.ts` | AI SDK 模型实例创建 | `createModel()` |

### 数据层

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `src/lib/db.ts` | SQLite 数据库（~3200行） | 100+ CRUD 函数 |
| `src/lib/utils.ts` | 通用工具函数 | `cn()`, `getLocalDateString()` |
| `src/lib/platform.ts` | 平台检测 | `findClaudeBinary()`, `isWindows`, `isMac` |
| `src/lib/files.ts` | 文件系统操作 | `scanDirectory()`, `readFilePreview()` |
| `src/lib/diff-utils.ts` | Diff 计算 | `computeDiff()` |

### MCP 相关

| 文件 | 职责 |
|------|------|
| `src/lib/mcp-loader.ts` | MCP 配置加载 |
| `src/lib/mcp-connection-manager.ts` | MCP 连接管理、工具调用 |
| `src/lib/mcp-tool-adapter.ts` | MCP → AI SDK 工具适配 |
| `src/lib/dashboard-mcp.ts` | Dashboard widget MCP 服务 |
| `src/lib/cli-tools-mcp.ts` | CLI 工具 MCP 服务 |
| `src/lib/notification-mcp.ts` | 通知 MCP 服务 |
| `src/lib/memory-search-mcp.ts` | 记忆搜索 MCP 服务 |

### Bridge 系统

| 文件 | 职责 |
|------|------|
| `src/lib/bridge/bridge-manager.ts` | Bridge 生命周期管理 |
| `src/lib/bridge/channel-router.ts` | 消息路由 |
| `src/lib/bridge/conversation-engine.ts` | AI 对话引擎 |
| `src/lib/bridge/adapters/*.ts` | 各渠道适配器 |

### 运行时

| 文件 | 职责 |
|------|------|
| `src/lib/runtime/registry.ts` | 运行时选择（SDK vs Native） |
| `src/lib/runtime/sdk-runtime.ts` | Claude Code SDK 运行时 |
| `src/lib/runtime/native-runtime.ts` | Native AI SDK 运行时 |
| `src/lib/cc-switch.ts` | CC Switch 切换逻辑 |

### 主题系统

| 文件 | 职责 |
|------|------|
| `src/lib/theme/types.ts` | 主题类型定义 |
| `src/lib/theme/context.ts` | React Context |
| `src/lib/theme/render-css.ts` | CSS 变量渲染 |
| `src/lib/theme/code-themes.ts` | 代码高亮主题映射 |

### 国际化

| 文件 | 职责 |
|------|------|
| `src/i18n/index.ts` | translate() 函数，Locale 定义 |
| `src/i18n/en.ts` | 英文翻译（~1870 keys，源文件） |
| `src/i18n/zh.ts` | 中文翻译 |

### 类型定义

| 文件 | 职责 |
|------|------|
| `src/types/index.ts` | 主类型文件（~1500行），所有核心接口 |
| `src/types/dashboard.ts` | Dashboard Widget 类型 |
| `src/types/stock.ts` | 股票 Widget 类型 |
| `src/types/electron.d.ts` | Electron API 类型 |

---

## 6. Hooks 速查

| Hook | 状态 | 使用方 |
|------|------|--------|
| `useSSEStream` | SSE 流式状态 | ChatView |
| `useStreamSubscription` | 订阅流更新 | ChatView |
| `useSettings` | 应用设置 KV | 设置组件 |
| `useTranslation` | i18n 翻译 | 几乎所有组件 |
| `useAppTheme` | 主题模式 | 布局组件 |
| `usePanel` | 侧栏面板状态 | 布局、TopBar |
| `useSplit` | 分屏状态 | 布局组件 |
| `useToast` | Toast 通知 | 全局 |
| `useTerminal` | 终端会话 | 终端组件 |
| `useClaudeStatus` | Claude CLI 状态 | 设置、连接状态 |
| `useBridgeStatus` | Bridge 连接状态 | Bridge 设置 |
| `useUpdate` | 应用更新状态 | 更新通知 |
| `useContextUsage` | 上下文窗口用量 | 聊天 UI |
| `useProviderModels` | 可用模型列表 | 模型选择器 |
| `useGitStatus` | Git 状态 | Git 面板 |
| `useGitBranches` | Git 分支 | Git 面板 |
| `useGitLog` | Git 历史 | Git 面板 |
| `useGitWorktrees` | Git Worktree | Git 面板 |
| `useAssistantWorkspace` | 助手工作区 | 助手设置 |
| `useImageGen` | 图片生成状态 | 图片生成 UI |
| `useBatchImageGen` | 批量生成状态 | 批量生成 UI |
| `useChatCommands` | 聊天命令 | ChatView |
| `useSlashCommands` | 斜杠命令 | MessageInput |
| `usePopoverState` | 弹窗状态 | MessageInput |

---

## 7. Electron 主进程

| 文件 | 职责 |
|------|------|
| `electron/main.ts` | 主进程入口（~1744行）：窗口管理、Next.js 服务、系统托盘、安装向导、IPC 处理 |
| `electron/preload.ts` | Context Bridge：暴露 electronAPI 到渲染进程 |
| `electron/terminal-manager.ts` | PTY 终端管理（node-pty） |
| `electron/updater.ts` | 自动更新（已禁用） |

---

## 8. 依赖热路径

> 改动这些文件影响范围最大，需格外谨慎

| 文件 | 被依赖次数 | 说明 |
|------|-----------|------|
| `src/lib/db.ts` | ~80+ | 几乎所有 API 路由都依赖 |
| `src/lib/utils.ts` | ~50+ | cn() classnames 工具 |
| `src/types/index.ts` | ~40+ | 所有核心类型定义 |
| `src/lib/platform.ts` | ~20+ | 平台检测逻辑 |
| `src/lib/claude-client.ts` | ~15+ | AI 客户端中心 |
| `src/lib/provider-catalog.ts` | ~10+ | 服务商预设 |
| `src/lib/provider-resolver.ts` | ~8+ | 服务商解析 |
| `src/lib/buddy.ts` | ~8+ | AI 伙伴系统 |
| `src/lib/error-classifier.ts` | ~6+ | 错误分类 |
| `src/lib/stream-session-manager.ts` | ~6+ | 流式会话管理 |
| `src/lib/assistant-workspace.ts` | ~6+ | 助手工作区 |

---

## 快速使用指南

**场景 1**：用户说"修改聊天输入框的样式"
→ 查 §3 UI 组件 → 找到 `src/components/chat/MessageInput.tsx`

**场景 2**：用户说"Git push 功能有 bug"
→ 查 §1 Git 功能 → 前端 `src/components/git/PushDialog.tsx`，API `src/app/api/git/push/route.ts`

**场景 3**：用户说"添加新的 AI 服务商"
→ 查 §1 设置功能 → `src/components/settings/ProviderManager.tsx` + `ProviderForm.tsx`，API `src/app/api/providers/route.ts`

**场景 4**：用户说"修改数据库 schema"
→ 查 §5 核心 lib → `src/lib/db.ts`，类型在 `src/types/index.ts`

**场景 5**：用户说"改国际化文案"
→ 查 §5 国际化 → `src/i18n/en.ts` + `src/i18n/zh.ts`（必须同步修改两个文件）
