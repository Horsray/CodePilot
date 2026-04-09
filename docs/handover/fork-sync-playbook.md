# Fork 同步与自动合并记忆

适用于本仓库相对 `https://github.com/op7418/CodePilot` 的增量维护。

AI 在处理“同步主项目”“合并官方更新”“解决冲突”“保留 fork 定制能力”等任务前，必须先阅读：

1. 根目录 `CLAUDE.md`
2. 根目录 `AGENTS.md`
3. 本文 `docs/handover/fork-sync-playbook.md`

## 目标

这份文档不是单纯记录“改过什么”，而是给未来的 AI 一个稳定的合并记忆入口，让它在拉取官方更新时知道：

- 这个仓库是 `op7418/CodePilot` 的 fork
- 哪些能力是 fork 独有的，不能被官方更新覆盖掉
- 哪些文件是高冲突区，合并时要重点看
- 应该优先采用什么合并策略
- 合并完成后要验证哪些能力

## 仓库关系

- 官方上游仓库：`upstream = https://github.com/op7418/CodePilot.git`
- 当前 fork 仓库：`origin = https://github.com/Horsray/CodePilot.git`
- 当前长期维护分支：`integration/official-skeleton`
- 当前 fork 与 `upstream/main` 的共同基线可通过 `git merge-base HEAD refs/remotes/upstream/main` 获取

建议把 `integration/official-skeleton` 视为“官方能力 + 本地定制”的集成分支，后续所有同步都先在临时同步分支完成，再回合到该分支。

## 当前已知 fork 差异

基于当前已提交的 fork 增量，和官方主项目相比，差异主要集中在以下方向。

### 1. 终端与控制台能力

目标是把桌面端 AI 助手进一步做成可执行、可观测的工作台，而不只是聊天窗口。

涉及文件：

- `electron/terminal-manager.ts`
- `src/app/api/terminal/route.ts`
- `src/app/api/terminal/stream/route.ts`
- `src/lib/pty-manager.ts`
- `src/lib/terminal-output-store.ts`
- `src/hooks/useWebTerminal.ts`
- `src/components/terminal/XtermTerminal.tsx`
- `src/components/console/ConsolePanel.tsx`
- `src/components/layout/BottomPanelContainer.tsx`
- `src/components/layout/panels/WebTerminalPanel.tsx`

保留要求：

- 终端支持实时交互
- 终端输出支持流式读取
- 底部面板中可切换终端和控制台
- 控制台具备日志查看、搜索、高亮、复制等工作流能力

### 2. 内置浏览器能力

目标是在应用内增加浏览器标签页，使“聊天 + 浏览 + 操作”形成闭环。

涉及文件：

- `src/components/browser/BuiltinBrowser.tsx`
- `src/components/layout/BrowserTabView.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/UnifiedTopBar.tsx`
- `src/components/layout/ChatListPanel.tsx`

保留要求：

- 可以在聊天视图与浏览器视图之间切换
- 浏览器入口不能因官方布局调整而丢失
- 顶部导航、标签视图、主体布局之间的联动需要继续可用

### 3. CC Switch 服务商接入

目标是让模型调用可以在本地、`/api` 和中转平台之间切换，形成更适合本地使用习惯的 provider 接入方式。

涉及文件：

- `src/lib/cc-switch.ts`
- `src/lib/provider-catalog.ts`
- `src/components/settings/provider-presets.tsx`
- `src/components/settings/PresetConnectDialog.tsx`
- `src/components/settings/ProviderForm.tsx`
- `src/components/settings/ProviderManager.tsx`
- `src/app/api/providers/route.ts`
- `src/app/api/providers/models/route.ts`
- `src/__tests__/unit/provider-preset.test.ts`

保留要求：

- 设置页里继续能配置 CC Switch
- provider preset、表单字段、模型列表获取逻辑保持一致
- 官方如果调整 provider 架构，应把 CC Switch 适配进新架构，而不是删除该能力

### 4. 中转平台媒体生成支持

原项目仅支持google官方的模型，扩展为支持中转站api模式的媒体生成能力，并可自定义维护base_url和api接口后缀，模型名称等必要参数。

涉及文件：

- `src/lib/image-provider-utils.ts`
- `src/lib/image-generator.ts`
- `src/app/api/media/generate/route.ts`

保留要求：

- generic-image 或等价中转能力不能在合并时被回退
- 媒体协议、端点配置、provider 解析逻辑要与上游更新对齐

### 5. 文件树 UI 与交互增强

目标是增强文件树在真实项目场景中的可用性，增加右键菜单，可以把文件添加到对话，新建文件，新建文件夹，删除文件等能力。

涉及文件：

- `src/components/project/EnhancedFileTree.tsx`
- `src/components/project/FileTree.tsx`
- `src/components/layout/panels/FileTreePanel.tsx`

保留要求：

- 文件树增强交互不能被官方 UI 回滚
- 展开状态、本地持久化、交互体验需要保留
- 如果官方后续重构文件树结构，应把增强逻辑迁移到新结构里

### 6. 配套 UI、资源与国际化调整

涉及文件：

- `src/components/ui/context-menu.tsx`
- `src/components/ui/icon.tsx`
- `src/i18n/en.ts`
- `src/i18n/zh.ts`
- `public/icons/toplogo.png`
- `package.json`
- `package-lock.json`

保留要求：

- fork 新能力对应的文案、图标、依赖不能漏掉
- 官方新增 i18n 键时，fork 自定义键不能被覆盖丢失

