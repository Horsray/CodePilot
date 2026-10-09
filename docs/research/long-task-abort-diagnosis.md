# 长任务中途"突然断开/提前结束"根因排查

> 排查时间：2026-10-07 · 症状：任务进行中自己突然断开、提前结束对话，长任务尤其频繁

## 结论（按触发概率排序）

### 1️⃣ 工具 300 秒墙钟超时 → 服务端直接 abort 整个查询（主凶）

**链路**（`src/lib/claude-client.ts:2512-2521` + `src/app/api/chat/route.ts:592`）：

1. 工具运行中，CLI 持续上报 `tool_progress`（含已运行秒数）
2. 当 `elapsed_time_seconds >= toolTimeoutSeconds`（**默认 300 秒**）时：
   - 向客户端发一个 `tool_timeout` 事件
   - **`abortController.abort()` 直接中断整个 SDK 查询** —— 正在跑的命令被杀、本轮任务终止
3. 循环 break → 走到正常收尾（`controller.enqueue('done')`）→ **客户端看到的是"干净结束"，没有报错、没有提示**
4. 结果：一轮干到一半的任务**静默提前结束**，保留半截内容

**为什么是"长任务尤其频繁"**：任何单个工具（构建、npm install、测试套件、打包脚本、浏览器自动化）超过 5 分钟必被杀。用户的插件打包/长构建恰好都在这个区间。

**性质**：这是 upstream 2026-04-10 的防卡死补丁（commit `45320c3`，"工具墙钟超时监控，避免界面卡住"）。它**只看墙钟时间**——即使工具仍在正常推进进度（progress 事件持续到达），到 300s 照样杀。防卡死的初衷合理，但误杀长任务。

### 2️⃣ 客户端 330 秒空闲超时 → 判错并清空 SDK 会话（SDK 路径缺保活）

- `stream-session-manager.ts:110`：`STREAM_IDLE_TIMEOUT_MS = 330_000`（思考期 600s），每 10s 检查一次，超时 **客户端主动 abort**
- **Native 运行时安全**：`agent-loop.ts:124` 每 15s 发 `keep_alive` → 空闲计时器持续被重置
- **SDK（Claude Code CLI）运行时没有独立保活**：`claude-client.ts` 全文件无 setInterval，只被动转发 CLI 偶然发出的 `keep_alive`/`tool_progress`。任何超过 5.5 分钟的"安静期"（慢 provider 首字、无进度的长 MCP 调用、上下文压缩过程）都会触发误判
- **额外伤害**：空闲超时路径会把 `sdk_session_id` 清空（`stream-session-manager.ts:1045-1049`），下次发言冷启动新 CLI 会话 → **任务上下文连续性丢失**
- 注：`claude-client.ts:773` 的注释写着 "keep-alive timer"，但定时器本体已不存在（上游同版本也没有）——只留了 wrapController 的支持设施

### 3️⃣ 次级风险

- **子 Agent 5 分钟无进度自动判超时**（`stream-session-manager.ts:785`）：安静的长子任务被标记 error 并"自动清理"，主任务流程受扰
- **stream_replaced 静默终止**：同会话重复 `startStream` 会静默终止旧流（会话切换/热更新路径已豁免，普通发送有排队守卫，风险低）

## ✅ 修复实施记录（2026-10-07）

| 修复 | 位置 | 内容 |
|------|------|------|
| A. 工具超时改为「无进度」语义 | `claude-client.ts` tool_progress 处理 + 新增看门狗 + `route.ts` | 原墙钟判断（`elapsed >= 阈值` 即杀）删除；改为 `toolProgressAt` 记录每个工具最近一次进度时间，10s 周期检查，**连续 `toolTimeoutSeconds` 秒无任何进度**才判卡死；tool_result 时移除跟踪；默认阈值 300s → **600s（无进度）**。长构建只要进度在推进就不会被杀 |
| B. SDK 路径独立保活心跳 | `claude-client.ts` 流启动处 | 每 15s 发 `keep_alive`（与 Native 的 agent-loop 一致），finally 清理；330s 空闲看门狗由此变成"服务端真挂了"的探测器 |
| C. 中止可见化 | `claude-client.ts` + `stream-session-manager.ts` | 中止前先发一条 status「工具「X」已 N 秒无响应，判定卡死，本轮任务已中止」；客户端在回合收尾时把同样的说明**写进消息正文**（原实现是服务端主动 abort → 走正常收尾 → 静默结束，什么都没提示） |

