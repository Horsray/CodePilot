# 交付折叠 — 技术交接

> 产品思考见 [docs/insights/delivery-collapse.md](../insights/delivery-collapse.md)
> 上游相关：[工具调用 UX 优化](./tool-call-ux.md)（`ToolActionsGroup` 的由来与工具渲染全貌）
> 执行计划见 [docs/exec-plans/completed/delivery-collapse.md](../exec-plans/completed/delivery-collapse.md)

## 这个功能是什么

助手的一轮回复，前半段是一连串思考与工具调用（Read/Bash/Edit…），后半段是给用户的最终结论。**交付折叠**在一轮任务**彻底结束之后**，把前半段过程收成一条 `N个已完成 · 思考与执行完毕` 的汇总条，屏幕上只剩结论。

汇总条可以点击随时展开回看；再次点击收起。

**触发时机是本功能最核心的约束（也是返工过一次的地方）：**

| 阶段 | 过程块的形态 |
|------|------------|
| 任务进行中（流式中） | **全程铺开**，每一步的思考与工具调用都看得见 |
| 任务结束、消息落定 | 收成一条汇总条，可点开 |

## 涉及文件

| 文件 | 角色 |
|------|------|
| `src/components/ai-elements/tool-actions-group.tsx` | **核心**。受控折叠模式 `processCollapse`、手风琴形态、双向动画曲线 |
| `src/components/chat/MessageItem.tsx` | **唯一的折叠触发点**：`displayText` 非空（该轮给出了结论）⇒ 收起 |
| `src/components/chat/StreamingMessage.tsx` | 流式侧：**刻意不传 `processCollapse`**，走 `flat` 铺开（任务进行中步骤全可见） |
| `src/hooks/useProcessCollapse.ts` | **新建**。localStorage 偏好 + `useSyncExternalStore` 跨组件订阅 |
| `src/components/settings/AppearanceSection.tsx` | 「交付时收起过程」开关 |

`MessageList.tsx` **不参与**这个功能（早期版本曾在这里做"交棒继承"，已删除，见文末"返工记录"）。

## 数据流

```
StreamingMessage（任务进行中）
  <ToolActionsGroup flat ... />            ← 不传 processCollapse
      │                                     flat 模式：没有任何头行，过程直接铺开
      │  交棒（流式结束、消息落库）
      ▼
MessageItem（任务已完成）
  processCollapse = { delivered: displayText.trim().length > 0 }
      ▼
ToolActionsGroup
  collapseEnabled = true
  collapseExpanded = useState(() => !delivered)   ← 挂载即定型，无副作用
```

**为什么这样切分**：折叠这个动作只应该发生一次，而且必须发生在"这一轮已经结束"这个事实成立之后。而"这一轮结束了"最容易、最可靠地被 `MessageItem` 观察到 —— 它挂载的时刻就是消息落定的时刻。流式侧不需要参与任何判断，它只需要老实铺开。

## 组件契约

`ToolActionsGroup` 的受控折叠 prop：

```ts
processCollapse?: {
  /** 任务已完成、结论已给出。挂载时决定初始开合（已交付 = 收起） */
  delivered: boolean;
};
```

- **不传 = 完全保持旧行为**（`flat` 铺开），向后兼容；开关关闭时也走这条路。
- 传了就强制走手风琴分支（`flat` 短路被 `if (flat && !collapseEnabled)` 放行）。
- 若 `segments.length === 0`（无过程可收）则直接返回 `null`，不渲染空汇总条。
- **没有 `onUserToggle` / `defaultExpanded`**：这些是早期"交付边沿 + 交棒继承"设计的遗留，随返工一并删除。

## 关键设计决策

### 1. ⚠️ 折叠必须是"挂载即定型"，不能是"运行时边沿"

`delivered` 一旦由 `MessageItem` 算出就**不会再变**（消息内容不变，`displayText` 就不变）。因此内部只需要一句：

```ts
const [collapseExpanded, setCollapseExpanded] = useState(() => !delivered);
```

不需要任何「`delivered` 从 false 翻成 true 就收起」的 effect。

**这条是踩坑换来的**：早先版本在流式侧传 `delivered: isSummarizing`，`isSummarizing` 会在一轮里反复 true / false 翻转。当时用「只认一次 false→true 边沿」的 effect 处理，结果是**一旦中途收起就再也弹不回来**（翻回 false 只重置了 ref，不重新展开）。见文末"返工记录"。

结论：**凡是"只发生一次且不可逆"的 UI 状态变化，优先让它由挂载时的初值决定，而不是由一个可能反复触发的边沿决定。**

### 2. 两条不同的缓动曲线，各管一个方向

| 方向 | 曲线 | 理由 |
|------|------|------|
| 展开 | `cubic-bezier(0.22, 1, 0.36, 1)`（`ENTER_EASE`） | 项目统一入场曲线（强 ease-out），与 `globals.css` 其它动效一致 |
| 收起 | `cubic-bezier(0.4, 0, 0.2, 1)`（`EXIT_EASE`） | 先加速后减速。**不能沿用入场曲线** —— 强 ease-out 的位移集中在最开始，收一个上千像素高的过程块会像被"抽走"一样糊成一片 |

