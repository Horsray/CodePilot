# cc-haha 界面与流式体验移植 — 技术交接文档

> 产品思考见 [docs/insights/cc-haha-ui-port.md](../insights/cc-haha-ui-port.md)

## 背景

CodePilot 原 UI 设计语言（shadcn 默认令牌 + Geist 字体 + 悬浮侧栏）与 cc-haha（`/Users/horsray/Documents/cc-haha`，React + Vite + Tailwind v4）的视觉存在明显差异；同时流式输出在中文场景下"一坨一坨"整块闪现。本次将 cc-haha 的设计令牌、布局骨架、聊天区视觉与流式渲染机制整体移植到 CodePilot，并移除原有的 13 套主题家族系统。

## 一、设计令牌与主题系统（P1）

### 令牌来源
- `src/app/globals.css` 全面重写，亮/暗两套令牌合并自 cc-haha `desktop/src/theme/globals.css`：
  - 亮色：`#e7ecf4` 页面底、`#FFFFFF` 卡片、`#0A56D0` 主色、`#E5E7EB` 描边
  - 暗色：`#111111` 页面底、`#1C1C1E` 卡片、`#60A5FA` 主色、`#374151` 描边、侧栏 `#171615`
- **兼容映射**：`@theme inline` 中同时保留 shadcn 命名（`--background/--card/--muted/--border/...`，映射到 cc-haha 值）与 cc-haha 语义命名（`--surface*/--on-surface/--outline-variant/--text-primary...`）。存量组件无需改类名即自动换肤。
- 字体：自托管 woff2（`public/fonts/`，从 cc-haha 拷贝）——Inter（正文）、Manrope（标题）、JetBrains Mono（代码）、Material Symbols；`layout.tsx` 不再使用 `next/font/google` 的 Geist。

### 主题切换机制变更
- 原：next-themes `attribute="class"`（`.dark`）+ `ThemeFamilyProvider` + `themes/*.json` 生成 `html[data-theme-family]` 覆盖层。
- 现：next-themes `attribute="data-theme"`；`@custom-variant dark (&:is([data-theme="dark"] *, [data-theme="dark"]))`。
- 直接读取 DOM 判断暗色的位置统一走 `src/lib/utils.ts` 的 `isDarkModeActive()`（data-theme + .dark 双兼容）：`WidgetRenderer.tsx`、`dashboard-export.ts`。

### 已删除（多主题家族）
- `themes/*.json`（13 套）、`src/lib/theme/{loader,render-css,context,types}.ts`、`src/components/layout/ThemeFamilyProvider.tsx`、对应单测。
- `layout.tsx` 的 anti-FOUC 主题家族脚本与 `<style id="theme-family-vars">`、`electron-builder.yml` 的 `themes/` 打包项、`api/settings/app` 的 `theme_family` 白名单、i18n 键、设置页"颜色主题"选择器。
- 代码高亮改为固定默认：Shiki `github-light/github-dark`，hljs `atomOneLight/atomOneDark`（`code-themes.ts` 保留映射表并新增本地 `CodeThemeMapping` 类型）。

## 二、流式渲染管线（P2，核心痛点修复）

### 根因
1. `StreamingMessage.tsx` 旧 `useBufferedContent`：不足 40 个空白分词或 2500ms 不显示 → 中文 `split(/\s+/)` 恒为 1 个词 → 首段必然 2.5s 后整块闪现（"一坨"的直接原因）。
2. 流式期间每帧全量 Markdown 重解析（Streamdown），长文本掉帧。

### 现方案（移植 cc-haha）
- `src/lib/stream-session-manager.ts` 新增**渐进揭示队列**：
  - 常量：`PROGRESSIVE_TEXT_CHUNK_SIZE=6`、`PROGRESSIVE_TEXT_INTERVAL_MS=12`、`PROGRESSIVE_TEXT_TRIGGER_CHARS=240`。
  - `updateStreamingText(acc)` 统一入口：单次增量 >240 字符或队列未排空 → `startRevealPump()` 每 12ms 推进 6 字符；否则 `revealedLength = acc.length` 直接发布（16ms 节流不变）。
  - 快照 `streamingContent` = `accumulatedText.slice(0, revealedLength)`；`flushReveal()` 在工具事件（`flushTextThrottle`）、流结束、错误、清理时立即补齐全文。
  - `ActiveStream` 新增 `revealedLength` / `revealTimer` 字段（三处构造点均需初始化——新增字段时注意 `seedSnapshotPatch` 的 placeholder）。
  - 思考文本节流 48ms → 96ms（对齐 cc-haha 的 120ms 量级）。
- `StreamingMessage.tsx`：删除 `useBufferedContent`；流式正文改用 `<pre class="streaming-plain-text">`（轻量纯文本，结束时由 MessageItem 切换为完整 Markdown）；状态栏加 ✦ 渐变星标（`.streaming-star`）。
- 实测验证（CDP 采样 60ms/次）：流式全程最大增量 ≤46 字符，无 >120 字符跳变；改造前中文场景为 0→整段。

## 三、布局骨架（P3）

- `AppShell.tsx`：侧栏改**停靠式**（参与 flex 排布，去掉绝对定位悬浮与 `paddingLeft` 避让）；主内容区 + 右侧面板改为**独立圆角卡片**（`rounded-2xl border-border/60 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.04)]`），浮在页面底色上，右侧 `py-2 pr-2 gap-1.5`。
- `ChatListPanel.tsx`：容器 `relative h-full bg-[var(--surface-sidebar)]`，默认宽度 240 → 270（`AppShell` state）。
- `PanelZone.tsx`：右侧面板独立卡片化。
- `UnifiedTopBar.tsx`：作为卡内 TabBar（`h-[52px] bg-card border-b`）。

## 四、聊天区视觉（P4）

- `ai-elements/message.tsx`：`Message` 助手侧新增 20px 图标槽（16px `ChatCircle`，`#2F80ED`）+ `flex gap-3`；用户消息 `max-w-[85%]`、气泡 `rounded-2xl rounded-tr-md px-4 py-2.5`（值来自 `--user-bubble`）。
- `MessageList.tsx`：消息列 `mx-auto max-w-[860px] px-6 pt-4 pb-8 gap-5`。
- `ui/input-group.tsx`：输入框 `rounded-xl border bg-card/70 backdrop-blur-xl`，聚焦 1px 主色 ring + 柔和光晕。
- 硬编码 `bg-white` 清理（暗色漏白）：`ui/input.tsx`、`ui/select.tsx`、`ui/badge.tsx`、`patterns/CommandList.tsx` → `bg-card` / `bg-popover`。

## 五、深度对照移植（第二轮，P7–P11）

以 cc-haha 实机（`cd /Users/horsray/Documents/cc-haha && bun run dev`，前端 1420）为基准逐项测量对齐：

