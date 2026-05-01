# Learnings Log

Auto-captured observations during agent runs. Each entry tracks a pattern
that may be promoted to a Skill after sufficient recurrence.

## LRN-20260501-001 correction
**Category**: correction
**Priority**: high
**Status**: pending
**Area**: AI SDK / Claude Code subprocess
**Pattern-Key**: sdk.subprocess.cwd-misconfiguration
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T16:48:28.669Z

### Summary
SDK 子进程必须从项目目录运行以访问配置，设为 home 目录导致静默认证失败和 60s 超时

### Details
generateTextViaSdk（被压缩等辅助任务调用）将 cwd 设为 os.homedir()，而 Claude Code SDK 需要从项目目录运行以读取 .claude/settings.json 等配置。从 home 目录运行时子进程无法找到有效配置，导致静默失败。错误处理也存在问题：SDK 返回 SDKResultError 时（is_error=true），代码检查 `'result' in msg` 会跳过错误（SDKResultError 无 result 字段），最终抛出无意义的 'SDK query returned no result'，真实错误信息完全丢失。此外，压缩进度条完全是动画占位，没有真实数值。

### Suggested Action
1. generateTextViaSdk 添加 cwd 参数，默认使用 process.cwd()；2. 增加 SDKResultError 检测逻辑，提取 errors[] 和 subtype 填充有意义的错误信息；3. 进度条使用不确定进度（脉冲动画）代替伪造的百分比

## LRN-20260501-002 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: AI/Agent 核心
**Pattern-Key**: runtime.sdk-subprocess.timeout
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T17:04:04.379Z

### Summary
压缩功能超时根因：使用 Claude Code CLI 子进程执行简单文本摘要，进程启动+API调用耗时远超60秒，改用 AI SDK 直接 HTTP 调用解决

### Details
用户报告压缩每次都触发 60 秒超时错误。根因是 `generateTextViaSdk` 会 spawn 一个完整的 Claude Code CLI 子进程（需要加载配置、初始化SDK、处理认证），然后才能发 API 请求。子进程启动本身就慢，加上网络调用，很容易超过 60 秒限制。之前的修复已经将实现改为 `streamTextFromProvider`（直接 HTTP 调用，无需子进程），理论上解决了超时问题。如果仍然超时，问题可能在：(1) `createModel` 对该服务商凭证认证失败 (2) 网络问题 (3) 服务商 API 本身响应慢

### Suggested Action
重新测试压缩功能。如果仍超时，检查 Electron DevTools Console 或服务端日志中的 `[context-compressor]` 输出，确认是 HTTP 请求层面的错误（网络/认证/API限流）还是其他原因

## LRN-20260501-003 better-way
**Category**: better-way
**Priority**: high
**Status**: pending
**Area**: ai.compression
**Pattern-Key**: ai.compression.model-resolution
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T17:30:15.227Z

### Summary
压缩摘要应配置专用辅助模型而非回退到主会话模型（Qwen3等量化模型不支持摘要任务导致返回空内容）

### Details
压缩功能使用 `resolveAuxiliaryModel('compact')` 解析模型：当没有配置专用压缩模型时，回退到主会话模型。根因是主会话模型 `Qwen3.6-35B-A3B-8bit` 是量化模型，不擅长摘要任务，API 返回空输出。`streamTextFromProvider` 捕获 `AI_NoOutputGeneratedError` 后重试一次，如果仍失败则抛出中文错误提示用户配置辅助模型。

### Suggested Action
在设置页面的提供商配置中，为压缩任务配置 roleModels.small（如 Haiku、GPT-4o-mini）。这样压缩专用模型不会被主会话模型限制，从根本上解决问题。

## LRN-20260501-004 workflow
**Category**: workflow
**Priority**: medium
**Status**: pending
**Area**: UI/UX和消息卡片管理
**Pattern-Key**: ui.compression.cleanup
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T17:39:22.543Z

### Summary
压缩完成后需主动隐藏压缩上下文消息卡片以保持界面整洁

### Details
用户反馈压缩完成后界面上会残留压缩上下文的消息卡片，这些卡片需要被隐藏。压缩上下文的进度条应该显示在正在压缩上下文的那行字下方，而不是放在看板里。

### Suggested Action
在压缩完成时，调用隐藏压缩上下文相关消息卡片的逻辑。同时将进度条从看板组件移到压缩上下文显示行内部。

## LRN-20260501-005 workflow
**Category**: workflow
**Priority**: high
**Status**: pending
**Area**: ChatView warmup 流程
**Pattern-Key**: react.warmup.duplicate-fetch
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T17:59:12.003Z

### Summary
ChatView 同时通过回调和 useEffect 触发两次 warmup 请求，导致竞态条件

### Details
在 ChatView.tsx 中，当用户切换模型时，`handleProviderModelChange` 回调直接调用 `fetch('/api/chat/warmup')`，随后 `setCurrentModel/setCurrentProviderId` 触发 useEffect 依赖变化，useEffect 再次调用同一个 warmup API。两次请求几乎同时到达服务器，如果第一次请求的预热失败（如超时），第二次请求可能复用第一次的失败 Promise，或者服务器端状态机混乱导致间歇性失败。用户反馈的"有时候可以有时候不可以"正是这种竞态条件的典型表现。

### Suggested Action
在 `handleProviderModelChange` 中移除直接的 warmup fetch 调用，仅依靠 useEffect 触发预热。或者在 ChatView 中使用 debounce/防抖机制，确保模型切换后只触发一次预热请求。同时在 useEffect 中添加请求 ID 标记，避免响应乱序问题。
