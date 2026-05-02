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

## LRN-20260501-006 failure
**Category**: failure
**Priority**: medium
**Status**: pending
**Area**: 前端 UI 状态与消息列表管理
**Pattern-Key**: ui.progress-bar.double-render
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-01T20:20:17.507Z

### Summary
压缩时出现重复"上下文压缩中"是因为同时在消息列表渲染了临时助手消息和底部分隔行组件

### Details
ChatView.tsx 在 onCompress 时向消息列表插入了一个 id 为 'temp-compact-*' 的临时助手消息，内容为'上下文压缩中...'。同时 MessageList.tsx 也渲染了一个底部 DividerRow 显示相同文本和进度条。ContextCompressionDivider 在压缩进行中返回 dividerIndex=-1（不渲染内部分隔线），但临时消息本身作为普通 MessageItem 仍然出现在消息列表中，造成上下两个"上下文压缩中"同时可见。根本原因是用临时消息作为即时反馈的设计与已有的 DividerRow 反馈机制重复。

### Suggested Action
任何状态同时需要两种 UI 反馈时（如消息列表项 + 独立进度条），必须确保只保留一种方案。建议将即时反馈统一为 UI 组件（如 DividerRow）而非在数据流中混入临时消息对象——后者既污染消息数据，又容易因多端同步产生不一致。

## LRN-20260502-001 failure
**Category**: failure
**Priority**: high
**Status**: pending
**Area**: Next.js API Route Handler
**Pattern-Key**: api.query-params.missing-request-param
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T07:31:19.110Z

### Summary
GET handler 忽略了前端传递的 includeMedia 查询参数，因为函数签名缺少 request: Request 参数

### Details
在 /api/providers/models/route.ts 中，GET handler 声明为 `export async function GET()` 而不是 `GET(request: Request)`。前端 useProviderModels hook 正确地请求 `/api/providers/models?includeMedia=true`，但后端永远无法读取该参数。这导致媒体服务商被无条件过滤，ImageGenConfirmation 组件的 providerGroups 永远为空，allImageModels 数组为空，模型选择 UI 不渲染，生成请求时 providerId 和 model 都是 undefined，最终导致后端回退逻辑失败。这是典型的「前端传参正确，后端读不到」bug——常见于从简单 handler 改造成需要读取请求参数时的遗漏。

### Suggested Action
1. 审查所有 route handler：凡是 fetch() 带了 query string 的，GET handler 签名必须包含 `request: Request` 并用 `new URL(request.url).searchParams` 解析。2. 添加 TypeScript 规则或在 code review checklist 中加入「检查 request handler 是否正确读取 URL 参数」。3. 考虑提取一个通用的 queryParam 解析 helper 避免重复代码。

## LRN-20260502-002 architecture
**Category**: architecture
**Priority**: high
**Status**: pending
**Area**: 图片生成架构/MCP 工具注册
**Pattern-Key**: mcp.tool-conflict-registration
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T07:42:08.909Z

### Summary
MCP 工具注册与交互式 UI 流程存在架构冲突，导致 AI 绕过用户确认直接调用工具失败

### Details
系统中存在两条图片生成路径：(1) imageAgentMode=true 时 AI 输出 image-gen-request 代码块 → 前端渲染 ImageGenConfirmation 交互式卡片；(2) 直接调用 codepilot_generate_image MCP 工具。当 imageAgentMode=true 时，虽然 MEDIA_MCP_SYSTEM_PROMPT 不再注入（避免指令冲突），但 codepilot-image-gen MCP server 仍然被注册，AI 看到工具可用就直接调用而绕过交互式 UI。同时 MCP schema 要求参数名 imageSize，但 AI 收到的是 resolution 参数名导致校验失败返回 'Invalid JSON response'。

### Suggested Action
在 imageAgentMode=true 时条件性地跳过 codepilot-image-gen MCP server 注册，并在 MEDIA_MCP_SYSTEM_PROMPT 和工具描述中明确参数名（imageSize）以确保参数一致性。