### 输入框（composer）
- cc-haha 规格（ChatInput.tsx:1098）：`rounded-[8px] border bg-white/70 dark:bg-[#1E1E20]/70 backdrop-blur-xl`，**无基础阴影**；聚焦 `border-primary + ring-1 + shadow-[0_0_30px_rgba(10,86,208,0.2)]`。
- 修复：删除 `MessageInput.tsx` 外层的 `bg-background/80 backdrop-blur-lg` 灰色背景带（用户反馈的"多了一个背景色"）；`input-group.tsx` 去掉 shadow-sm，聚焦态改为与 cc-haha 一致的 1px 主色 ring + 光晕。

### 右侧面板（PanelZone 重写）
- cc-haha 结构（AppShell.tsx:414-465）：独立圆角卡片 `rounded-2xl border-black/5 shadow-[0_4px_24px_rgba(0,0,0,0.04)]` → 顶部 1px 分隔线（`bg-border opacity-50 shadow-[0_1px_2px_rgba(0,0,0,0.04)]`）→ 52px 工具栏 → 1px 分隔线 → 面板内容。
- 工具栏按钮（TabBar.tsx:512 ToolbarIconButton）：32×32、`rounded-[10px]`、未激活 `text-text-tertiary hover:bg-surface-hover`、激活 `bg-[var(--user-bubble)] text-[var(--user-bubble-foreground)] + 微阴影`、hover 浮签。
- 按钮显示位置（cc-haha 行为）：右侧面板关闭时在顶栏右侧显示；打开时移入面板卡片头部，避免重复。
- 面板互斥打开（打开一个自动关闭其他），与 cc-haha 一致。

### 终端位置迁移
- 终端/控制台从底部抽屉（原 `BottomPanelContainer`，已删除）迁入右侧面板卡片。
- **保活策略**：PanelZone 常驻挂载（AppShell 不再按路由条件渲染），无面板打开时整卡 `display:none`；终端/控制台用 `hidden` 切换可见性，组件不卸载，PTY 会话与 xterm 滚动记录保留（实测：关闭再打开终端，shell 历史仍在）。
- 终端视图顶部保留紧凑操作条（快捷命令 / 新建会话，沿用 `terminal:toggle-quick-cmds`、`terminal:new-session` 自定义事件）。
- 终端/控制台无自身宽度，PanelZone 兜底 400px；其他面板沿用各自宽度（Git 360 / 看板 320 / 预览 480）。

### 顶栏细节
- TabBar 52px 改为无 border-bottom；分隔线由 AppShell 的独立 1px div 承担（同 cc-haha）。

## 六、验证方式

- `npm run typecheck`、`npm run test`（1250 用例，1 个失败为 `task-executor-v2` 需要真实 provider 且当前环境模型名无效，与本次无关）。
- `npm run test:smoke`：5 通过 1 失败——`mention-picker-style.spec.ts` 断言的 `.font-medium.text-muted-foreground` 与当前 `CommandListGroup`（`font-semibold`）不匹配，属提交基线不一致（预先存在）。
- CDP 实机验证：亮/暗两套主题下聊天页、设置页、知识库页截图确认；流式增量采样见上。

## 七、第三轮细节整改（P12–P14，用户逐项反馈）

### 右侧面板颜色与内容（P12）
- **根因**：`DashboardPanel / AssistantPanel / GitPanel / PreviewPanel` 根节点用 `bg-background`（页面灰 `#e7ecf4`）——白色卡片内套灰底，观感像"空卡片框"，浪费空间。已全部改 `bg-transparent` 并去掉多余 `border-r/l`。
- 上下文"其他"页签的居中占位块（图标+双行文案）改为单行说明文字，减少垂直占用。
- 待办（TaskList）与上下文（ContextCompressionWidget）非空态本就与 cc-haha 同源同款，未改动。

### 输入框对齐（P13）
- **移除**：输入框下方"代码/计划"模式切换（ModeIndicator）、默认权限选择器（ChatPermissionSelector）；输入框内"思考开关"（thinking toggle）与"推理力度"（EffortSelectorDropdown）。
- **移入**：上下文统计指示器（ContextUsageIndicator）从输入框下方行收进 composer 底行右侧（通过 MessageInput 新增 `footerExtra` prop 注入）。聊天页与空白会话页（/chat）同步调整。
- **布局对齐 cc-haha**：左侧 = 添加文件 / 斜杠命令 / CLI 工具 / 图片生成；右侧 = 快捷脚本（▶）/ 优化提示词（✨，14px）/ 上下文统计 / 模型选择 / 发送。
- **新增快捷脚本功能**（移植 cc-haha）：`src/store/useQuickScriptStore.ts`（localStorage 持久化，预设"插件测试/版本发布"两条）+ `src/components/chat/QuickScriptMenu.tsx`（▶ 按钮 + 弹窗，支持添加/删除脚本）。执行逻辑：关闭其他右侧面板 → 打开终端面板 → 派发 `terminal:execute-command` 执行 `cd <dir> && bash <path>`（复用终端面板现成的事件通道）。

### 流式留白修复（P14）
- **排查结论**：流式 `<pre>` 与最终 Markdown 实测字体/字号/左位置/宽度完全一致（Inter 14px、同 x 同宽），字体并无差异；真正的"左右留白"来自 `use-stick-to-bottom` 给滚动容器内联的 `scrollbar-gutter: stable both-edges`（窄卡片下左右各预留 ~16px 滚动条槽），叠加 `px-6` 形成每侧 40px 空白。
- **修复**：globals.css 增加 `.chat-scroll-gutter-fix`（`!important` 覆盖为 `scrollbar-gutter: auto`，挂在 Conversation 根节点）；消息列内边距 `px-6` → `px-4`。实测正文宽度 480px → 526px（卡片 592px 宽时）。

## 八、第四轮：面板体验与通知对齐（P15–P18）

### 面板宽度 / 拖拽 / 切换动画（P15/P16）
- PanelZone 重构：按面板类型维护显式宽度（`DEFAULT_WIDTHS`：终端/控制台 400、浏览器 480、文件树 340、Git 380、看板 340、助手 360、预览 480），外层容器宽度驱动卡片，切换面板时 `transition: width 300ms cubic-bezier(0.2,0.8,0.2,1)`（cc-haha 同款缓动，实测 340→380 平滑过渡）。
- 拖拽：`ResizeHandle.tsx` 新增 `PanelResizeHandle`（移植 cc-haha AppShell 版：20px 命中区覆盖左边缘、rAF 节流、拖拽期间全局 col-resize + iframe pointer-events:none、品牌色发光竖线 hover）；面板自带的小手柄通过 `[&_.cursor-col-resize]:hidden` 隐藏。
- 修复"文件树太窄"根因：FileTree 无固有宽度、卡片此前是内容驱动宽度 → 现已由显式宽度接管。
- 关闭面板 = 宽度缩到 0（保留挂载，终端 PTY 不中断）；AppShell 聊天卡片加 `min-w-[380px]` 防止被挤没。

