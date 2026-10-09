# 合并计划：官方 v0.50.2 → 当前 Fork

> 生成时间：2026-04-13
> 当前分支：`rescue/recover-lost-work-20260413`
> 官方标签：`v0.50.2` (commit c45df93)
> 当前 HEAD：319e19f
> 差异统计：278 files changed, +17836 / -14402

---

## 一、官方 v0.50.2 新增内容（需要继承）

### 1. Skills 系统修复
- `f647c96` fix(skills): multi-select badges, remove description, slash button auto-spaces
- `5d92fc5` fix: runtime stability + Hermes regression bundle
- `82f2918` fix: Turbopack CJS-ESM interop breakage + built-in MCP auto-approval

**影响文件**：`src/lib/skill-nudge.ts`, `src/components/chat/StreamingMessage.tsx`, `src/lib/mcp-loader.ts`

### 2. 会话/输入体验修复
- `93c71c2` fix: retain existing input text when selecting slash commands with optional details (#486)
- `82f2918` persist elapsed timer across session switches (#484)

**影响文件**：`src/components/chat/MessageInput.tsx`, `src/hooks/useSSEStream.ts`

### 3. OpenAI OAuth 重试
- `c983352` fix(oauth): retry token exchange on 403 / network failures (#464)

**影响文件**：`src/lib/openai-oauth.ts`

### 4. Provider 凭据隔离修复
- `5d92fc5` fix(provider): per-request credential ownership + cc-switch credential bridge

**影响文件**：`src/lib/provider-resolver.ts`, `src/lib/sdk-subprocess-env.ts`, `src/lib/claude-home-shadow.ts`

### 5. Feishu 优化
- `a42e928` fix(feishu): unref() session cleanup timers so tests don't hang

**影响文件**：`src/lib/bridge/feishu-app-registration.ts`

### 6. 测试修复
- CI module identity drift 修复、Turbopack CJS-ESM interop 修复

---

## 二、Fork 独有的新增内容（需要保留）

### A. 会话池与生命周期管理（本次会话新增）
| 文件 | 说明 |
|------|------|
| `src/lib/cli-session-pool.ts` | SDK 会话生命周期管理：idle timeout、close cleanup、path pre-warming |
| `src/lib/claude-client.ts` | Smart resume（<3 条历史跳过）、broken session 检测、session tracking |
| `src/lib/runtime/registry.ts` | `prewarmClaudePath()` 调用、credential check 逻辑优化 |
| `src/lib/runtime/sdk-runtime.ts` | `dispose()` 调用 `disposeSessionPool()` |

### B. 权限默认放行
| 文件 | 说明 |
|------|------|
| `src/app/api/chat/route.ts` | `permission_mode` 参数传递、`bypassPermissions` 默认 true |
| `src/lib/stream-session-manager.ts` | `permission_mode: 'bypassPermissions'` 发送到 SDK |

### C. MCP 工具超时优化
| 文件 | 说明 |
|------|------|
| `src/lib/stream-session-manager.ts` | `MCP_TOOL_TIMEOUT_MS` 从 60s → 300s、双层 watchdog |

### D. 工具超时导致永久 session 失败修复
| 文件 | 说明 |
|------|------|
| `src/lib/claude-client.ts` | `forcedToolTimeout` 分支清理 `sdk_session_id` |
| `src/app/api/chat/interrupt/route.ts` | Interrupt 后调用 `closeSession()` |

### E. Fork 定制功能（长期保留）
| 模块 | 说明 |
|------|------|
| **终端支持** | `electron/terminal-manager.ts`（已删除，改为其他实现） |
| **浏览器支持** | 内置浏览器、`onUiAction` 处理 |
| **CC Switch** | `src/lib/cc-switch.ts`、`hydrateCCSwitchProvider()`、`readCCSwitchClaudeSettings()` |
| **媒体渠道** | `src/app/api/media/generate/route.ts`、`src/lib/image-generator.ts` 扩展 |
| **文件树 UI** | `src/components/project/EnhancedFileTree.tsx`、`FileReviewBar.tsx` |
| **控制台** | `src/components/console/ConsolePanel.tsx`、`src/lib/console-utils.ts` |
| **知识库** | `src/app/knowledge-base/page.tsx`、`src/app/api/knowledge-base/route.ts` |
| **Git 增强** | `src/app/api/git/*` 多个路由、`GitDiffViewer`、`GitStashSection`、`PushDialog` |
| **Agent Timeline** | `src/lib/agent-timeline.ts`、`TimelineFinalSummary.tsx` |
| **性能追踪** | `src/lib/perf-trace.ts`、`src/app/api/chat/perf/route.ts` |
| **自定义规则** | `src/app/api/settings/custom-rules/*`、`src/components/settings/RulesSection.tsx` |
| **文件管理 API** | `src/app/api/files/*`（create/rename/delete/write） |
| **底部面板** | `src/components/layout/BottomPanelContainer.tsx` |
| **辅助卡片** | `src/components/settings/AssistantSettingsCard.tsx` |

---

## 三、Fork 删除的内容（相对于 v0.50.2）

官方 v0.50.2 有但我们 fork 中已删除的文件（37 个，~7619 行）：

| 类别 | 文件 | 删除原因 |
|------|------|----------|
| **终端相关** | `electron/terminal-manager.ts`, `TerminalDrawer.tsx`, `TerminalInstance.tsx`, `useTerminal.ts` | 终端功能重构/移除 |
| **清理/重构** | `safe-stream.ts`, `sdk-subprocess-env.ts`, `claude-home-shadow.ts`, `claude-settings.ts`, `parallel-safety.ts`, `subdirectory-hint-tracker.ts` | 功能简化或内联到其他文件 |
| **Agent 相关** | `agent-registry.ts`, `agent-sdk-agents.ts`, `tools/agent.ts` | Agent 系统重构 |
| **飞书注册** | `feishu-app-registration.ts` + 3 个 API 路由 | 飞书功能精简 |
| **Builtin 工具** | `ask-user-question.ts`, `session-search.ts` | 迁移到 `tools/` 目录 |
| **测试** | 11 个单元测试文件 | 对应功能已删除或重构 |
| **文档** | 5 个 exec-plan/handover/research 文档 | 已完成或过时 |

---

## 四、关键冲突区域（合并时需重点处理）

### 1. `src/lib/claude-client.ts` — 冲突等级：HIGH
**官方改动**：
- 移除了 `claude-home-shadow`, `sdk-subprocess-env`, `safe-stream` 的依赖
- 改用 `toClaudeCodeEnv` + `getExpandedPath` 构建环境
- 移除了 `allowedTools` 内置 MCP 自动批准列表
- 移除了 project MCP servers 注入逻辑
- 图片处理优化（从 100 张改为 2 张）
- Resume 超时检测（3s timeout）
- 工具超时 watchdog 机制

**Fork 改动**：
- Smart resume（`needsResume` 检测）
- Broken session 检测
- Session pool 集成（`registerSdkSession`, `releaseSession`）
- `forcedToolTimeout` 分支修复

**合并策略**：保留官方的环境构建方式和图片优化，**在此基础上叠加** fork 的 smart resume、broken session 检测和 session pool 逻辑。官方的 resume 超时检测与 fork 的逻辑可以共存。

### 2. `src/lib/provider-resolver.ts` — 冲突等级：HIGH
**官方改动**：
- 恢复了 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'`
- 移除了 `hasClaudeSettingsCredentials` 依赖
- 简化了 `settingSources` 为 `['user', 'project', 'local']`（全部保留）
- 移除了 SHORT_ALIAS 回退逻辑
- 大幅简化了辅助模型路由

**Fork 改动**：
- CC Switch 集成（`hydrateCCSwitchProvider`, `isCCSwitchProvider`）
- CC Switch 模型优先级修正
- `readCCSwitchClaudeSettings` 替换旧的 credentials 检查

**合并策略**：官方的 `settingSources` 全保留和 `MANAGED_BY_HOST` 恢复与 fork 的 CC Switch 逻辑**不冲突**，可以共存。需要确认 CC Switch 的 `env_overrides_json` 不会与 `MANAGED_BY_HOST` 冲突。

### 3. `src/lib/stream-session-manager.ts` — 冲突等级：MEDIUM
**官方改动**：
- 双层 timeout（`lastTransportEventTime` vs `lastMeaningfulEventTime`）
- MCP 工具超时区分
- `thinkingSegments` 结构化 thinking
- `activeToolExecution` 追踪
- `onUiAction`, `onReferencedContexts` 事件
- `buildStructuredFinalContent` JSON 序列化

**Fork 改动**：
- `MCP_TOOL_TIMEOUT_MS` 300s（官方也是 300s，一致）
- `permission_mode: 'bypassPermissions'`
- 中文注释

**合并策略**：官方改动已经包含了 fork 的大部分超时优化。需要确保 `permission_mode: 'bypassPermissions'` 不被覆盖。

### 4. `src/app/api/chat/route.ts` — 冲突等级：MEDIUM
**官方改动**：
- `perfTrace` 性能追踪集成
- `traceId` 传递
- `includeAgentsMd`, `includeClaudeMd`, `enableAgentsSkills`, `syncProjectRules`, `knowledgeBaseEnabled` 新字段
- `resolvedModelForSession` 回写
- 中文压缩提示
- `referencedContexts` 处理

**Fork 改动**：
- `permission_mode` 参数处理
- `bypassPermissions` 默认 true 修复
- `closeSession()` 调用

**合并策略**：官方的 perfTrace 和 fork 的 permission_mode 不冲突。需要确保 `bypassPermissions` 修复逻辑保留。

### 5. `src/lib/runtime/registry.ts` — 冲突等级：LOW
**官方改动**：
- 移除了 `hasClaudeSettingsCredentials` 依赖
- 简化了 `hasCredentialsForRequest` 逻辑
- 移除了 cc-switch credential bridge 注释

**Fork 改动**：
- `prewarmClaudePath()` 集成

**合并策略**：直接叠加，无冲突。

### 6. `src/lib/runtime/native-runtime.ts` — 冲突等级：LOW
**官方改动**：
- 移除了 `safe-stream` 和 `syncMcpConnections` 依赖
- `systemPromptResult` 结构（含 `referencedFiles`）
- `includeAgentsMd` 等新参数传递

**Fork 改动**：无明显 fork 独有改动

**合并策略**：直接使用官方版本。

### 7. `src/lib/agent-loop.ts` — 冲突等级：MEDIUM
**官方改动**：
- `perfTrace` 全链路性能追踪
- `maxRetries: 2` 自动重试
- `agentName` 参数
- 更详细的状态事件
- 移除了 `safe-stream`

**Fork 改动**：无明显 fork 独有改动

**合并策略**：直接使用官方版本。

---

## 五、合并步骤

### Phase 1: 安全准备
```bash
# 1. 确保当前分支已备份
git branch backup/pre-merge-$(date +%Y%m%d)

# 2. 确认 upstream remote 最新
git fetch upstream --tags
```

### Phase 2: 基础合并
```bash
# 3. 尝试合并 v0.50.2
git merge v0.50.2 --no-commit

# 4. 解决冲突文件（按优先级排序）
```

### Phase 3: 冲突解决清单

| 优先级 | 文件 | 策略 |
|--------|------|------|
| P0 | `src/lib/claude-client.ts` | 官方基底 + fork smart resume + session pool |
| P0 | `src/lib/provider-resolver.ts` | 官方基底 + fork CC Switch 逻辑 |
| P0 | `src/app/api/chat/route.ts` | 官方基底 + fork permission_mode 修复 |
| P1 | `src/lib/stream-session-manager.ts` | 官方基底 + 确保 bypassPermissions 保留 |
| P1 | `src/lib/runtime/registry.ts` | 叠加 prewarmClaudePath |
| P1 | `src/lib/agent-loop.ts` | 直接用官方 |
| P1 | `src/lib/runtime/native-runtime.ts` | 直接用官方 |
| P2 | `src/components/chat/StreamingMessage.tsx` | 保留 fork 改动 + 官方 skills 修复 |
| P2 | `src/components/chat/MessageInput.tsx` | 保留 fork 改动 + 官方 slash command 修复 |
| P2 | `src/lib/skill-nudge.ts` | 用官方版本 |
| P2 | `src/lib/openai-oauth.ts` | 用官方版本（含重试修复） |
| P2 | `src/lib/mcp-loader.ts` | 保留 fork 改动 + 官方 Turbopack 修复 |
| P3 | 其他 UI 组件 | 逐个对比合并 |

### Phase 4: 验证
```bash
# 5. 类型检查
npx tsc --noEmit

# 6. 启动 dev server 验证
npm run dev

# 7. 重点验证：
#    - SDK runtime 正常启动
#    - 权限默认 bypass
#    - Resume 功能正常（broken session 检测）
#    - CC Switch 功能正常
#    - MCP 工具超时 300s
```

### Phase 5: 清理
```bash
# 8. 删除过时的 exec-plan 文档
# 9. 更新 CLAUDE.md 差异列表（如有新增差异）
# 10. 提交
```

---

## 六、风险提示

1. **`safe-stream.ts` 删除**：官方已移除 safe-stream wrapper，fork 中也不再使用。确认所有 `wrapController` 调用已清除。

2. **`claude-home-shadow.ts` 删除**：官方移除了 shadow HOME 机制，改为 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`。需要确认这与 CC Switch 的凭据隔离不冲突。

3. **`sdk-subprocess-env.ts` 删除**：官方将环境构建逻辑内联到 `claude-client.ts` 和 `provider-resolver.ts`。fork 中的类似逻辑已对齐。

4. **测试文件大量删除**：37 个文件被删除，对应的测试覆盖率下降。建议合并后补充关键路径的测试。

5. **`settingSources` 变更**：官方从 `['user']`（DB provider）改为 `['user', 'project', 'local']`（全部），这意味着 project/local 层的 MCP、hooks、plugins 会重新生效。需要验证不会覆盖 CC Switch 的 env 配置。