## LRN-20260502-003 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: API 路由设计
**Pattern-Key**: api.query-param-ignored
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:28:54.445Z

### Summary
GET handler 缺少 request 参数导致查询参数被静默忽略

### Details
`/api/providers/models` 的 GET handler 函数签名是 `GET()` 而非 `GET(request: Request)`，前端传递的 `includeMedia=true` 查询参数完全被忽略。结果是 media=true 时返回了所有提供商（包括 Claude、GPT 等普通模型）而不是只返回媒体服务商，导致 ImageGenConfirmation 卡片显示了大量无关模型。

### Suggested Action
所有 GET handler 如果需要读取查询参数，必须声明 `request: Request` 参数并用 `new URL(request.url).searchParams` 解析。

## LRN-20260502-004 correction
**Category**: correction
**Priority**: high
**Status**: pending
**Area**: settings.ui-routing
**Pattern-Key**: ui.provider-routing-by-name
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:41:27.383Z

### Summary
当同一逻辑实体可能以不同元数据值存储时（如 custom-media 可存为 'custom' 或 'gemini-image'），仅靠 provider_type 匹配会导致编辑时加载错误的 UI 组件，需要增加名称检查作为兜底。

### Details
findMatchingPreset 函数最初仅按 provider_type 和 base_url 匹配预设。通用中转平台的 provider_type 可能是 'custom'（旧路径创建）或 'gemini-image'（新路径创建），导致编辑时匹配到错误的预设（如 gemini-image-thirdparty），从而显示旧版复杂表单而非新版简洁 UI。修复方案是在类型匹配之前先按 provider 名称检查，如果名称是 '通用中转平台' 则直接返回 custom-media 预设。

### Suggested Action
在组件路由逻辑中，对于用户可识别的关键实体（如特定服务商），应同时检查名称和类型，而非仅依赖类型字段。特别是当同一实体可能通过不同创建路径产生不同元数据时。建议在 findMatchingPreset 等匹配函数的最前面添加名称检查。

## LRN-20260502-005 failure
**Category**: failure
**Priority**: medium
**Status**: pending
**Area**: 开发流程
**Pattern-Key**: dev.hot-reload.miss
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:43:37.172Z

### Summary
修改代码后dev server未重启，导致用户界面未更新，显示旧版配置界面。

### Details
用户修改了通用中转平台的配置界面代码（包括PresetConnectDialog组件、findMatchingPreset函数等），但编辑已连接的提供商时仍显示旧版混乱界面（ProviderForm）。经检查，数据库中的数据正确，代码逻辑正确，但dev server没有加载新代码，需要重启才能生效。

### Suggested Action
在修改涉及UI或配置的代码后，确保重启dev server，并添加提示或自动检测机制提醒开发者重启服务。

## LRN-20260502-006 failure
**Category**: failure
**Priority**: high
**Status**: pending
**Area**: settings.provider-ui
**Pattern-Key**: settings.provider.model-display-hardcoded
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:50:47.402Z

### Summary
UI model list for media providers was using hardcoded constants instead of reading user-configured models from env_overrides_json._custom_models

### Details
ProviderManager.tsx line 646 used GEMINI_IMAGE_MODELS (hardcoded Nano Banana 2/Pro/Mini) for ALL gemini-image providers regardless of user configuration. The user's custom models (大香蕉, GPT2) stored in env_overrides_json._custom_models were completely ignored in the connected providers list display. Additionally, findMatchingPreset relied solely on provider name matching ('通用中转平台') which broke if the provider was renamed - needed fallback to check for _custom_models presence in env_overrides_json.

### Suggested Action
When displaying configurable data like model lists in settings UIs, always parse from provider's stored configuration (env_overrides_json, options_json, etc.) instead of using hardcoded constants. For provider preset matching, use multiple signals (name, stored data markers like _custom_models, protocol) rather than relying on a single fragile identifier like name.