### 浏览器移入右侧面板（P17）
- 新增 `browserPanelOpen` 状态（usePanelStore/usePanel/AppShell 上下文贯通）；右侧面板工具栏的浏览器按钮与侧栏"内置浏览器"按钮都改为在右侧面板打开，**不再用工作区标签顶掉聊天页**。
- 修复 `BuiltinBrowser.tsx` 的 iframe/webview `src` 绑定 bug：原绑定 `initialNormalizedUrl`（props）导致输入新 URL 后不加载，改为绑定 `url` 状态。

### 提示音与 Toast（P18）
- `src/lib/notificationSound.ts`：移植 cc-haha 的三档合成音效（清脆玻璃/柔和上行/温暖木琴，WebAudio 多谐波合成），偏好存 localStorage；设置 → 外观新增"提示音"选择器（点击即试听，对齐 cc-haha 的 NotificationSoundSettings）。
- 服务端完成通知对齐 cc-haha：标题「任务已完成」+ 耗时正文（X分X秒）、`notificationType='task_complete'`（走系统通知而非 toast）、`sound=true`。
- Toast 视觉对齐 cc-haha：右上角（原右下角）、280px 卡片、品牌色图标章 + `public/icons/toast-icon.png`、右侧滑入动画、token 化配色。

## 九、侧边栏 rail 折叠（P19）

对齐 cc-haha 的侧边栏收起行为（原实现是 `if (!open) return null` 整块卸载，没有图标态）：

- `ChatListPanel` 根节点改用 `.sidebar-panel` + `data-state={open ? 'open' : 'closed'}`，由 globals.css 的 CSS 类在 **270px ↔ 72px** 间切换；`.sidebar-panel` 的 transition 补充了 `width/min-width`（原来只过渡背景色，所以之前没有动画）——实测收起过程 `270→178→122→87→78→73→72` 约 230ms 平滑过渡（`280ms cubic-bezier(0.22,1,0.36,1)`）。
- rail 态布局（对齐 cc-haha Sidebar）：顶部竖向图标列（收起/展开 + 搜索）→ 新对话/浏览器图标 → 7 个导航图标 → 占位撑开 → 底部设置图标；logo 仅展开态显示。
- 文字标签统一包一层 `.sidebar-copy--visible/--hidden`（max-width/opacity/transform 三段过渡），收起时淡出而不是消失；rail 态按钮 `px-0 gap-0` 保证图标严格居中。
- 移除 `if (!open) return null`：组件始终挂载，避免整块卸载/重挂载。
- 注意：dev server 长时间运行后可能对 SSR 模块使用陈旧缓存（表现为 hydration mismatch 报错），重启 dev server 即恢复。

## 十、会话切换/打开动画（P20）

背景：cc-haha 的内容区切换本身没有过渡（ContentRouter 为纯条件渲染），但我们的会话切换/打开是"硬切"，观感突兀。按同一套动效语言补齐：

- **会话内容入场**：`ChatView` 根节点加 `.animate-chat-enter`（globals.css：`chat-enter` keyframes，240ms `cubic-bezier(0.22,1,0.36,1)`，opacity 0→1 + translateY 6px→0）。`ChatView` 以 `sessionId` 为 key 重挂载，天然在每次打开/切换会话时重放。实测切换过程 opacity `0→0.29→0.52→0.93→1`、位移同步收敛。
- **侧边栏会话项入场**：`SessionListItem` 两个变体加 `.animate-list-item-enter`（180ms 同曲线淡入上移），新建会话、列表刷新、项目展开时轻轻浮现。
- 两者都带 `prefers-reduced-motion: reduce` 豁免。

> 排查记录：dev server 长跑时 CSS 与 SSR 模块都可能命中陈旧编译缓存（表现为新样式不生效 / hydration mismatch）。`touch` 目标文件或重启 dev server 即可恢复；刷新时用 ignoreCache 更稳妥。

## 十一、流式手感治理（P21：工具卡不再自动展开 + 消除闪烁卡顿）

用户反馈：① 命令执行的工具卡"先展开、结束后又合上"，没必要；② 会话内容刷新一闪一闪、一卡一卡。

### 工具卡不再自动展开（三处）
- `ActionToolCard`（task 卡）：原 `autoExpanded` 初始 `status==='running'` + 完成后 500ms 自动合上 → 改为纯用户点击展开（`useState(false)`）。
- `ContextSingleRow`（行级工具）：同样的自动展开/自动合上逻辑 → 移除。
- `ToolActionsGroup`：原"流式中默认展开整个工具组"的 effect → 移除。
- 实测：命令执行全程卡片恒为 32px 折叠态（33 个采样点无一展开）。

### 闪烁/卡顿根因与修复
1. **索引 key 导致整片重挂载**（主罪）：`renderSegments` 用 `action-${idx}`/`think-${idx}`/`text-${idx}` 等数组下标做 key——流式中段列表变化（context 分组合并、thinking/text 段插入）时，后续所有节点被卸载重建 → 视觉闪烁 + 子组件展开状态丢失。改为稳定 key：工具用 `action:${tool.id}`/`ctx:${tool.id}`/`ctxg:${ids}`，thinking/text 用 `think:${step.id}`/`text:${step.id}[:evtIdx]`（事件仅追加，下标稳定）。
2. **滚动用 instant 跳底**：`StickToBottom` 的 `resize="instant"` 使每次内容增长都瞬跳，观感"一卡一卡"。移植 cc-haha 的过阻尼弹簧：`resize={{mass:0.7, damping:0.86, stiffness:0.1}}` + 组件级同参数（cc-haha 注释原文即"内容增长不能 instant，否则每段重排都显得画面抖动"）。实测吸底跟随平滑且精确贴底。
3. **每帧整树重渲染击穿 memo**：`buildSnapshot` 每次 emit 都深拷贝 `toolUses/toolResults/subAgents` 数组 → 引用每帧变化 → 下游 memo 全部失效。改为元素级比较、内容未变时复用旧引用；`ToolActionsGroup` 包 `React.memo`；`StreamingMessage` 的工具映射 `useMemo` 化。纯文本流式期间工具组完全跳过重渲染。

### 遗留
- 流式结束瞬间 `StreamingMessage → MessageItem` 的组件替换仍是"硬切"（结构不同无法避免整体替换），后续如需可加交叉淡入。

## 十二、流式文字"先出现后归类"跳变治理（P22）

用户反馈：流式时文字先出现，一瞬后"归类到消息图标后面"——像渲染竞争。