## 合并时的高冲突区

以下文件或模块在后续同步官方更新时最容易发生冲突，AI 必须优先审查：

- 布局入口：`src/components/layout/AppShell.tsx`
- 顶部导航：`src/components/layout/UnifiedTopBar.tsx`
- 文件树：`src/components/project/FileTree.tsx`、`src/components/layout/panels/FileTreePanel.tsx`
- Provider 设置：`src/components/settings/ProviderForm.tsx`、`ProviderManager.tsx`、`provider-presets.tsx`
- Provider 后端：`src/app/api/providers/route.ts`、`src/app/api/providers/models/route.ts`
- 媒体生成：`src/lib/image-generator.ts`、`src/app/api/media/generate/route.ts`
- 国际化：`src/i18n/en.ts`、`src/i18n/zh.ts`
- 类型与依赖：`src/types/index.ts`、`package.json`

如果官方更新也修改了这些文件，AI 不允许简单地“整文件覆盖”，必须做结构化合并。

## AI 合并原则

未来 AI 在同步官方更新时，默认遵循下面的优先级：

1. 优先吸收官方的安全修复、基础设施修复、架构升级、依赖升级
2. 优先保留本 fork 的产品能力和入口，不允许把终端、浏览器、控制台、CC Switch、媒体中转、增强文件树直接合并掉
3. 如果官方重构了相同模块，优先把 fork 能力迁移到新结构，而不是把官方重构回退成旧结构
4. 对公共层代码优先采用官方实现，对 fork 独有能力采用“追加适配”的方式挂回去
5. 合并冲突时，先判断“这是官方基础能力变更”还是“这是 fork 产品能力入口”，不要只按最近修改时间取舍

一句话原则：**优先继承官方演进，再把 fork 定制能力重新挂载回新的官方骨架。**

## 推荐同步流程

推荐使用 merge，不推荐默认用 rebase。

原因：

- 这是一个长期跟随官方演进的 fork，merge 更适合保留同步历史
- AI 自动处理时，merge 的冲突语义更直观
- 如果已经有自己持续迭代的提交，rebase 更容易把历史改写得难以追踪

建议流程：

```bash
git status
git fetch upstream
git checkout integration/official-skeleton
git checkout -b sync/upstream-YYYYMMDD
git merge upstream/main
```

然后让 AI 按下面顺序处理：

1. 先看 `git status`，确保没有未提交改动混入同步任务
2. 看 `git diff --name-only --diff-filter=U` 找出冲突文件
3. 先处理“高冲突区”文件
4. 逐项核对本文中的 fork 独有能力是否还存在
5. 跑测试并做功能回归
6. 确认无误后，再把同步分支合回 `integration/official-skeleton`

## AI 自动读取记忆的落地方式

为了让未来的 AI 自动读到这份“fork 记忆”，需要保持下面三件事：

### 1. 固定文档路径

本文固定放在：

- `docs/handover/fork-sync-playbook.md`

不要频繁改名，避免未来 AI 找不到。

### 2. 在根规则文件里显式引用

未来 AI 最容易优先读取的是根目录规则文件，所以必须在：

- `CLAUDE.md`
- `AGENTS.md`

里明确写出：**处理 upstream 同步或官方合并任务前，先读本文。**

### 3. 每次 fork 新增能力后都更新本文

如果你后面又新增了功能，比如：

- 新的 provider
- 新的面板
- 新的 Electron 原生能力
- 新的 API 路由

就要把“功能目标、关键文件、保留要求、高冲突区”继续补进本文。这样 AI 才能把它当成长期记忆，而不是一次性说明。

## 给未来 AI 的标准任务提示词

以后你要同步官方更新时，可以直接把下面这段发给 AI：

```text
你现在在维护一个相对 op7418/CodePilot 的 fork。

在开始任何同步任务前，先阅读：
1. CLAUDE.md
2. AGENTS.md
3. docs/handover/fork-sync-playbook.md

然后执行下面目标：
- 拉取 upstream/main 的最新更新
- 将官方更新合并到 integration/official-skeleton
- 保留 fork 独有能力：终端、控制台、内置浏览器、CC Switch、媒体中转、增强文件树
- 优先继承官方的新架构和修复，再把 fork 能力适配回去
- 不允许通过整文件覆盖的方式粗暴解决冲突

输出内容必须包含：
- 本次 upstream 更新摘要
- 冲突文件清单
- 每个冲突文件的合并决策
- 合并后保留了哪些 fork 能力
- 运行了哪些测试和验证
```

## 合并后的验收清单

每次同步完官方更新后，至少确认以下能力仍然正常：

- 终端可以创建、连接、实时输出
- 控制台面板仍然可见且可操作
- 内置浏览器入口仍然存在，聊天与浏览器视图可以切换
- 设置页仍然可以配置 CC Switch
- 媒体生成链路仍然支持中转平台方案
- 文件树增强交互仍然存在
- 中英文文案没有漏项
- `npm run test` 通过
- 涉及 UI 改动时，`npm run test:smoke` 通过

## 文档维护规则

本文要保持“可执行记忆”而不是泛泛描述，所以后续更新时至少同步维护以下内容：

- fork 新增了什么能力
- 这些能力在哪些文件里
- 官方更新时哪些地方最容易冲突
- 合并完成后应该检查什么

如果未来 fork 的主要差异发生变化，优先更新本文，再让 AI 继续做同步任务。