## LRN-20260502-007 better-way
**Category**: better-way
**Priority**: medium
**Status**: pending
**Area**: UI配置/图像生成设置
**Pattern-Key**: ui.image-gen-defaults
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:53:30.704Z

### Summary
用户期望的默认配置（如画面比例自动、4K分辨率、从用户设置读取模型）应作为优先实现路径，而非依赖硬编码或过时的默认值。

### Details
用户明确指出图像生成确认界面应将画面比例默认为“自动”（文生图时传1:1，图生图时不传参数）、分辨率默认为4K，且模型列表应仅显示用户在“通用中转平台”中配置的两个模型，而非硬编码的Catalog默认值（如Nano Banana系列）。代码原先使用硬编码数组`ASPECT_RATIOS`和`RESOLUTIONS`的默认值，并且在API路由和UI组件中混合了Catalog默认、role_models和用户自定义模型，导致显示混乱。

### Suggested Action
1. 将图像生成界面的默认值（比例：auto，分辨率：4K）作为代码常量明确定义。2. 确保API模型列表路由在检测到`env_overrides_json._custom_models`时，优先且仅使用用户配置的模型，跳过Catalog和role_models注入。3. 对于“自动”比例，在前端发送请求时，需根据是否包含参考图像（图生图）决定是否传递`aspectRatio`参数。

## LRN-20260502-008 better-way
**Category**: better-way
**Priority**: high
**Status**: pending
**Area**: ui.provider-preset
**Pattern-Key**: ui.provider-preset.data-flow
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:54:59.451Z

### Summary
用户可配置的服务商预设（如通用中转平台）需要确保数据流从存储到显示的完整性，UI不能用硬编码值覆盖用户配置。

### Details
通用中转平台（custom-media）的模型列表在三个地方被硬编码覆盖：1) ProviderManager的已连接服务商卡片用GEMINI_IMAGE_MODELS常量显示模型，忽略env_overrides_json._custom_models；2) ImageGenConfirmation的models API返回catalog默认值+role_models注入+custom_models混合列表；3) active-image API的resolveModelForProvider从extra_env读取默认模型，不在_custom_models列表中则匹配失败。此外findMatchingPreset只按provider_name匹配，改名后失效；(Google)后缀被硬编码给所有gemini-image提供商。

### Suggested Action
1) models API中当_custom_models存在时跳过catalog默认和role_models注入；2) resolveModelForProvider优先从_custom_models+role_models_json.default读取；3) findMatchingPreset增加_custom_models检测作为兜底；4) ProviderManager的模型选择器从env_overrides_json解析而非硬编码常量；5) 所有UI标签（如(Google)后缀）应从provider数据动态获取。

## LRN-20260502-009 failure
**Category**: failure
**Priority**: medium
**Status**: pending
**Area**: ui.provider-settings
**Pattern-Key**: ui.preset-matching.name-fragility
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T08:57:25.445Z

### Summary
Using provider name as the sole identifier for preset matching breaks when users rename providers, causing edit dialogs to fall back to the generic form.

### Details
The findMatchingPreset function initially used provider.name === '通用中转平台' to identify custom-media providers. When a user renamed the provider, the match failed and the edit dialog fell back to the generic ProviderForm with all the confusing advanced fields. The fix was to also check for _custom_models presence in env_overrides_json as a more robust identifier that survives renaming.

### Suggested Action
When matching providers to presets, avoid relying solely on display names which users can change. Use structural identifiers like stored configuration keys (_custom_models), protocol types, or other immutable properties. If name-based matching is needed as a convenience, always have a structural fallback.

## LRN-20260502-010 architecture
**Category**: architecture
**Priority**: high
**Status**: pending
**Area**: provider-management, image-generation
**Pattern-Key**: provider.matching.custom-media
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T09:00:36.267Z

### Summary
识别自定义媒体提供商时，应优先检查env_overrides_json中的_custom_models字段，避免依赖名称或provider_type等易变属性。