**验证**：typecheck 通过；单测 1189/1194（唯一失败为已知 provider 环境问题）。实机验证：向 `/api/chat` 发一个包含 `sleep 25` 的回合，SSE 流中观测到 **2 次 `keep_alive`**（15s 间隔 ✓），回合正常 `done` 并入库 ✓。

**未改动（次风险，保留观察）**：子 Agent 5 分钟无进度自动判超时；stream_replaced 静默终止。

## 修复方案（原始建议，已完成 A/B/C）

| # | 方案 | 说明 |
|---|------|------|
| A | **工具超时改为"无进度超时"** | 不再用墙钟一刀切，改为记录"上次收到进度的时间"——只有在 N 秒内**没有任何进度更新**时才中止（防卡死初衷不变，长任务不误杀）；同时把默认阈值从 300s 放宽（如 1800s） |
| B | **SDK 路径加服务端保活定时器** | 像 agent-loop 一样每 15s 发 `keep_alive`——330s 空闲超时即变成"服务端真的挂了"的探测器，消除误判 |
| C | **超时终止要可见** | 工具超时/空闲超时结束时，明确提示原因（现在工具超时是静默结束，用户一头雾水） |
| D | **空闲超时不清 sdk_session_id**（或改为提示后由用户决定） | 保住任务上下文连续性 |

---

## 附：MCP / CLI 工具"经常失效"现状复查（2026-10-07）

用户回忆弃用的另一因素：CLI 运行时 MCP 服务与常用工具经常失效。复查结论：

- ✅ **MCP 注入链路已加固**：聊天入口按工作区解析全部有效 MCP 并**全量透传**给 CLI（`claude-client.ts:1016` "CLI 主路径全量 MCP 透传"），不再依赖关键词补载。日志显示每次 init 稳定 `mcpServers=26`。
- ✅ **实测工具可用**：`mcp__memory__read_graph` 调用成功（`is_error:false` 返回图谱数据）；运行日志中 `mcp__codepilot-todo__TodoWrite` 等调用正常。
- ✅ **持久会话复用正常**：近期日志 10 次复用 vs 4 次启动。
- ⚠️ **残余风险**：
  1. 工具调用决策权在模型 —— 第三方/中转模型（MiniMax、DeepSeek 等）的 MCP 工具调用能力参差，同一工具在 Claude 下稳定、换模型可能偶发不调/调错（"工具失效"感受的最大来源，链路层无法根治）；
  2. 26 个 MCP 服务器 × 冷启动较重，个别服务器失败时**无可见提示**（只表现为工具消失）；
  3. 模型 ID 目录不规范会引发签名不匹配 → 热会话被丢弃 → 每轮冷启动 → MCP 反复重初始化。
- 建议加固：CLI init 的各 MCP 状态做 UI 可见化（N/M 就绪 + 失败清单）；精简低频 MCP 改为按工作区启用；保持模型目录规范。

---

## MCP 精简 + 状态可见化（2026-10-07 实施）

### 改动
1. **常用白名单**（`mcp-loader.ts` 的 `COMMON_MCP_SERVERS`）：常驻加载 `filesystem / playwright / chrome-devtools / MiniMax / context7`（依据实际调用频次）；聊天与**预热**路径都只预载这 5 个外部服务器。
2. **低频改按需**（`claude-client.ts`）：始终运行关键词按需选择器（github / 联网搜索 / memory / rag / sequential-thinking / fetch / 任意配置名命中），预载名单自动去重——prompt 提到什么就补什么。
3. **`--strict-mcp-config`**（主路径 + 预热，经 SDK `extraArgs` 传入）：让 CLI 只使用我们显式注入的服务器，**忽略 ~/.claude.json 等配置的原生全量发现**——这是让白名单真正生效的关键（此前 CLI 原生发现会绕过筛选）。
4. **插件 MCP 显式并入**：strict 模式会连带跳过插件自带 MCP（实测 omc bridge 被排除），现在读取启用插件的 `.claude-plugin/plugin.json → mcpServers` 并把 `plugin:<name>:<server>` 注入进去（解析 `${CLAUDE_PLUGIN_ROOT}`）。
5. **UI 状态徽标**（`McpStatusChip.tsx`）：显示在「参考了 N 个上下文」右侧 —— `🔌 MCP 就绪/总数`，异常时显示「· N 异常」并可展开查看服务器名 / 状态（连接失败/需鉴权/启动中）/ 错误原因；流式结束后自动刷新。

