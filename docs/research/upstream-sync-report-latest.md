# Upstream Sync Report

- 仓库根目录：`/Users/horsray/Documents/codepilot/CodePilot`
- 上游引用：`upstream/main`
- 当前分支：`rescue/recover-lost-work-20260413`

## Summary

| 项目 | 值 |
| --- | --- |
| 共同基线 | d687fd61da8003f15e52d7d17ab570c0ee675f4b |
| fork 独有文件 | 189 |
| 官方独有文件 | 31 |
| 双边都改 | 80 |

> 中文注释：功能名称「upstream 差异报告」。
> 用法：同步官方前先运行 `npm run sync:report`，把官方独有、fork 独有、双边都改按 ownership map 自动归类，减少人工逐个 diff 的成本。

## Fork Exclusive

### core · core-agent-infra

Agent 编排、CLI 会话池、通知与性能追踪基础设施默认跟随 upstream。

| 文件 |
| --- |
| src/lib/agent-registry.ts |
| src/lib/agent-sdk-agents.ts |
| src/lib/agent-system-prompt.ts |
| src/lib/agent-timeline.ts |
| src/lib/agent-tools.ts |
| src/lib/background-job-manager.ts |
| src/lib/bg-notify-parser.ts |
| src/lib/claude-code-compat/claude-code-compat-model.ts |
| src/lib/claude-code-compat/request-builder.ts |
| src/lib/cli-session-pool.ts |
| src/lib/notification-manager.ts |
| src/lib/orchestration-routing.ts |
| src/lib/perf-trace.ts |

### core · core-mcp-runtime

MCP 连接、工具适配与记忆检索运行时默认跟随 upstream。

| 文件 |
| --- |
| src/lib/cli-tools-mcp.ts |
| src/lib/mcp-connection-manager.ts |
| src/lib/mcp-tool-adapter.ts |
| src/lib/memory-client.ts |
| src/lib/memory-search-mcp.ts |

### core · core-platform

平台与公共配置默认跟随 upstream。

| 文件 |
| --- |
| electron-builder.yml |
| electron/preload.ts |
| eslint.config.mjs |
| src/app/api/knowledge-base/route.ts |
| src/app/api/utils/open-path/route.ts |
| src/app/globals.css |
| src/app/knowledge-base/page.tsx |
| src/components/ui/ImagePreview.tsx |
| src/components/ui/ImageViewer.tsx |
| src/components/ui/alert-dialog.tsx |
| src/components/ui/badge.tsx |
| src/components/ui/button-group.tsx |
| src/components/ui/button.tsx |
| src/components/ui/checkbox.tsx |
| src/components/ui/collapsible.tsx |
| src/components/ui/context-menu.tsx |
| src/components/ui/dialog.tsx |
| src/components/ui/dropdown-menu.tsx |
| src/components/ui/hover-card.tsx |
| src/components/ui/icon.tsx |
| src/components/ui/label.tsx |
| src/components/ui/scroll-area.tsx |
| src/components/ui/select.tsx |
| src/components/ui/separator.tsx |
| src/components/ui/sheet.tsx |
| src/components/ui/switch.tsx |
| src/components/ui/tabs.tsx |
| src/components/ui/tooltip.tsx |
| src/hooks/useClientPlatform.ts |
| src/hooks/useNotificationPoll.ts |
| src/lib/console-utils.ts |
| src/lib/constants/image-agent-prompt.ts |
| src/lib/knowledge-graph-provider.ts |
| src/types/electron.d.ts |
| src/types/index.ts |
| tsconfig.json |

### core · core-settings-setup

设置、初始化向导与 MCP 配置界面默认跟随 upstream。