### 实测定位（用标记文本 CCC/DDD 抓现场）
最终归属验证：工具调用**之前**的文字被归类进工具时间线（当时代码带 `pl-8` + 小图标，x=351），工具**之后**的文字留在正文（x=319）。机制：
1. 模型先输出进程性文字 → 前端只能先以正文形式显示（此时还不知有工具调用）；
2. 随后 `tool_use` 到达，StreamingMessage 的 `hasNewTool` 分支把已显示的这批文字"消费"进时间线（`consumeActivityContent`）——设计意图是把"工具前/工具中的说明文字"归入过程时间线（与历史消息的渲染模型一致）；
3. 旧实现的时间线文字段比正文多一级 `pl-8`+图标，于是肉眼看到文字**右移 32px 并挂上图标**。

### 修复
1. **消除水平跳变**：时间线文字段对齐正文（去掉额外 `pl-8` 与小图标，与 cc-haha 的中段文字处理一致）——实测归类前后文字都停在 x=319。
2. **软化垂直重排**：文字段加 `.animate-segment-enter`（200ms 淡入上浮），归类到新位置时读作渐显而非硬跳。
3. **顺带修复真实边界 bug**：`stream-session-manager.consumeActivityText` 原用**全文长度**记录活动区边界，而前端 `finalContentStart` 用**已揭示长度**（渐进队列会滞后）——两者不一致时，完成瞬间会把用户已看到的正文重新切走。现改为 `Math.max(activityTextLength, revealedLength)`，与前端基准对齐。

### 说明
"工具前文字归入时间线"是历史消息模型的设计约定（保证 [文字][工具][文字] 的时间顺序）；本轮修的是归类瞬间的视觉位移。若希望文字完全"原地不动"，需要调整历史渲染模型（中段文字也按正文字段存续），属于更大的改动，待用户确认是否需要。

## 十三、中段文字图标回归修正（P23）

P22 为消除归类跳动，把时间线文字段的 `pl-8` + 小图标整个移除了——矫枉过正：阶段性回复变成没有图标的"裸文字"，用户反馈"没有那个图标了/像裸回复"。

修正为 **cc-haha 的模型**（每段中段文字都渲染成一条带图标的正常助手消息）：
- 文字段结构：`-ml-8` + [20px 图标槽（蓝色 ChatCircle）] + Streamdown 正文。
- 效果实测：**图标 x=289（与消息图标列完全同列）、文字 x=319（与正文完全同列）** —— 归类跳动依旧不存在（文字位置不变），同时图标回来了、排版与正文一致（text-sm + prose）。
- `MessageContent` 增加 `group-[.is-assistant]:overflow-x-visible`，避免 `overflow-x-auto` 把 -ml-8 的图标裁掉。

### 附带澄清：界面里的英文是什么
用户反馈"阶段性回复全是英文"——排查最近 6 条助手消息的数据块：
- **text 块（阶段性回复/正文）全部是中文**；
- **thinking 块（模型内部推理）多数是英文**（"The user wants me to run…"），
  它在"思考"折叠行的行内预览里显示（`思考 | The user wants me to…`）。

即界面上的英文来自**思考预览**（模型自身推理语言），不是渲染回归，也与 cc-haha 行为一致（其 ThinkingBlock 同款预览）。如需降低噪音可考虑：合并同一轮的多条思考行，或默认隐藏思考预览。

## 十四、AskUserQuestion 提问卡片对齐（P24）

对齐对象是 cc-haha 桌面版 `desktop/src/components/chat/AskUserQuestion.tsx`（其提问卡片内联在消息流中）。CodePilot 保留"消息流下方权限卡"的位置体系，只移植卡片结构与视觉。

### 令牌
- `globals.css` 新增 `--secondary-brand`（亮 `#2D628F` / 暗 `#CDBDFF`）与 `--secondary-brand-container`（亮 `#9ACBFE` / 暗 `#3A3050`），并映射为 Tailwind 的 `--color-secondary-brand`。
- 不能直接复用 cc-haha 的 `--color-secondary`：CodePilot 的 shadcn 语义里 `--secondary` = surface-container（灰），名字冲突。

### 卡片结构（`PermissionPrompt.tsx` 的 `AskUserQuestionUI`，已导出）
- 头部：32px 图标章（`Question` 图标，`bg-secondary-brand/10`）+「Claude 需要你的输入」+ 已回答徽标。
- 问题标签页（仅多问题时）：`header || Q{n}`，已答打绿勾，活动项 2px 次级色下划线 + 横向滚动。
- 选项卡片：`px-4 py-3` 全宽卡，16px 指示器（单选圆形 / 多选 4px 圆角方形）+ 白色对勾 SVG，label `text-sm font-medium` + description `text-xs` 次级行；选中态 `border/ring + bg/8 + 次级色文字`。
- 自定义回复：label「或输入自定义回复:」+ 输入框，非空输入即清除该题已选项（对齐 cc-haha）；IME 组合期回车不触发提交；Enter 在全部作答后直接提交。
- 底部通栏：cc-haha 渐变主按钮（`--gradient-btn-primary` + `--shadow-button-primary`，`rounded-[4px]`）+ 纸飞机图标 +「提交」。
- 已回答态：整卡 `opacity-70` + 降级描边，徽标「已回答」，答案行「已回答: xxx」（提交的答案经 `PermissionPrompt` 的 `lastAnswers` 状态回显），标签页保留可回看。

### 保留的 fork 能力（与 cc-haha 桌面版的差异）
- 多选：cc-haha 桌面版只支持单选；按 cc-haha CLI 的 `SelectMulti` 约定渲染为方形复选框。
- 每题独立自定义回复（cc-haha 桌面版是全局单输入框，会覆盖所有题）。
- 要求所有问题作答后才可提交（空答案会让模型误以为访谈完成）。

### 有意保留的位置差异
- cc-haha 提问卡片内联在消息流中、提交后长期驻留；CodePilot 仍是权限卡体系（提交 1s 后随 pendingPermission 清除），历史消息里的工具行仍走通用工具行渲染——如需历史中驻留"已回答卡"需改时间线渲染模型，待确认。

### 验证
- `npm run test`：1250 用例中 1245 通过 / 4 跳过 / 1 失败；唯一失败是 `task-executor-v2.test.ts` 的「can execute a text-only task」，它依赖真实 provider，当前环境配置的模型名被端点拒绝（400），与本轮改动无关。
- Playwright（CDP）实机截图：亮色未答/选中态、暗色未答/已回答态、多选方形勾选框、自定义回复互斥、提交后已回答文案；暗色实测 `--secondary-brand = #CDBDFF`、提交按钮渐变 `linear-gradient(135deg,#0A56D0,#0842A0)`、圆角 4px。
- 临时预览页 `src/app/askq-preview` 已在验证后删除。

## 十五、侧边栏运行态指示器对齐（P25）

对齐对象是 cc-haha 桌面版 `desktop/src/components/layout/Sidebar.tsx`：会话行右侧的转圈 loading，以及项目文件夹收起时的闪烁绿灯。