### Details
在findMatchingPreset函数中，最初按provider.name匹配'通用中转平台'，但用户重命名后失效；修复后增加了对env_overrides_json._custom_models的检查，确保即使改名也能正确匹配。类似地，图片生成中SDK选择应基于options_json.media_protocol而非provider_type，因为自定义媒体提供商可能使用OpenAI兼容API。

### Suggested Action
在涉及用户可配置数据的匹配逻辑中，优先使用结构化数据（如JSON字段）而非简单属性，并考虑所有可能的配置变体（如重命名、类型覆盖）。建议在代码中添加注释说明匹配优先级和容错策略。

## LRN-20260502-011 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: image-generation
**Pattern-Key**: image-generation.sdk-selection-by-protocol
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T09:02:06.343Z

### Summary
Don't determine SDK selection from provider_type alone — custom relay providers may use OpenAI-compatible API despite having provider_type 'gemini-image'

### Details
The pickImageProvider function used provider_type to determine SDK family (gemini vs openai). For custom relay providers configured with provider_type: 'gemini-image' but using OpenAI-compatible API (options_json.media_protocol: 'openai-images'), this caused the Gemini SDK to be used against an OpenAI-compatible endpoint, resulting in HTML error pages instead of JSON responses. The base_url also needed /v1 normalization since relay platforms typically include /v1 in their API paths.

### Suggested Action
Always check options_json.media_protocol (or similar actual protocol indicator) before falling back to provider_type for SDK selection. When creating API clients for relay platforms, normalize base_url to include /v1 suffix if missing.

## LRN-20260502-012 non-obvious
**Category**: non-obvious
**Priority**: high
**Status**: pending
**Area**: media/image-generation
**Pattern-Key**: media.image-generator.sdk-selection
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T09:09:44.813Z

### Summary
自定义中转平台的 provider_type 与实际 API 协议不匹配时，图片生成器会用错 SDK 和错误的 base URL

### Details
pickImageProvider() 用 provider_type('gemini-image') 判定 SDK family 为 gemini，但用户的中转平台实际是 OpenAI 兼容 API(options_json.media_protocol='openai-images')。同时 detectFamily() 只识别 gpt-image/gemini 前缀的模型名，自定义模型名如 nano-banana-pro 返回 undefined。此外 base_url 缺少 /v1 前缀，因为代码没有从 options_json.media_endpoint 提取路径前缀。三个问题叠加导致请求打到网站首页返回 HTML → Invalid JSON response。

### Suggested Action
1) pickImageProvider 的 toFamily() 应优先检查 options_json.media_protocol 而非 provider_type; 2) 创建 OpenAI client 时应从 media_endpoint 提取路径前缀拼到 base_url; 3) 考虑为中转平台类 provider 增加统一的 'relay' 类型标识，避免 provider_type 与实际协议混淆

## LRN-20260502-013 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: 图像生成, API集成
**Pattern-Key**: api.image.relay-async-task
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T09:14:57.432Z

### Summary
中转平台（如神马API）使用异步任务API和FormData格式，与标准OpenAI图像生成API不兼容，需要专门的处理逻辑。

### Details
中转平台的图像生成API端点为/v1/images/edits，使用multipart FormData提交异步任务，返回task_id，然后通过轮询/v1/images/tasks/{task_id}获取结果。这与标准OpenAI的/v1/images/generations同步JSON API完全不同。直接使用AI SDK会导致请求路径错误（如拼接为/v1/images/generations），请求打到网站首页返回HTML，触发'Invalid JSON response'错误。

### Suggested Action
对于自定义或中转API提供者，应实现专用的图像生成流程：检测options_json中的media_protocol字段（如'openai-images'），使用自定义HTTP请求（POST FormData到/v1/images/edits?async=true）和轮询逻辑，而不是依赖标准AI SDK。

## LRN-20260502-014 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: api.integration
**Pattern-Key**: integration.relay-api-response-parsing
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T10:58:58.871Z

### Summary
第三方中转平台的图片生成API响应格式可能偏离标准，图片内容会用Markdown格式（如`![image](url)`）封装，需要特别的解析逻辑。