| 文件 |
| --- |
| src/app/api/settings/app/route.ts |
| src/app/api/settings/custom-rules/route.ts |
| src/app/api/settings/custom-rules/sync/route.ts |
| src/app/api/settings/workspace/route.ts |
| src/components/layout/InstallWizard.tsx |
| src/components/plugins/McpServerEditor.tsx |
| src/components/settings/AssistantSettingsCard.tsx |
| src/components/settings/AssistantWorkspaceSection.tsx |
| src/components/settings/GeneralSection.tsx |
| src/components/settings/RulesSection.tsx |
| src/components/settings/SettingsLayout.tsx |
| src/components/settings/workspace-types.ts |
| src/components/setup/ProjectDirCard.tsx |

### core · core-sync-governance

同步治理文件与脚本属于机制层，默认全仓共享维护。

| 文件 |
| --- |
| AGENTS.md |
| CLAUDE.md |
| fork-ownership-map.json |
| fork-patches.manifest.json |
| fork-sync-playbook.md |
| scripts/after-pack.js |
| scripts/check-fork-ownership.mjs |
| scripts/lib/fork-sync-utils.mjs |
| scripts/upstream-sync-bootstrap.mjs |
| scripts/upstream-sync-report.mjs |

### core · core-tests

单元测试默认跟随实现同步维护。

| 文件 |
| --- |
| src/__tests__/unit/agent-loop-messages.test.ts |
| src/__tests__/unit/assistant-workspace.test.ts |
| src/__tests__/unit/cli-tools-mcp.test.ts |
| src/__tests__/unit/file-checkpoint.test.ts |
| src/__tests__/unit/message-builder.test.ts |
| src/__tests__/unit/native-runtime.test.ts |
| src/__tests__/unit/search-history-tool.test.ts |
| src/__tests__/unit/timezone-boundaries.test.ts |

### core · core-tools

工具注册层与内置工具默认跟随 upstream，fork 只允许在注册接缝做薄扩展。

| 文件 |
| --- |
| src/lib/builtin-tools/cli-tools.ts |
| src/lib/builtin-tools/memory-search.ts |
| src/lib/tools/ask-user-question.ts |
| src/lib/tools/background-job.ts |
| src/lib/tools/bash.ts |
| src/lib/tools/edit.ts |
| src/lib/tools/get-diagnostics.ts |
| src/lib/tools/index.ts |
| src/lib/tools/search-history.ts |
| src/lib/tools/todo-write.ts |
| src/lib/tools/write.ts |

### fork · fork-file-tree

增强文件树、文件操作与对应面板。

| 文件 |
| --- |
| src/app/api/files/create/route.ts |
| src/app/api/files/delete/route.ts |
| src/app/api/files/rename/route.ts |
| src/app/api/files/write/route.ts |
| src/components/layout/panels/FileTreePanel.tsx |
| src/components/project/EnhancedFileTree.tsx |
| src/components/project/FileTree.tsx |

### fork · fork-git-panel

增强 Git 面板与相关 API/服务。

| 文件 |
| --- |
| src/app/api/git/ai-review/route.ts |
| src/app/api/git/diff/route.ts |
| src/app/api/git/discard/route.ts |
| src/app/api/git/fetch/route.ts |
| src/app/api/git/pull/route.ts |
| src/app/api/git/stage/route.ts |
| src/app/api/git/stash/route.ts |
| src/app/api/git/unstage/route.ts |
| src/components/git/CommitDialog.tsx |
| src/components/git/GitBranchSelector.tsx |
| src/components/git/GitDiffViewer.tsx |
| src/components/git/GitStashSection.tsx |
| src/components/git/GitStatusSection.tsx |
| src/components/git/PushDialog.tsx |
| src/lib/git/service.ts |

### fork · fork-media-gateway

媒体中转、通用图像生成与端点适配。

| 文件 |
| --- |
| src/app/api/media/generate/route.ts |
| src/components/chat/ImageGenConfirmation.tsx |
| src/lib/image-generator.ts |
| src/lib/image-provider-utils.ts |

### fork · fork-provider-overlay