### 会话行转圈（`SessionListItem.tsx`）
- 任务运行中时，右侧固定宽度槽位（`w-[38px]`）由时间戳切换为 14px 圆环：`rounded-full border-[1.5px]` + 底/左/右三边 `border-muted-foreground/35`、顶边与右边 `border-muted-foreground`，形成 180° 弧；动画 `animate-[spin_1.35s_linear_infinite]`。
- cc-haha 原版用硬编码十六进制（`rgba(168,176,188,0.38)` / `#767E8C`，暗色另一组），此处改为映射 CodePilot 语义令牌 `muted-foreground`，以便随主题自动切换，无需维护两套色值。
- **移除了原先行左侧的绿色 `animate-ping` 圆点**：cc-haha 的运行态只在右侧一个位置表达，左位留白以免同一状态出现两个指示器。左侧保留待批准铃铛（`needsApproval && !isSessionStreaming`）。
- 与时间戳一样，转圈在悬停（`showActions`）时淡出，让位给右上角的 ⋯ 菜单按钮——这是 CodePilot 的既有槽位复用约定，cc-haha 无此冲突（其操作按钮不在同一槽位）。

### 文件夹收起时的闪烁绿灯（`ProjectGroupHeader.tsx`）
- 新增 `CollapsedProjectActivityIndicator`：外层 `animate-pulse-dot` 呼吸光晕（`bg-status-success/40`）+ 内层实心点（`bg-status-success` + `shadow-[0_0_5px_var(--status-success)]`），尺寸 6px。
- 渲染条件为 `isCollapsed && hasRunningSession`，插在名称与操作按钮之间（`mr-0.5`），普通项目分支与 workspace（伙伴）分支都覆盖。
- 与 cc-haha 一致：**仅折叠时显示**。展开状态下用户能直接看到行内转圈，再挂一个绿灯是冗余。
- 动画复用 globals.css 现有的 `.animate-pulse-dot`（1.5s ease-in-out，opacity 1↔0.3）；cc-haha 用的是 Tailwind 内置 `animate-pulse`，此处沿用项目既有 keyframes 以保持折叠动效节奏统一。

### 状态判定（`ChatListPanel.tsx`）
- 抽出模块级 `isSessionRunning(session, activeStreamingSessions, streamingSessionId)`，命中 `activeStreamingSessions.has(id)` / `streamingSessionId === id` / `runtime_status === 'running'` 任一即为运行中。
- 会话行转圈与文件夹绿灯**共用同一判定**，避免两处指示器不一致（例如绿灯亮着但收起的行内没有转圈）。
- 绿灯按分组聚合：`group.sessions.some(isSessionRunning)`，即组内任一会话在跑即点亮。

### 未移植的部分
- cc-haha 的蓝色「刚刚完成」圆点（`showCompletedIndicator`，`bg-[#4A90E2]`）**未移植**——本次需求只提了转圈与绿灯，且 CodePilot 缺少对应的"完成时点"状态源（cc-haha 由本地 state 记录 `completedAt` 并在若干秒后自动清除）。
- `SessionListItem.tsx` 内的 `SplitGroupSection`（分屏会话组）仍保留原左侧 `animate-ping` 绿点。它不在 cc-haha 侧边栏的对应物里，属于 CodePilot 的分屏定制 UI，未纳入本轮对齐范围。

### i18n
- 新增 `chatList.projectRunning`（zh「该项目有任务运行中」/ en「A task is running in this project」）用于绿灯 tooltip/`aria-label`。
- 转圈复用既有 `session.running`（zh「运行中」/ en「Running」）作为 tooltip/`aria-label`。

### 验证
- `npx tsc --noEmit` 退出码 0。
- `npm run test:unit`：1194 用例中 1189 通过 / 4 跳过 / 1 失败；唯一失败为 `task-executor-v2.test.ts` 的「can execute a text-only task」，依赖真实 provider，当前环境模型名被端点拒绝（400），与本轮改动无关。
- Playwright（CDP）实测（借助临时 URL 开关 `__debugRunning=1` 强制运行态，验证后已移除，`grep` 确认无残留）：10 个转圈元素计算样式为 `animationName: spin` / `animationDuration: 1.35s`；6 个绿灯为 `pulse-dot 1.5s infinite`；亮/暗两色截图确认折叠行 `hueying-allcode`、`No Project`、`Ps-plugins`、`cc-haha`、`Hueying_Desk_imgedit` 均有绿灯，而已展开的 `CodePilot` 行为 `hasDot: false`。
- 真实点击展开 `cc-haha` 后复查：该行绿灯消失、其余折叠目录保持点亮，确认条件随折叠状态正确切换。

## 十六、消息流「丝滑感」治理（P26）

用户反馈："还是不丝滑，消息渲染的时候很硬，刷一下就出来了，看着是很快，但感觉不丝滑。"

经实测定位到**三个独立机制**，不是同一个问题的三种说法，逐个修复：

### 根因一：收尾瞬间「裸文本 → 排版内容」的整块变形（实测）
流式期间正文是单个 `<pre class="streaming-plain-text">`（原始 Markdown 源码），结束后换成 Streamdown 渲染的 Markdown。实测同一段文本的两种形态：

| | 流式中 | 流结束后 |
|---|---|---|
| 段间距 | 空行 = 22.75px | `space-y-4` = 16px |
| 内容形态 | `**粗体**` / `# ` / `- ` / ` ``` ` 原样可见 | 渲染后的标题/列表/代码块 |

含代码块的真实消息里，实测相邻段落间距从 **16px 变成 246px** —— 代码围栏从几行等宽文本变成带标题栏、行号、复制按钮的 CodeBlock，几何形状完全不同。这是"刷一下就出来了"最直接的来源（本项目回复基本都带代码块，所以几乎每条都中招）。

**修复**：新增 `src/lib/streaming-text-split.ts` 的 `splitStablePrefix()`，把流式文本切成：
- **定型前缀** —— 最后一个空行为界，且保证 ``` 围栏成对闭合（否则回退到最后一个未闭合围栏之前）。这部分不会再被后续增量改写，直接交给 `MessageResponse` 按最终 Markdown 渲染。
- **尾段** —— 仍在增长的那一小段，继续用 `<pre>` 纯文本兜底。

`MessageResponse` 本身就是 `memo` 的，前缀不变时不会重解析，所以重解析次数从"每个 delta 一次"降到"每写完一段一次"，长文本下依旧不卡（这正是 P21 当初改用纯文本要规避的开销）。

实测同一段含代码块的文本：收尾时的**位移量从 46px 降到 20px**，且代码块在流式期间就已是最终形态，不再有"源码变排版"的形变。剩余 20px 来自最后一段（仍在尾段里）转为 Markdown，由下一条的入场淡入覆盖。