### Details
当前使用的中转平台（api.whatai.cc）在调用`/v1/chat/completions`端点进行图片生成时，虽然返回了标准的OpenAI Chat Completions响应格式（含`id`, `object`, `created`, `model`, `choices`, `usage`等键），但图片内容本身并未以预期的`image_url`内容块或base64数据格式返回，而是被包裹在`choices[0].message.content`的一个字符串中，格式为Markdown图片语法：`![image](https://oss.filenest.top/uploads/...png)`。现有的提取逻辑仅检查了纯URL（`http`）和base64（`data:`）格式，未处理Markdown语法，导致提取失败。

### Suggested Action
1. 在响应解析逻辑中，优先检测并解析Markdown图片格式 `![...](url)`。2. 在正式代码中添加更详尽的日志（如记录content的原始值），以便快速定位未来类似问题。3. 考虑为不同的中转平台或模型配置创建适配的响应解析器，因为格式可能不一致。

## LRN-20260502-015 failure
**Category**: failure
**Priority**: high
**Status**: pending
**Area**: api.integration
**Pattern-Key**: api.response-format.parsing
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T11:39:10.455Z

### Summary
图片生成 API 响应格式解析失败：返回的 Markdown 格式 `![image](url)` 未被正确提取

### Details
中转平台（whatai.cc）的 /v1/chat/completions 返回标准 Chat Completions 格式，但 choices[0].message.content 是 Markdown 图片格式 `![image](https://oss.filenest.top/uploads/xxx.png)`，而非标准的 URL 或 base64。extractFromData 函数只检查了 `startsWith('http')` 和 `startsWith('data:')`，未处理 Markdown 格式。修复：添加正则 `!/\[([^\]]+)\]\(([^)]+)\)/` 提取括号内的 URL。调试过程中从异步轮询改同步、从 /v1/images/edits 改 /v1/chat/completions，最终通过日志发现 content 是 Markdown 字符串。

### Suggested Action
1. 遇到 API 响应格式不匹配时，立即打印完整响应（包括 content 类型和预览），而非猜测格式 2. 中转平台 API 文档通常不可靠，优先通过日志确认实际响应结构 3. 对未知 API 响应，提取逻辑应覆盖更多格式变体（Markdown、JSON 字符串、嵌套对象等）

## LRN-20260502-016 api-behavior
**Category**: api-behavior
**Priority**: high
**Status**: pending
**Area**: AI模型与工具集成架构
**Pattern-Key**: ai.model.tool-call-concurrency
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T13:11:59.331Z

### Summary
AI模型在调用独立工具时，即使任务无依赖，也倾向于串行执行而非自动并行，因此并发能力需要在客户端或工具端显式实现。

### Details
用户发现AI模型（如Claude）在调用`codepilot_generate_image`等独立工具时，不会自动将多个调用并行化。即使用户明确要求生成多张图片，模型也倾向于在一次回复中只输出一个`tool_use` block，导致任务串行执行。查看代码发现，虽然Claude Code SDK在技术上支持处理同一轮中的多个`tool_use` block并行执行，但模型的实际输出行为决定了这很少发生。因此，不能依赖模型的“智能”来自动编排并行任务。

### Suggested Action
放弃依赖AI模型自动并行编排的设计。对于批量生图需求，并行能力应显式实现在以下两个位置之一：1) MCP工具内部：为`codepilot_generate_image`添加`count`参数，由工具handler内部使用`Promise.allSettled`实现并行调用。2) 前端交互式卡片：由前端根据用户的“数量”选择，直接并行发起多个`/api/media/generate`请求。

## LRN-20260502-017 failure
**Category**: failure
**Priority**: high
**Status**: pending
**Area**: credentials
**Pattern-Key**: credentials.provided-but-ignored
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T14:12:10.119Z

### Summary
助手忽略用户直接提供的敏感凭证，反而去搜索不存在的记忆系统。