CC Switch、OLMX 与 Provider 预设扩展。

| 文件 |
| --- |
| src/app/api/providers/models/route.ts |
| src/app/api/providers/route.ts |
| src/components/settings/PresetConnectDialog.tsx |
| src/components/settings/ProviderForm.tsx |
| src/components/settings/provider-presets.tsx |
| src/lib/cc-switch.ts |

### fork · fork-tabs-and-browser

顶部标签、统一工作区、内置浏览器与相关 Hook。

| 文件 |
| --- |
| src/components/layout/UnifiedTopBar.tsx |
| src/components/layout/panels/PreviewPanel.tsx |
| src/hooks/usePanel.ts |

### fork · fork-terminal-console

终端、控制台、底部面板与 PTY。

| 文件 |
| --- |
| electron/terminal-manager.ts |
| src/components/console/ConsolePanel.tsx |
| src/components/layout/BottomPanelContainer.tsx |
| src/components/terminal/TerminalDrawer.tsx |
| src/components/terminal/TerminalInstance.tsx |
| src/hooks/useTerminal.ts |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| .playwright-mcp/console-2026-04-11T20-54-29-907Z.log |
| .playwright-mcp/console-2026-04-11T21-44-37-198Z.log |
| .playwright-mcp/console-2026-04-11T21-45-00-663Z.log |
| .playwright-mcp/page-2026-04-09T14-48-25-998Z.png |
| .playwright-mcp/page-2026-04-10T16-28-53-225Z.png |
| .playwright-mcp/page-2026-04-11T20-54-32-439Z.yml |
| .playwright-mcp/page-2026-04-11T21-44-40-282Z.yml |
| .playwright-mcp/page-2026-04-11T21-45-13-449Z.yml |
| .playwright-mcp/page-2026-04-11T21-45-17-039Z.png |
| .trae/rules/git-commit-message.md |
| .trae/rules/rules.md |
| build.md |
| current-ui-settings.png |
| docs/exec-plans/active/agent-timeline-runtime-rebuild.md |
| docs/exec-plans/active/trae-style-agent-activity.md |
| docs/exec-plans/active/v0502-merge-plan.md |
| docs/handover/README.md |
| docs/handover/fork-sync-mechanism.md |
| docs/insights/README.md |
| docs/insights/fork-sync-mechanism.md |
| docs/research/upstream-sync-bootstrap-latest.md |
| docs/research/upstream-sync-report-latest.md |
| premium-ui.html |
| public/icons/toplogo.png |
| test-api.ts |
| test-peek.js |
| tmp/browser-shots/screenshot-1775773968242.png |
| tmp/browser-shots/screenshot-1775773989474.png |
| tmp/browser-shots/screenshot-1775799641550.png |
| ui-upgrade-design.png |
| ui开发文档/Trae 风格 AI 交互重构方案 (针对 HueyingAi 宽屏对话流).md |

### shared · shared-chat-runtime

聊天主链路、运行时与 Provider 解析接缝。默认先吸收官方，再以薄适配挂回 fork 能力。

| 文件 |
| --- |
| src/app/api/chat/background/route.ts |
| src/app/api/chat/interrupt/route.ts |
| src/app/api/chat/perf/route.ts |
| src/app/api/chat/review/route.ts |
| src/app/api/chat/search/route.ts |
| src/app/api/chat/sessions/[id]/route.ts |
| src/app/api/chat/sessions/route.ts |
| src/lib/context-assembler.ts |
| src/lib/diff-utils.ts |
| src/lib/file-checkpoint.ts |
| src/lib/runtime/types.ts |

### shared · shared-chat-ui

聊天输入、权限弹窗和会话交互 UI 随官方演进，但允许少量 fork 交互增强。