### 根因二：渐进揭示队列的积压被一次性倒出
`stream-session-manager.ts` 的渐进揭示原先固定 **6 字符 / 12ms（=500 字符/秒）**，触发阈值 240 字符。模型突发大块输出时揭示速度追不上生产速度，积压一路涨到收尾，然后被 `flushTextThrottle() → flushReveal()` **在同一帧里整段倒出来** —— 这正是"看着是很快"却"不丝滑"。

（cc-haha 用 `deferredCompletions` 等队列排空后再落完成态，CodePilot 移植时丢了这个环节。）

**修复**（两处）：
1. **自适应步长**：每帧揭示 `max(6, ceil(积压 / 10))` 字符 —— 积压按约 10 帧（≈120ms）衰减，即 ~400ms 内消化绝大部分。稳态（积压很小）时退回最小步长 6，保留打字感；突发时平滑追赶而不是憋到最后一起放。
2. **收尾前等队列排空**：完成分支加 `await drainReveal()`（安全阀 1s）。最终消息是一次性全量渲染的，若此时还有未揭示的文字，它们会和组件替换挤在同一帧里闪出。

### 根因三：消息没有入场动画（已确认缺失）
侧栏有 `list-item-enter`、会话切换有 `chat-enter`、时间线文字段有 `segment-enter`，**唯独消息本体没有** —— 新气泡是"啪"地贴上去的。

**修复**：`globals.css` 新增 `@keyframes message-enter`（260ms 淡入 + 6px 上浮，`prefers-reduced-motion` 下关闭）；`MessageList.tsx` 判定「本次新出现」的消息加 `animate-message-enter`：
- 基线取首次渲染时的 id 快照，**首屏既有消息与向上加载的历史都不重放**（否则每次切会话/翻页整屏闪一遍）；
- 判定结果写入 `newIdsRef` 后不再摘除 —— 避免类名在动画进行到一半被下一次渲染移除而中断动画；
- 副作用：流式结束替换成最终消息时，最终消息是一次全新挂载，因此**交接处天然获得一次淡入**，正好覆盖根因一剩下的那点残余位移。

### 一个被实测抓到的级联 bug
`.streaming-plain-text` 原本带 `margin: 0`，与 `.streaming-blocks > * + * { margin-top: 1rem }` **同优先级且定义在后** → 把段间距吃成 0px，尾段会紧贴上一段。已移除该 `margin`（Tailwind preflight 已归零），实测间距恢复为 16px，与最终排版一致。

### 验证
- `npx tsc --noEmit` 退出码 0。
- `npm run test:unit`：1203 用例中 1198 通过 / 4 跳过 / 1 失败；唯一失败仍是 `task-executor-v2.test.ts` 依赖真实 provider 那条（环境模型名被端点拒绝 400），与本轮无关。
- 新增 `src/__tests__/unit/streaming-text-split.test.ts`（9 例）覆盖：无空行、段落边界切分、拼回原文自洽、闭合/未闭合围栏回退、`~~~` 围栏、纯空白前缀，以及**逐字符增量追加时前缀始终是原文的一个切分**（这条在实现中抓到了「回退后残留尾随空行」的真实 bug）。
- CDP 实测：新消息节点带 `animate-message-enter`，计算样式 `animationName: message-enter` / `0.26s` / `cubic-bezier(0.22,1,0.36,1)`；`.streaming-blocks` 的段间距计算值 16px。

### 未验证 / 遗留
- **没能跑通一次真实流式回合来端到端验证**：本环境的 provider 模型名被端点拒绝（`The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed Qwen3.6-35B-A3B-8bit`），新开会话发消息后助手始终无回复。因此根因二的「自适应步长 + 收尾等待」只做了代码层推演与类型/单测验证，**未做真机帧级观测**，provider 修好后建议复测一次。
- 收尾时最后一段（尾段）由纯文本转 Markdown 仍有约 20px 位移，靠入场淡入覆盖；若要做到零位移需把尾段也交给 Markdown 渲染，但那会退回到"每帧重解析一整段"的开销，暂不采纳。

## 十七、面板切换按钮「重复渲染」修复（P27）

### 现象
点击「浏览器」后，对话区顶栏（`UnifiedTopBar`）**同时**渲染出一排 5 个面板切换图标，与右侧面板卡片头部的按钮完全重复。

### 根因
`UnifiedTopBar.tsx` 用 `rightPanelOpen` 决定「顶栏按钮是否让位给面板卡片头」，而这个布尔值的判定串漏掉了 `browserPanelOpen`：

```ts
// 修复前：漏了 browserPanelOpen
const rightPanelOpen = gitPanelOpen || fileTreeOpen || dashboardPanelOpen
  || bottomPanelOpen || assistantPanelOpen || (previewOpen && !!previewFile);
```

浏览器面板打开时该值仍为 `false` → 顶栏不让位；而 `PanelZone` 的 `anyOpen`（**包含** `browserPanelOpen`）已为 `true` → 面板卡片头也渲染了一份。两处各有一份手写的 `||` 列表，**漂移一次就出现两排按钮**。CDP 实测：点击后 `button[data-active]` 由 5 个变成 10 个（顶栏 x≈913–1057，面板头 x≈1264–1408）。

### 修复
抽出唯一判定 `src/lib/panel-visibility.ts` 的 `isRightPanelOpen(flags)`，由 `UnifiedTopBar` 与 `PanelZone` 共用。参数是 Required 形状，任何一方漏传标志都会在**编译期**报错，而不是变成一次静默的 UI 重复。

### 验证（Playwright MCP，`localhost:3000`）
逐个点击 终端 / Git / 文件树 / 看板 / 浏览器：每一次**可见**的 `button[data-active]` 恒为 5 个，且全部位于 `.panel-card` 内、顶栏 0 个；全部关闭后可见数仍为 5，且全部回到顶栏。

面板关闭时 `.panel-card` 仍挂载（保活 PTY 与日志状态），其内部按钮为 `visibility: hidden`，不计入无障碍树，因此不构成可见重复。

`npm run test`：1203 用例 / 1199 通过 / 0 失败 / 4 跳过（typecheck 通过）。P26 记录中因 provider 模型名被拒而失败的那条用例，本轮通过。

### 两个环境坑（非代码问题）
1. **`PORT=47823` 注入**：本会话的 Bash 环境带有宿主 CodePilot 应用自身的 `PORT=47823`。在本目录启动 dev server 必须显式 `PORT=3000 npm run dev`，否则会与已安装的 `CodePilot.app`（监听 `127.0.0.1:47823`）抢同一端口。
2. **旧 dev server 文件监听失效**：修复过程中旧 dev server 的 watcher 停止响应（`.next/dev` 产物时间戳停在改动之前，改文件不触发重编译），页面报 500 `isRightPanelOpen is not defined`。重启 dev server 后恢复 —— 若再遇到「改动不生效且产物时间戳不动」，先重启 dev server 再怀疑代码。

