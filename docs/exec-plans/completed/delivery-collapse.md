# 交付折叠 — 任务彻底完成后收起思考与工具调用过程

> 创建时间：2026-10-07
> 最后更新：2026-10-07

> 技术交接见 [docs/handover/delivery-collapse.md](../handover/delivery-collapse.md) ｜ 产品思考见 [docs/insights/delivery-collapse.md](../insights/delivery-collapse.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研改造点（渲染树、交付信号、动画基础设施） | ✅ 已完成 | 见「调研结论」 |
| Phase 1 | `ToolActionsGroup` 增加受控折叠模式 | ✅ 已完成 | 见「实现要点」 |
| Phase 2 | `StreamingMessage` 接入交付信号 `isSummarizing` | ⚠️ **已废弃** | 触发时机错误，见「返工记录」 |
| Phase 3 | `MessageItem` 历史消息默认收起 + 交棒继承 | ⚠️ **部分废弃** | 交棒继承整体删除，「已完成即收起」保留 |
| Phase 4 | 设置项开关（AppearanceSection + localStorage） | ✅ 已完成 | |
| Phase 5 | CDP 验证动画与流式→正式消息的切换，跑自检 | ✅ 已完成 | 见「验证证据」 |
| Phase 6 | 补 `docs/handover/` + `docs/insights/` 文档 | ✅ 已完成 | |
| **Phase 7** | **返工：触发时机改为「任务彻底完成后才折叠」** | ✅ 已完成 | 见「返工记录」 |

## 用户需求

> "能不能对话流里，任务即将交付的时候，干脆把思考和调用过程，也收起来，有很完美的整体过渡动画，最后交付给用户的就是结论，然后过程用户可以点收起来的地方查看？"

补充约束（用户明确强调）：**折叠动画和最后结论输出的动画要丝滑顺畅。**

**用户后续修正（Phase 7 的依据）：**

> "完全就是一坨屎一样的垃圾，任务从一开始所有的消息就被折叠了，折叠区在显示步骤，这和我想要的完全不是一回事。**算了，最后都完成了再折叠吧**，你这做的完全不能用"

## ⚠️ 返工记录（Phase 7，2026-10-07 二次交付）

### 问题

第一版把触发点定在 `isSummarizing`（"第一个结论字出现"）。上线后用户实测到的现象是：**整轮任务从头到尾都是折叠态，折叠区里在显示步骤**。

### 根因

```ts
const allToolsCompleted = hasTools && timelineTools.every(t => 已有结果);
const isSummarizing = isStreaming && allToolsCompleted && cleanContent.length > 0;
```

`isSummarizing` 的真实语义是「**此刻没有工具正在跑**」，而不是「任务即将交付」。多步任务里每两个步骤之间都成立 → 任务刚开头 `delivered` 就翻 true → 收起。再叠上"收起边沿只认一次、翻回 false 并不重新展开"的实现（`else if (!delivered) { deliveredRef.current = false; }` 只重置 ref），**一旦中途收起就永久停在折叠态**。

### 修正后的设计

| 阶段 | 过程块形态 | 由谁决定 |
|------|-----------|---------|
| 任务进行中（流式中） | **全程铺开**，每步可见 | `StreamingMessage` 走 `flat`，**不传 `processCollapse`** |
| 任务结束、消息落定 | 收成一条汇总条 | `MessageItem` 的 `delivered = displayText 非空` |

配套简化（删掉的都是"为错误时机服务的复杂度"）：

- `ToolActionsGroup`：删掉 `deliveredRef` / `pendingCollapse` / 两段式 effect / `userToggledRef` / `collapseContentRef` / 按高度折算的 `collapseDuration` / `defaultExpanded` / `onUserToggle`。收起态改为**挂载即定型**：`useState(() => !delivered)`。
- `StreamingMessage`：删掉 `processCollapse` 与 `onProcessUserToggle`，恢复 `flat`（无头行、过程直接铺开）与 `isSummarizing` 过渡提示。
- `MessageList`：删掉 `processToggledDuringStreamRef`、两个清零 effect、`lastAssistantIdx`、`initialProcessExpanded` 透传、`onProcessUserToggle` 回调。
- 连带消失的旧代价：**流式期间不再多一条汇总头行**（原因见下文"手风琴必须从流式一开始就在"，该约束已不成立）。

### 验证证据（CDP，真实对话流）

装 150ms 采样器记录 `main.innerText` 尾部 + 汇总条文案 + 消息行数：

| 场景 | 观察结果 |
|------|---------|
| 8 步连续读文件任务（0s → 13.0s） | 全程 `汇总条=无`；每一步的文件路径与中间说明均可见；头行是「✦ 生成中 \| Ns」 |
| +5.3s | 「任务已完成，开始总结」过渡提示正常出现 |
| +13.0s | 行数 53 → 54（消息落定）；随后出现汇总条 `8个已完成 · 思考与执行完毕`，过程内容不可见（`hasContentSibling=false`，箭头未翻转） |
| 手动点开汇总条 | 120ms 高度 519px → 820ms 743px（渐变展开）、箭头翻转；再点收起回到 0 |
| 硬刷新整个会话 | 15 条带工具的历史消息里 13 条收起；2 条保持展开 —— 那两条的结论在库里存成 `thinking` block，解析不到 text block ⇒ `delivered=false`（符合"没结论就别藏过程"的预期） |
| 设置开关关闭后刷新 | 折叠条 **0** 条，过程全部铺开（向后兼容） |

**自检：** `npx tsc --noEmit` 无错误；`npm run test` 1206 项 / 1202 通过 / 0 失败；`PLAYWRIGHT_BASE_URL=http://localhost:47823 npm run test:smoke` 5 通过 / 1 失败（失败项 `mention-picker-style.spec.ts` 为既有断言过时，隔离实验证明与本次改动无关）。


## 调研结论

### 1. 折叠容器已经存在，只是没被走到

`src/components/ai-elements/tool-actions-group.tsx` 内已经有完整的 Trae 风格手风琴：折叠态头部、`AnimatePresence` + `motion.div` 的 `height: 0 ↔ auto` 动画、`expanded` 状态。

但两个调用点都传了 `flat={true}`，命中短路分支 —— 直接铺开所有段落，**没有头部、没有折叠、没有动画**。

### 2. 「正在交付」的信号已经存在

`src/components/chat/StreamingMessage.tsx`：

```ts
const isSummarizing = isStreaming && allToolsCompleted && cleanContent.length > 0;
```

语义 = 有工具跑过 + 工具全部返回 + 最终结论文字已开始流出。原仅用于在结论前插一条「任务已完成，开始总结」淡入提示。

### 3. 结构性约束

- 中段文字（正文与工具调用交替时的中间段落）渲染在 `ToolActionsGroup` 内部，收起时会被一起收进去 —— 符合"只交付结论"的初衷，已与用户确认接受。
- 流式结束瞬间 `StreamingMessage` 卸载、`MessageItem` 接管同一内容。**两端折叠状态必须一致，否则会看到"啪"地弹开。**
- 最终结论在 `MessageItem` 里是 `displayText`（无后续工具调用的文本块）。

## 技术方案

> ⚠️ **本节的判定规则、手动记忆、动画折算均属第一版设计，已被 Phase 7 返工取代。**
> 当前实现见 [handover/delivery-collapse.md](../handover/delivery-collapse.md)。
> 保留本节是因为其中「motion exit 语义坑」「交棒两端状态必须一致」等结论仍然有效。

### 判定规则（两端使用互相自洽的谓词）

| 场景 | StreamingMessage | MessageItem |
|------|------------------|-------------|
| 有工具 + 已出结论 | `isSummarizing === true` → 收起 | `hasProcess && displayText 非空` → 收起 |
| 被中断、无结论 | `false` → 保持展开 | `displayText 为空` → 保持展开 |

正常路径下两者同刻为"收起"，切换无缝；中断路径下两者同为"展开"，不会出现突兀收起。

### ⚠️ 关键设计：手风琴必须从流式一开始就在

最初想当然的做法是「平时 `flat=true` 铺开、交付那一刻才切到手风琴模式」。**这是错的**：模式切换会让整棵子树重挂载，新挂载的组件只能直接以 `height: auto` 出现，拿不到 `0 → auto` 的过渡，交付瞬间会硬切。

因此实现改为：**只要开关打开，`flat` 就一直为 `false`**（`flat={!processCollapseEnabled}`），手风琴结构从流式第一帧就存在。代价是流式期间多了一条过程汇总头行 —— 这个副作用已向用户说明。

### 交棒不弹开的三道保障

1. 两端 `useState(() => defaultExpanded ?? !delivered)` 初值自洽 —— 交付态默认收起，未交付态默认展开。
2. `MessageList` 透传 `initialProcessExpanded`，把用户在本轮流式期间的手动开合结果交给接管消息。
3. 该继承值只对**本轮的最后一条 assistant 消息**生效（`lastAssistantIdx`），历史消息不带。

### 手动展开记忆：单轮级

用户在**当前这一轮**手动展开过过程 → 本轮交棒后的正式消息保持展开。
**下一轮对话仍照常自动收起。**

实现：`MessageList` 内 `processToggledDuringStreamRef`（`useRef`，非持久化）。清零时机有两个坑：

- ⚠️ **只在 `isStreaming` 变 `true` 时清零，不能在变 `false` 时清**。"流式结束"与"正式消息进入 `messages`"不一定在同一次渲染落定，在 `isStreaming → false` 时清会在交棒前一刻抹掉展开状态。
- 切换 `sessionId` 时也清零。

### 动画（用户重点要求）

1. **入场**沿用项目统一曲线 `cubic-bezier(0.22, 1, 0.36, 1)`（强 ease-out），时长 400ms。
2. **收起用另一条曲线** `cubic-bezier(0.4, 0, 0.2, 1)`（先加速后减速）。不沿用入场曲线的原因：强 ease-out 的位移集中在最开始，收一个上千像素高的过程块会像被"抽走"一样糊成一片。
3. **收起时长按内容高度折算**：`min(0.72, 0.3 + height / 5200)`。6 个工具 ≈ 334ms，40 个工具 ≈ 627ms，避免小内容拖沓、大内容仓促。
4. 高度动画的同时叠加透明度过渡，避免文字压缩变形时出现重影。
5. 折叠不改变消息列宽，只改高度，保证下方结论是「向上滑动」而不是「跳变」。
6. 遵守 `prefers-reduced-motion`（`useReducedMotion` 时全部时长置 0）。

### ⚠️ motion 的 exit 语义坑

`AnimatePresence` 在子元素被移除时，**exit 动画使用「移除前那一帧的 props」**。若在同一个 effect 里既 `setCollapseDuration`（折算时长）又 `setCollapseExpanded(false)`（触发移除），两处更新会被 React 批处理成同一次渲染，移除时读到的 transition 仍是旧值 —— 折算时长完全不生效（实测代价：1348px 的内容也只用 ~400ms 收完）。

**修法：拆成两拍。** 第一个 effect 只写时长 + 置 `pendingCollapse`；第二个 effect 见到 `pendingCollapse` 才真正 `setCollapseExpanded(false)`。

## 涉及文件（Phase 7 返工后的最终状态）

| 文件 | 改动 |
|------|------|
| `src/components/ai-elements/tool-actions-group.tsx` | 核心：受控折叠模式 `processCollapse = { delivered }`、手风琴形态、双曲线动画 |
| `src/components/chat/MessageItem.tsx` | **唯一的折叠触发点**：`displayText` 非空 ⇒ 已交付 ⇒ 收起 |
| `src/components/chat/StreamingMessage.tsx` | 流式侧刻意**不参与**折叠，走 `flat` 铺开 |
| ~~`src/components/chat/MessageList.tsx`~~ | ~~交棒继承~~ —— **Phase 7 已全部删除，该文件不再参与本功能** |
| `src/hooks/useProcessCollapse.ts` | 新建：localStorage 偏好 + `useSyncExternalStore` 订阅 |
| `src/components/settings/AppearanceSection.tsx` | 新建「交付时收起过程」开关 |

## 验证证据（Phase 1-6，第一版设计，部分已随返工作废）

> ⚠️ 下面这组数据测的是"交付边沿自动收起"的动画，该行为已在 Phase 7 移除。
> 保留作为 `motion` 动画基础设施有效性的记录（同一套双曲线、同一套手风琴，现在服务于手动开合）。

全部通过 chrome-devtools MCP 在受控探针页实测（探针页验证后已删除）。

**折叠过程的多帧轨迹（证明是渐变而非跳变）：**

| 场景 | 起始高度 | 结束高度 | 落定时长 | 高度轨迹 |
|------|---------|---------|---------|---------|
| 6 个工具 | 245.5px | 31.5px | 334ms | 246→240→169→81→46→33→32 |
| 40 个工具 | 1347.5px | 31.5px | 627ms | 1348→1339→1166→681→322→145→63→33 |

**展开动画轨迹：** 32→144→211→235→243→245

**交棒（StreamingMessage 卸载 → MessageItem 接管）：**

| 场景 | 交棒前 | 交棒后 |
|------|-------|-------|
| 默认（未手动展开） | 31.5px | 31.5px（零跳变） |
| 用户曾手动展开 | 31.5px | 245.5px（正确继承） |

**完整一轮时序：** 流式展开 245.5 → 交付收起 31.5 → 手动再展开 245.5

**自检：** `npx tsc --noEmit` exit 0；`npm run test` 1199 通过 / 0 失败。

## 验收标准（Phase 7 返工后）

- [x] **任务进行中过程全程铺开**，每一步的思考与工具调用都可见（不出现折叠条）
- [x] **任务彻底完成、消息落定后**才收成一条 `N个已完成 · 思考与执行完毕` 汇总条
- [x] 点击汇总条可展开/收起，展开与收起动画平滑（不同缓动曲线）
- [x] 被中断的消息（无结论）不被收起
- [x] 设置里可关闭该行为，关闭后回到完全铺开的旧行为
- [x] CDP 实测（150ms 采样整个任务周期）+ `npm run test` 通过


## 已知取舍

- 代码块统一到自研 `CodeBlock` 后，**失去了 Streamdown 的下载按钮**（统一性与功能完整性的取舍，接受）。
- 表格字号改为「跟随上下文 `1em`」而非全局统一像素值 —— 在不同容器里都能读，但不再是固定字号。
- 设置项文案用了中文硬编码，与相邻的「提示音」行保持一致；**未走 i18n**。若后续要国际化需补 `src/i18n/{zh,en}.ts`。
- ~~开关打开时，流式期间会多一条过程汇总头行~~ —— **Phase 7 后该代价消失**（流式侧改回 `flat`）。

## 决策日志

- 2026-10-07: 折叠范围取「思考 + 工具调用合成一条汇总条」，而非各自独立折叠 —— 交付瞬间只留一条，视觉最干净。
- 2026-10-07: 触发时机取「第一个文字结论出现时」（复用既有 `isSummarizing`），而非流式结束 —— 用户注意力正好从过程移到结论上，且能与 `MessageItem` 的判定自洽。**（此条已被 Phase 7 推翻，见下）**
- 2026-10-07: **手动展开记忆取「仅当前这一轮有效」**，下一轮对话照常自动收起。用户原话："用户展开以后，下次发消息，还是自动折叠"。实现用 `useRef`，不落库、不引入 schema 变更。（**此条修订过**：初版曾定为"会话级记忆，键为 sessionId"，用户随后推翻。）
- 2026-10-07: 不新建折叠容器，复用 `ToolActionsGroup` 已有的手风琴与 `motion` 动画 —— 骨架已存在，只需把 `flat` 短路分支接上受控开关。
- 2026-10-07: 手风琴从流式一开始就常驻（不再按交付与否切换 `flat`）—— 模式切换会导致子树重挂载、丢掉过渡动画；宁可接受流式期间多一条头行。**（此条已被 Phase 7 推翻，见下）**
- 2026-10-07（Phase 7）: **触发时机改为「任务彻底完成、消息落定」**。用户实测否决了「第一个结论字出现」这一时机 —— 原话"任务从一开始所有的消息就被折叠了……算了，最后都完成了再折叠吧"。根因是 `isSummarizing` 的语义实为"此刻没有工具在跑"，在多步任务里每两步之间都成立。
- 2026-10-07（Phase 7）: **收起态改为「挂载即定型」** —— `useState(() => !delivered)`，彻底删掉"交付边沿"的 effect 与两段式收起。凡是"只发生一次且不可逆"的 UI 状态变化，交给挂载初值比交给可能反复触发的边沿更安全。
- 2026-10-07（Phase 7）: **删除交棒继承机制**（`processToggledDuringStreamRef` / `lastAssistantIdx` / `initialProcessExpanded` / `onUserToggle`）。流式侧不再参与折叠判断，这套跨组件传递失去存在理由；"单轮级手动记忆"的需求也随之消失 —— 手动开合只发生在消息落定之后，天然按消息实例隔离。
- 2026-10-07（Phase 7）: **删除按内容高度折算的收起时长**（`min(0.72, 0.3 + height / 5200)`）。它服务于"交付边沿自动收起"的快慢匹配，自动收起取消后无意义，固定 0.34s。