| 文件 |
| --- |
| src/components/ai-elements/conversation.tsx |
| src/components/ai-elements/message.tsx |
| src/components/chat/FileReviewBar.tsx |
| src/components/chat/MessageItem.tsx |
| src/components/chat/ModeIndicator.tsx |
| src/components/chat/ReferencedContexts.tsx |
| src/components/chat/TimelineFinalSummary.tsx |
| src/components/layout/ChatListPanel.tsx |
| src/hooks/useAssistantTrigger.ts |
| src/hooks/useProviderModels.ts |

## Upstream Exclusive

### core · core-platform

平台与公共配置默认跟随 upstream。

| 文件 |
| --- |
| .husky/pre-commit |
| RELEASE_NOTES.md |
| src/instrumentation.ts |
| src/lib/platform.ts |

### core · core-tests

单元测试默认跟随实现同步维护。

| 文件 |
| --- |
| src/__tests__/unit/context-pruner.test.ts |
| src/__tests__/unit/message-input-interactions.test.ts |
| src/__tests__/unit/permission-broker-bridge.manual-test.ts |
| src/__tests__/unit/provider-resolver-fixes.test.ts |
| src/__tests__/unit/sse-stream.test.ts |

### fork · fork-file-tree

增强文件树、文件操作与对应面板。

| 文件 |
| --- |
| src/components/ai-elements/file-tree.tsx |

### fork · fork-provider-overlay

CC Switch、OLMX 与 Provider 预设扩展。

| 文件 |
| --- |
| src/components/setup/ProviderCard.tsx |
| src/lib/ai-provider.ts |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| docs/exec-plans/active/cc-switch-credential-bridge.md |
| docs/exec-plans/active/electron-port-stability.md |
| docs/exec-plans/active/issue-tracker.md |
| docs/exec-plans/active/provider-governance.md |
| docs/exec-plans/active/runtime-auto-and-onboarding.md |
| docs/exec-plans/completed/hermes-inspired-runtime-upgrade.md |
| docs/exec-plans/tech-debt-tracker.md |
| docs/handover/bridge-system.md |
| docs/handover/hermes-inspired-runtime-upgrade.md |
| docs/handover/provider-architecture.md |
| docs/handover/provider-governance.md |
| docs/insights/user-audience-analysis.md |
| docs/research/README.md |
| docs/research/feishu-cli-one-click-bot.md |
| docs/research/hermes-agent-analysis.md |

### shared · shared-bridge

Bridge / 渠道插件默认跟官方一起演进，但要保留 fork 的接入配置与策略。

| 文件 |
| --- |
| src/lib/bridge/bridge-manager.ts |
| src/lib/bridge/conversation-engine.ts |
| src/lib/bridge/permission-broker.ts |
| src/lib/channels/feishu/outbound.ts |

## Both Changed

### core · core-platform

平台与公共配置默认跟随 upstream。

| 文件 |
| --- |
| next.config.ts |
| package-lock.json |
| package.json |
| src/i18n/en.ts |
| src/i18n/zh.ts |

### core · core-tests

单元测试默认跟随实现同步维护。

| 文件 |
| --- |
| src/__tests__/unit/claude-home-shadow.test.ts |
| src/__tests__/unit/claude-settings-credentials.test.ts |
| src/__tests__/unit/feishu-app-registration.test.ts |
| src/__tests__/unit/openai-oauth-retry.test.ts |
| src/__tests__/unit/parallel-safety.test.ts |
| src/__tests__/unit/project-mcp-injection.test.ts |
| src/__tests__/unit/provider-presence.test.ts |
| src/__tests__/unit/provider-preset.test.ts |
| src/__tests__/unit/provider-resolver.test.ts |
| src/__tests__/unit/runtime-legacy.test.ts |
| src/__tests__/unit/sdk-subprocess-env.test.ts |
| src/__tests__/unit/session-search.test.ts |
| src/__tests__/unit/skill-nudge.test.ts |
| src/__tests__/unit/subdirectory-hint-tracker.test.ts |

### core · core-tools