## 十八、时间线行对齐修复（P28）

对应 P27 遗留风险中「ToolActionsGroup / 工具时间线卡片未做深度视觉重排」一条，本轮完成。

### 现象（用户反馈）
思考行、工具调用行混排时**文字列不在同一竖线上**，部分行还多出一个「向右的展开箭头」夹在图标与文字之间；终端（Bash）图标形状也不对；带容器（卡片）的行右边缘与普通行对不齐。

### 根因
同一份修改前的 DOM 实测（Playwright MCP，`localhost:3000`，会话 `a0c8be5c…`）：

| 行类型 | 文字起点 x | 右边缘 x |
| --- | --- | --- |
| 思考行（`ThinkingRow`） | **476** | 1240 |
| 搜索行（`ContextSingleRow`） | **508**（右移 32px） | 1240 |
| 分段文字段（`-ml-8`） | 476 | **1208**（左缩 32px） |

- `ContextSingleRow` / `ContextGroup` 在**图标与文字之间**放了一个左侧展开箭头；不可展开时还渲染 `<span className="w-3" />` 占位。叠加 `px-2`(8px) + `gap-2`(8px) + 工具名 `ml-1`(4px)，文字被推右 32px —— 而 `ThinkingRow` 没有这一层结构，于是两列文字错位。
- 中段文字段用 `-ml-8` 破坏左侧 `pl-8`，把右边缘一并带走了 32px。
- Bash 图标用的是 Phosphor `TerminalWindow`（窗口样式），cc-haha 用的是 `Terminal`（`>_` 样式）。

### 修复（单文件：`src/components/ai-elements/tool-actions-group.tsx`）
对齐基准取自 cc-haha 的 `ThinkingBlock.tsx` 与 `ToolCallBlock.tsx`（普通工具行：外层 `pl-8`、按钮无 padding、右侧 `[状态图标] [ChevronDown]`）。

1. `ContextSingleRow` / `ContextGroup`：删除图标与文字之间的箭头块（含 `w-3` 占位），展开箭头改挂到右侧状态区末尾；行容器内边距改为条件式 —— 时间线内 `pr-2`（左侧零内边距，文字直接落在 `pl-8` 边界），卡片内仍保留 `px-2`。
2. 工具名 span：去掉 `ml-1`，字号 11px → 12px（与 cc-haha `text-[12px] font-medium` 一致）。
3. 中段文字段：`w-[calc(100%+2rem)]` 补偿 `-ml-8` 造成的左移，右边缘回到与其他行同一条线。
4. 图标：`TerminalWindow` → `Terminal`（3 处引用），颜色改语义令牌 `text-[var(--timeline-bash)]`。

### 验证
- 修复后实测：所有行文字起点统一 **476**、右边缘统一 **1240**；箭头统一在右侧（`chevronX ≈ 1174–1189`）；Bash 卡片 x=444 宽 796（444..1240）与其他行右对齐；展开态内容容器 476..1240。
- 暗色：`document.documentElement.setAttribute('data-theme','dark')` 下复测，对齐结论一致；确认 `--timeline-bash` 亮/暗同值（#059669），暗色可读。（注意：`[data-theme="dark"]` 块并未覆盖 `--timeline-*` 令牌，当前依赖亮色定义继承。）
- `npm run test`：1203 用例 / 1199 通过 / 0 失败 / 4 跳过（typecheck 通过）。

### 刻意保留的差异
Bash 卡片**内**的图标中心（≈462）仍比时间线图标中心（≈454）偏右约 8px —— 核对 cc-haha 源码，其卡片内同样是 `pl-2.5` + 20px 图标槽，存在同样的偏移，属其固有行为，未强行对齐。

## 十九、任务收尾的「遮挡 / 刷新」（P29）

对应 P26 根因三（入场动画）引入后暴露出的两个副作用，本轮修复。

### 现象（用户反馈 + 截图）
> "有的时候，任务快结束了，这个界面会互相遮挡，很难受。任务全部完成的时候，界面还会刷新一下，这是为什么，重新写入了什么东西吗？"

截图是对话区底部一小条（1470×158）：同一段文字出现**两层错位重影**，字面发虚。

### 根因一：位移入场动画在亚像素位置重采样（遮挡 / 发虚）
P26 的 `message-enter` 是 `opacity 0→1` **+ `translateY(6px)→0`**。位移插值过程中文字会停留在小数像素上（如 `translateY(2.37px)`），浏览器对文本层做重采样 → 笔画发虚；当这段动画与滚动/内容替换同时发生时，两帧的字形在视网膜上叠加，就是截图里的"双层文字互相遮挡"。

**修复**：`globals.css` 的 `message-enter` **去掉 `translateY`**，只保留透明度过渡（200ms，曲线不变）。实测计算样式 `transform: none`，keyframes 中只剩 `opacity`。文字类入场本就不需要位移，纯淡入观感更干净且没有重采样代价。

> 同类动画 `chat-enter`(6px) / `segment-enter`(3px) / `card-enter`(5px) / `list-item-enter`(4px) **本轮未改动** —— 证据（DOM 重挂载记录 + 截图像素放大）都指向消息级动画；它们作用的是卡片/侧栏项等非主体文本块，位移量小、触发时机与滚动不同步。若后续再见到类似重影，可按同一手法逐个摘掉。

### 根因二：消息节点被"真实数据"反复替换，动画跟着重放（"刷新一下"）
用户问的"重新写入了什么东西"——**是的，写入了**。一轮对话里同一条消息的 DOM 节点会**重挂载三次**，每次 id 都换：

| 时刻 | id 来源 | 旧实现的行为 |
|---|---|---|
| 发送瞬间 | `temp-<ts>`（乐观插入） | — |
| +26ms | DB 真实 id | `key` 变化 → 整棵子树销毁重建 + **重放入场动画** |
| 流式结束 | `temp-assistant-<ts>-<rand>` | 新节点 → 重放动画 |
| +10s | DB 真实 id（`MESSAGE_RECONCILE_INTERVAL_MS` 轮询） | `key` 变化 → 再次重建 + 重放动画 |

内容一个字没变，但 `key={message.id}` 每次都变，React 只能卸载再挂载。叠加 P26 的入场动画后，这个替换过程被放大成肉眼可见的"刷新一下"。P26 记录里写的"交接处天然获得一次淡入正好覆盖残余位移"，在实测中其实是**每次替换都闪一次**。

**修复**（`src/components/chat/MessageList.tsx`，两个配套改动）：