### Details
用户在对话开头已明确提供了完整的SMTP邮件服务器配置信息（地址、端口、用户名、密码），但助手没有将这些信息作为当前可用的上下文，而是花费大量步骤去尝试从多个记忆系统（MEMORY.md、知识图谱、共享记忆）中查找本就不存在的配置，最终才向用户索要信息。

### Suggested Action
当用户直接提供具体的配置信息（尤其是敏感凭证）时，助手应首先将其视为当前会话的有效信息进行处理和使用，而不是假设其已被存储在外部记忆系统中。应建立“用户直接输入优先于检索”的处理流程。

## LRN-20260502-018 correction
**Category**: correction
**Priority**: medium
**Status**: pending
**Area**: memory management
**Pattern-Key**: memory.user-config.save
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T14:16:50.276Z

### Summary
用户提供了邮箱配置，助手将其保存到项目记忆中以实现跨会话访问。

### Details
助手在用户请求增加邮件收发能力时，先尝试查找记忆系统中的邮箱配置（通过记忆文件和知识图谱）但未找到；用户提供SMTP服务器、端口、用户名、密码和个人邮箱后，助手创建了记忆文件（user_email_config.md）并更新了MEMORY.md索引，使得配置信息在后续会话中能自动加载和共享。

### Suggested Action
建议改进记忆系统的默认搜索流程或建立配置模板，以更高效地处理用户提供的敏感配置信息。

## LRN-20260502-019 failure
**Category**: failure
**Priority**: medium
**Status**: pending
**Area**: 构建依赖管理
**Pattern-Key**: build.dependency.missing
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T14:18:31.949Z

### Summary
项目依赖不完整导致构建失败，需要安装缺失的xterm相关包。

### Details
用户报告预览失败，错误信息显示模块 '@xterm/addon-fit' 未找到。助手通过npm安装了 @xterm/xterm、@xterm/addon-fit 和 @xterm/addon-webgl 来解决。

### Suggested Action
在项目的package.json中确保包含所有必需的依赖，或在开发流程中加入依赖检查步骤。

## LRN-20260502-020 workflow
**Category**: workflow
**Priority**: high
**Status**: pending
**Area**: dependency-management
**Pattern-Key**: dependency-management.batch-install
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T14:31:09.727Z

### Summary
在处理项目依赖问题时，一次性全面检查并安装所有缺失包可以避免多次错误和用户不满。

### Details
在增加邮件发送功能的过程中，助手多次遇到构建错误（如缺少@xterm/addon-fit、react-virtuoso、zustand等），需要逐个安装缺失包，导致用户多次刷新和反馈，最终要求一次性解决。这表明依赖检查和安装应该作为系统性的步骤，而不是零散的修复。

### Suggested Action
在项目开发中，当遇到构建错误或依赖问题时，应先运行一个全面的依赖检查脚本（例如检查package.json中所有依赖是否安装，或使用工具如depcheck），然后一次性安装所有缺失包，避免多次往返操作。

## LRN-20260502-021 failure
**Category**: failure
**Priority**: medium
**Status**: pending
**Area**: build
**Pattern-Key**: build.dependency-install-loop
**Recurrence-Count**: 1
**Last-Seen**: 2026-05-02T14:39:26.102Z

### Summary
修复构建错误时陷入‘安装一个缺失依赖 -> 发现另一个缺失’的循环，未一次性识别所有缺失包

### Details
用户报告项目预览失败，我逐个处理报错的缺失依赖（@xterm/addon-fit、react-virtuoso、zustand、@tailwindcss/postcss等），但每次修复后立即暴露新的缺失依赖，导致至少4轮来回沟通。根本原因是项目的 node_modules 状态不一致（部分包声明但未安装），而我的修复策略是‘看到什么报错就修什么’，没有预判性扫描。

### Suggested Action
在修复构建错误时，先运行一个脚本扫描项目源码中所有第三方 import，对比 node_modules 状态，一次性列出并安装所有缺失的包，避免逐个修复的循环。
