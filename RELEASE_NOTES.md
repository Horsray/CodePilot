## CodePilot v0.50.0

> 飞书一键创建机器人 + SubAgent UI 可视化 + 消息队列模式 + 桥接稳定性大修 — 推荐所有飞书桥接用户升级。

### 新增功能

- **飞书一键创建机器人**：设置 → 飞书设置 → "创建并绑定飞书应用"，浏览器自动打开飞书授权页面，确认后 Bot 能力、权限、事件订阅和长连接模式全部自动配置，无需再手动进飞书开放平台后台
- **SubAgent 执行过程可视化**：Agent 调用子代理（explore / general）时，工具面板会显示闪电图标和子代理的嵌套工具调用进度（带 spinner / 完成 / 失败状态指示）
- **输入框草稿持久化**：在一个聊天中打了字还没发送，切换到别的聊天再切回来，输入内容仍然保留（按会话分别保存）
- **消息队列模式**：AI 正在响应时继续输入并回车，消息会显示在输入框上方的队列卡片里，AI 回复完成后自动发送。支持取消队列中的消息，参考 Codex 设计
- **飞书 AskUserQuestion 交互卡片**：Agent 在飞书桥接中使用 AskUserQuestion 时，现在会渲染为带选项按钮的交互卡片（之前直接被拒绝），点击选项即可继续对话
- **飞书资源消息支持**：飞书桥接现在可以接收图片、文件、音频、视频消息，自动下载并附加到对话上下文（带重试和 20MB 大小限制）

### 修复问题

- **飞书群聊 @mention 过滤失效**（#384）：设置"需要 @提及"开关后，机器人真的会在群里只响应 @Bot 的消息
- **飞书话题群串 session**（#321）：未开启"话题会话"时，不同话题消息不再被错误地路由到独立会话
- **飞书桥接鉴权配置失效**：dmPolicy / groupPolicy / allowFrom / groupAllowFrom 配置现在真的会拦截未授权用户的消息和卡片点击（之前是配置存在但从未生效）
- **飞书 WebSocket 幽灵连接**：停止桥接或重绑应用时，旧的长连接现在会被正确关闭，不再出现重复消息投递
- **桥接停止不中断任务**：点击"停止桥接"后，正在运行的 Claude 会话会立刻被打断，不再继续写数据库
- **历史回放二进制附件乱码**：音频、视频、二进制文件在历史对话重放时不再被当成 UTF-8 文本注入上下文
- **消息投递可靠性**（#266）：飞书 outbound 消息加了指数退避重试，瞬时网络故障不再导致消息丢失
- **SubAgent 启动后后续消息排队**：在 AI 执行子代理期间继续发消息不会阻塞，会进入队列等待当前轮次完成

### 优化改进

- 队列中的消息以卡片形式悬浮在输入框上方（参考 Codex），可随时取消，不再混在聊天流里造成"两条用户消息一条没回复"的视觉错觉
- Streaming 中输入时按钮图标智能切换：空输入 → 终止图标，有内容 → 发送图标（只对纯文本有效；slash 命令 / badge / Image Agent 保持终止图标避免误导）
- 飞书快速创建支持已有应用场景：点击"已有飞书应用？点击手动配置"可展开原有的 App ID / App Secret 手动录入表单
- 飞书多 question / multi-select 的 AskUserQuestion 会被明确拒绝并附带清晰原因，不再静默截断成半截答案
- 飞书 bot identity 启动失败后会每 60s 后台重试，不再永久 fail-open（#384 的边界情况）

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.50.0/CodePilot-0.50.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.50.0/CodePilot-0.50.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.50.0/CodePilot.Setup.0.50.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