1. **稳定 key 改用内容指纹**：新增 `messageFingerprint()`（`${role}:${前 80 个非空白字符}`）作为 `key`，同内容的重挂载变成同 key 的更新，节点不再销毁重建。指纹重复时（例如连发两条一模一样的消息）追加 `#n` 序号避免 key 冲突。
2. **入场判定改为"只有用户消息播一次"**：抽出 `MessageRow` 组件，用 `useState` 惰性初始化器在**挂载那一刻**求值一次（重渲染不打断进行中的动画）；只有 `role === 'user'` 且指纹不在 `seen` 集合中才加 `animate-message-enter`。助手消息一律不播 —— 它是流式逐渐长出来的、本身就有渐进过程，再叠一次整块淡入就是用户说的"刷新一下"。

`seen` 基线取首屏已有消息的指纹集合，因此**向上翻历史、切会话恢复出来的消息都不会重放**。

### 实测数据（MutationObserver 实机取证）
在真实页面挂 MutationObserver 记录节点增删与 className：

| 时刻 | 修复前 | 修复后 |
|---|---|---|
| 用户消息 temp → DB id | remove + add（重挂载 + 重播动画） | **无事件**（节点保留） |
| 流式容器 → 助手消息 | 新节点 `enter=true` | 新节点 `enter=false` |
| +10s 助手消息 → DB id | remove + add（重挂载 + 重播动画） | **无事件**（elapsed=14342ms 复查确认） |

### 验证
- `npm run test`：1203 用例 / 1199 通过 / 0 失败 / 4 跳过（typecheck 通过）。
- CDP 实测：`.animate-message-enter` 计算样式 `animationName: message-enter`、`transform: none`；keyframes 只剩 opacity。
- 调试残留 grep（`__DEBUG_MSG_ENTER__` / `__obs` / `__fpLog` / `__geo`）确认无残留；验证用截图与临时会话已删除。

### 说明 / 遗留
- 指纹取前 80 个非空白字符：**流式内容与落地后的正式消息前缀一致**（P26 的 `splitStablePrefix` 保证定型前缀不被改写），因此流结束那次替换也会被认作"已见过"。这也是**没有**改回"解析助手消息 JSON block 数组"的原因 —— 那种前缀匹配很脆弱（流式期是纯文本、落地后是 `[{"type":"thinking",...}]` 结构，必然不匹配），改为角色级判定后整个问题消失。
- 极端情况：两条消息前 80 个非空白字符完全相同且角色相同，会被视为同一指纹。此时靠 `#n` 序号保证 key 不冲突，动画判定上第二条不会再播一次淡入。影响仅为一次动画，无功能风险。

## 二十、聊天里的 Markdown 标题过大（P30）

### 现象（用户反馈）
> "最后输出结论的时候，结论的标题字体为什么那么大？好难受啊"

助手回复里的 `##` 标题在聊天区显示为 24px，而正文只有 14px。

### 根因：压平规则写在了错的 layer 里，一直静默失效
Streamdown 渲染标题时会挂 Tailwind 类：

| 标签 | Streamdown 挂的类 | 字号 |
| --- | --- | --- |
| `h1` | `mt-6 mb-2 font-semibold text-3xl` | 30px |
| `h2` | `mt-6 mb-2 font-semibold text-2xl` | 24px |
| `h3` | `mt-6 mb-2 font-semibold text-xl` | 20px |
| `h4` / `h5` / `h6` | `… text-lg` / `text-base` / `text-sm` | 18 / 16 / 14px |

项目早就写了压平规则（`.prose h1 { font-size: 1.125em }`、`.prose h2/h3 { font-size: 1em }` …），但它躺在 `@layer base` 块里。**层叠规则是「先比 layer 顺序、再比特异性」** —— `text-2xl` 在 `utilities` 层，而 `@import "tailwindcss"` 声明的是 `@layer theme, base, components, utilities`，utilities 在后、优先级更高。所以无论 `.prose h2`（0,1,1）的特异性比 `.text-2xl`（0,1,0）高多少，**都盖不过**，规则从未生效。

这是一次典型的「写了但没人知道没生效」：被覆盖的是 `font-size`、`margin-top/bottom`、`font-weight` 三项，肉眼只能看出"标题莫名其妙很大"。

### 修复
把整组标题规则从 `@layer base` 搬到文件末尾的 `@layer utilities` 块（`src/app/globals.css`）。同层之后再比特异性，`.prose h2` (0,1,1) > `.text-2xl` (0,1,0) 稳定胜出。原位置留了一行指向注释，避免以后有人"顺手移回去"。

压平后的层级仍可读：`h1` 1.125em + 700 字重 + 下边框，`h2` 1em + 600 字重，`h3`~`h6` 1em + 灰字色 —— 靠字重/字色/分隔线区分层级，而不是靠字号。

### 验证（Playwright，真实浏览器 + 编译后 CSS）
- **真实消息**：打开会话 `a0c8be5c…`（47 个 `.prose` 容器），14 个 `h2` 的运行时类确为 `mt-6 mb-2 font-semibold text-2xl`，计算字号 **14px**（= 正文），`font-weight 600`、margin `17.5px/7px`；3 个 `h3` 同为 14px；正文段落 14px。
- **对照实验**（同一 DOM 结构但去掉 `.prose` 父级，等价于修复前）：`h1` 30px / `h2` **24px** / `h3` 20px，margin `24px/8px` —— 精确复现了用户看到的现象，也证明这些 `text-*` 类确实被 Tailwind 生成了（源码中 `text-2xl` 有 4 处引用、`text-3xl` 2 处、`text-xl` 13 处，类名不会因未使用而被裁掉）。
- 视觉复核：截图确认消息内标题与正文浑然一体，不再有突兀的巨型标题。

### 说明
- 同类规则（`.prose p` / `.prose ul` / `.prose li` 的 margin）**仍在 base 层**。Streamdown 没有给这些元素挂 margin 类（只有容器上的 `space-y-4`），所以它们目前是生效的，本轮未动；若将来发现段落间距异常，按同一手法先查 layer。

## 二十一、风险与后续

- 工具时间线卡片的对齐已完成（P28）；卡片内部（Bash/Edit 的代码块、diff 视图）未做深度视觉重排（走令牌自动适配），如需完全对齐 cc-haha 需单独排期。
- 侧边栏折叠仍为隐藏式（cc-haha 是 72px rail 模式），`sidebar-shell/sidebar-panel` 工具类已在 globals.css 备好，可低成本跟进。
- 流式期间正文为纯文本（不解析 Markdown），这是 cc-haha 的取舍，换取长文本不掉帧。
- 面板内嵌的自身宽度调节手柄在固定卡宽场景下表现为无效（终端 400 / 其余沿用面板默认值），后续如需可改为卡片级拖拽调宽（cc-haha 的 ResizeHandle 模式）。
- 右侧面板内容（待办/上下文/任务进度等各 section 的标题行、进度条、tabs 样式）本轮未逐个精修，如与 cc-haha 观感仍有差距可继续对齐。