工具注册层与内置工具默认跟随 upstream，fork 只允许在注册接缝做薄扩展。

| 文件 |
| --- |
| src/lib/builtin-tools/ask-user-question.ts |
| src/lib/builtin-tools/index.ts |
| src/lib/builtin-tools/session-search.ts |
| src/lib/tools/agent.ts |

### fork · fork-provider-overlay

CC Switch、OLMX 与 Provider 预设扩展。

| 文件 |
| --- |
| src/components/settings/ProviderManager.tsx |

### fork · fork-tabs-and-browser

顶部标签、统一工作区、内置浏览器与相关 Hook。

| 文件 |
| --- |
| electron/main.ts |
| src/components/layout/AppShell.tsx |

### fork · fork-workspace

Assistant Workspace 增强、心跳、检索与模板。

| 文件 |
| --- |
| src/lib/assistant-workspace.ts |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| docs/exec-plans/README.md |

### shared · shared-bridge

Bridge / 渠道插件默认跟官方一起演进，但要保留 fork 的接入配置与策略。

| 文件 |
| --- |
| src/app/api/bridge/feishu/register/cancel/route.ts |
| src/app/api/bridge/feishu/register/poll/route.ts |
| src/app/api/bridge/feishu/register/start/route.ts |
| src/components/bridge/FeishuBridgeSection.tsx |
| src/lib/bridge/feishu-app-registration.ts |
| src/lib/channels/feishu/gateway.ts |
| src/lib/channels/feishu/inbound.ts |
| src/lib/channels/feishu/index.ts |
| src/lib/channels/feishu/resource-downloader.ts |

### shared · shared-chat-runtime

聊天主链路、运行时与 Provider 解析接缝。默认先吸收官方，再以薄适配挂回 fork 能力。

| 文件 |
| --- |
| src/app/api/chat/route.ts |
| src/app/api/setup/route.ts |
| src/hooks/useSSEStream.ts |
| src/lib/agent-loop.ts |
| src/lib/claude-client.ts |
| src/lib/claude-home-shadow.ts |
| src/lib/claude-settings.ts |
| src/lib/context-compressor.ts |
| src/lib/context-pruner.ts |
| src/lib/db.ts |
| src/lib/error-classifier.ts |
| src/lib/mcp-loader.ts |
| src/lib/message-builder.ts |
| src/lib/openai-oauth.ts |
| src/lib/parallel-safety.ts |
| src/lib/permission-checker.ts |
| src/lib/permission-registry.ts |
| src/lib/provider-catalog.ts |
| src/lib/provider-doctor.ts |
| src/lib/provider-presence.ts |
| src/lib/provider-resolver.ts |
| src/lib/runtime/legacy.ts |
| src/lib/runtime/native-runtime.ts |
| src/lib/runtime/registry.ts |
| src/lib/runtime/sdk-runtime.ts |
| src/lib/safe-stream.ts |
| src/lib/sdk-subprocess-env.ts |
| src/lib/skill-nudge.ts |
| src/lib/stream-session-manager.ts |
| src/lib/subdirectory-hint-tracker.ts |

### shared · shared-chat-ui

聊天输入、权限弹窗和会话交互 UI 随官方演进，但允许少量 fork 交互增强。

| 文件 |
| --- |
| src/app/chat/page.tsx |
| src/components/ai-elements/tool-actions-group.tsx |
| src/components/chat/ChatView.tsx |
| src/components/chat/MessageInput.tsx |
| src/components/chat/MessageInputParts.tsx |
| src/components/chat/MessageList.tsx |
| src/components/chat/PermissionPrompt.tsx |
| src/components/chat/RuntimeBadge.tsx |
| src/components/chat/StreamingMessage.tsx |
| src/components/settings/CliSettingsSection.tsx |
| src/hooks/useCommandBadge.ts |
| src/hooks/useSlashCommands.ts |
| src/lib/message-input-logic.ts |