这两条曲线现在只服务于**用户手动开合**（点开、点合），交付那一刻的收起是挂载即定型、本身不播动画。高度动画同时叠加透明度过渡，避免文字被压缩变形时出现重影。`useReducedMotion()` 为真时所有时长置 0。

`overflow: hidden` 是收起观感的关键：高度收缩时内容从底部被裁切，而不是被压扁。刻意不加 `translateY` —— `globals.css` 里记录过，位移中的文字会落到亚像素位置被重采样，表现为"文字发虚"。

### 3. 交付后的头行文案要带上 `delivered`

```ts
const stillWorking = isStreaming && !delivered;
```

被中断、没给出结论的消息（`delivered === false`）即使不再流式，也不该被读成「思考完毕」—— 它其实没跑完。文案要说实话（否则汇总条写着"思考完毕"是在骗人）。

### 4. 收起时长固定 0.34s

只用于用户手动收起自己刚展开的过程块。早期版本按内容高度折算（`min(0.72, 0.3 + height / 5200)`）是为了让"交付自动收起"的快慢跟体量匹配；自动收起取消后，测量和折算都没有意义了，删掉。

### 5. 流式期间不折叠的代价：**零**

早期版本担心"平时 `flat`、交付时换手风琴会造成子树重挂载、动画硬切"，因此让手风琴从流式一开始就常驻，**代价是流式期间多一条过程汇总头行**。

返工后这个代价消失了：交付时机的收起本来就是"挂载即定型"，不播动画，所以流式侧可以干净地走 `flat`，过程区连头行都没有，直接铺开。**"为动画让步"的账不用再记了。**

## 设置项

| 项 | 值 |
|----|----|
| localStorage 键 | `codepilot.collapseProcessOnDeliver` |
| 默认值 | `true`（开启） |
| 读取 | `useProcessCollapseEnabled()`（`useSyncExternalStore`，server snapshot 返回 `true` 避免 hydration 不一致） |
| 写入 | `setCollapseProcessOnDeliver(v)` |
| UI 位置 | 设置 → 外观（AppearanceSection），在「提示音」行之后、Preview 之前 |

改动后对话流会立刻跟着变，不需要刷新（`useSyncExternalStore` 订阅）。

**注意：设置项文案是中文硬编码**，与相邻的「提示音」行风格一致，**未走 i18n**。若要国际化需补 `src/i18n/{zh,en}.ts`。

## 验证方法

CDP 脚本在真实对话流上装一个 150ms 采样器，记录**每一帧**：

1. `main.innerText` 的尾部（流式内容永远在底部）；
2. 尾部里是否出现「个已完成 · 思考与执行完毕」这类**汇总条文案**；
3. `[id^="msg-"]` 的行数（消息落定的标志）。

判定：任务进行中全程 `汇总条=无` 且能看到每一步的工具路径与中间说明 → 通过；行数 +1 之后汇总条出现、过程内容不再可见 → 通过。

本次验证数据见执行计划的「验证证据」小节。

## 已知局限

- **中段文字会被一起收走**。正文与工具调用交替时模型写给用户看的中间说明，位于 `ToolActionsGroup` 内部，收起时被一并收进去。这是刻意的——"只交付结论"，但意味着工具调用之间的说明也会被藏起来。
- **旧格式消息可能不收**。`delivered` 的判定是"存在后续没有工具调用的 text block"。历史上有些消息把结论存成了 `thinking` block（`content` 是 `[{"type":"thinking",...}]` 形态的 JSON 数组），解析不到 text block ⇒ `delivered === false` ⇒ 保持展开。这是数据形态问题，不是折叠逻辑问题；这类消息本来就该"没结论就别藏过程"。
- 折叠只改高度、不改列宽，所以是"向上滑动"而非"宽度塌陷"。

## 返工记录：为什么 `isSummarizing` 是错的触发信号

第一版把触发点定在"第一个结论字出现"，信号是 `StreamingMessage` 里已有的：

```ts
const allToolsCompleted = hasTools && timelineTools.every(t => 已有结果);
const isSummarizing = isStreaming && allToolsCompleted && cleanContent.length > 0;
```

**它看起来像"任务即将交付"，实际含义是"此刻没有工具正在跑"。** 多步任务里每两个步骤之间都成立（上一批工具跑完、下一批还没发起），于是任务刚开头 `delivered` 就翻成 true，过程块当场收起；再叠上"收起边沿只认一次、翻回 false 不重新展开"的实现，**整轮任务就永久停在折叠态**。

用户的原话：*"任务从一开始所有的消息就被折叠了，折叠区在显示步骤，这和我想要的完全不是一回事。"*

教训：

1. **复用一个已有变量当触发器之前，先确认它的语义真的是你要的那个**。`isSummarizing` 用于"插入一句过渡提示"是安全的（幂等、无破坏性），用于"收起一大块内容"就致命了。
2. **破坏性的、不可逆的 UI 变换，不要挂在可能高频翻转的信号上**。要么让它由挂载初值决定（现在的做法），要么用真正单调的完成态信号（流结束 / 消息落定）。
3. 返工时顺带证明了一件事：`StreamingMessage` 完全可以不参与折叠判断，`MessageItem` 一个 `delivered` 就够了 —— **判断点越少越不容易错**。