### 实测验证
- 全新会话冷启动：**MCP 26 → 15**（5 常用 + 10 个进程内 codepilot-*），低频服务器（memory/github/rag/harmonyos 等 11 个）不再拉起。
- 注意：**旧的预热会话会被复用**（持久会话签名不含 MCP 列表），复用时仍是旧进程的 26 个；应用重启或条目过期后的下一次冷启动即收敛到 15。
- 日志确认插件注入生效：`[claude-client] Injected plugin MCP servers: plugin:omc:t`。

### 调整方式
常用名单是 `mcp-loader.ts` 顶部的一个常量数组，增删即可（如常跑 github 相关任务，把 `github` 加进去）。

---

## OpenAI 兼容中转支持（bananarouter 修复，2026-10-07）

用户反馈：bananarouter 怎么都维护不进去、测试连接失败、和 cc-haha 不对齐。排查出**四个叠加的问题**：

### 根因 1（真凶）：一条破坏性迁移，每次启动删除 openai-compatible 服务商
`src/lib/db.ts` 迁移块中原有：
```sql
DELETE FROM api_providers WHERE protocol = 'openai-compatible'
```
注释写着"SDK does not support them"——在只有 CLI 直连的年代成立，但它导致**每次应用启动/迁移都会清空所有 OpenAI 兼容服务商**，用户"加几次删几次"。现已移除（转换代理落地后该理由已过时）。

### 根因 2：协议被表单覆盖
- `provider-presets.tsx` 的 `toQuickPreset` 把 `openai-compatible` 协议映射成 `provider_type: 'anthropic'`；
- `ProviderForm` 保存时按 `provider_type` 反推 protocol → openai-compatible 被覆盖成 anthropic → 请求走 Anthropic `/v1/messages`（bananarouter 对该路径返回 503）。
两处均已修复（映射保留 openai-compatible；表单预置表新增该类型）。

### 根因 3：缺少 OpenAI 转换层（"open 代理转换"没对齐）
Claude Code CLI 只会说 Anthropic Messages 格式，而 bananarouter 只提供 OpenAI `/v1/chat/completions`。cc-haha 在服务端内置了双向转换代理，本 fork 没有。**已完整移植**：
- `src/lib/proxy/`：types / anthropicToOpenaiChat / openaiChatToAnthropic / openaiChatStreamToAnthropic / openaiUsage（源自 cc-haha，含流式 SSE 双向转换与 reasoning_content 映射）；
- `src/app/api/proxy/[providerId]/v1/messages/route.ts`：转换代理入口；
- `provider-resolver.toClaudeCodeEnv`：openai-compatible / openrouter 协议时把 CLI 的 `ANTHROPIC_BASE_URL` 指向本地代理；
- **安全**：代理仅接受携带进程级随机令牌的请求（令牌经 `ANTHROPIC_AUTH_TOKEN` 注入 CLI，真实上游 Key 只留在服务进程内，不下发给 CLI；防同网段滥用）。

### 根因 4：测试连接没有 OpenAI 分支
`testProviderConnection` 对任何非媒体/云协议都按 Anthropic `/v1/messages` 探测。已新增 `openai-compatible`/`openrouter` 分支：`GET <root>/v1/models` + Bearer（最便宜的可用端点，同 openai-image 探测思路）。

### 端到端验证
- 测试连接：`{"success": true}` ✓
- 真实对话（新建会话 → provider=bananarouter, model=gpt-5.6-terra）：回复「当前使用的模型是 GPT-5.6-terra」（直连对照为 Codex/GPT-5 系），**20 个流式文本片段全部经代理双向转换**，无错误 ✓
- 服务商配置在重启后不再消失（迁移已修）✓；已为其补录 gpt-5.6-terra / sol / luna 三个模型
