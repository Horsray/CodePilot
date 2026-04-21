# Upstream Sync Report

- 仓库根目录：`/Users/horsray/Documents/codepilot/CodePilot`
- 上游引用：`upstream/main`
- 当前分支：`sync/v0.52.1-artifact-preview`

## Summary

| 项目 | 值 |
| --- | --- |
| 共同基线 | 85f7f0647d6061f3c8166176a860f8b5c99848b2 |
| fork 独有文件 | 322 |
| 官方独有文件 | 27 |
| 双边都改 | 22 |

> 中文注释：功能名称「upstream 差异报告」。
> 用法：同步官方前先运行 `npm run sync:report`，把官方独有、fork 独有、双边都改按 ownership map 自动归类，减少人工逐个 diff 的成本。

## Fork Exclusive

### core · core-agent-infra

Agent 编排、CLI 会话池、通知与性能追踪基础设施默认跟随 upstream。

| 文件 |
| --- |
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
| eslint.config.mjs |
| next.config.ts |
| src/app/api/knowledge-base/route.ts |
| src/app/api/utils/open-path/route.ts |
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
| src/components/ui/input-group.tsx |
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
| src/instrumentation.ts |
| src/lib/console-utils.ts |
| src/lib/constants/image-agent-prompt.ts |
| src/lib/knowledge-graph-provider.ts |
| src/types/electron.d.ts |
| tsconfig.json |

### core · core-settings-setup

设置、初始化向导与 MCP 配置界面默认跟随 upstream。

| 文件 |
| --- |
| src/app/api/settings/app/route.ts |
| src/app/api/settings/app/test-lang-opt/route.ts |
| src/app/api/settings/custom-rules/route.ts |
| src/app/api/settings/custom-rules/sync/route.ts |
| src/app/api/settings/workspace/route.ts |
| src/components/layout/InstallWizard.tsx |
| src/components/plugins/McpServerEditor.tsx |
| src/components/settings/AssistantSettingsCard.tsx |
| src/components/settings/AssistantWorkspaceSection.tsx |
| src/components/settings/GeneralSection.tsx |
| src/components/settings/LangOptSettingsSection.tsx |
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
| scripts/build-electron.mjs |
| scripts/check-fork-ownership.mjs |
| scripts/lib/fork-sync-utils.mjs |
| scripts/upstream-sync-bootstrap.mjs |
| scripts/upstream-sync-report.mjs |

### core · core-tests

测试默认跟随实现同步维护。

| 文件 |
| --- |
| src/__tests__/integration/hooks-poc.test.ts |
| src/__tests__/integration/multi-defer-poc.test.ts |
| src/__tests__/integration/warm-query-poc.test.ts |
| src/__tests__/unit/agent-loop-messages.test.ts |
| src/__tests__/unit/agent-timeline.test.ts |
| src/__tests__/unit/assistant-workspace.test.ts |
| src/__tests__/unit/claude-settings-credentials.test.ts |
| src/__tests__/unit/cli-tools-mcp.test.ts |
| src/__tests__/unit/file-checkpoint.test.ts |
| src/__tests__/unit/file-review-cards.test.ts |
| src/__tests__/unit/message-builder.test.ts |
| src/__tests__/unit/message-content-sanitizer.test.ts |
| src/__tests__/unit/model-context.test.ts |
| src/__tests__/unit/native-runtime.test.ts |
| src/__tests__/unit/permission-registry-polling.test.ts |
| src/__tests__/unit/persistent-claude-session.test.ts |
| src/__tests__/unit/project-mcp-injection.test.ts |
| src/__tests__/unit/provider-preset.test.ts |
| src/__tests__/unit/provider-resolver-fixes.test.ts |
| src/__tests__/unit/provider-resolver.test.ts |
| src/__tests__/unit/search-history-tool.test.ts |
| src/__tests__/unit/sse-stream.test.ts |
| src/__tests__/unit/timezone-boundaries.test.ts |
| src/__tests__/unit/working-directory.test.ts |

### core · core-tools

工具注册层与内置工具默认跟随 upstream，fork 只允许在注册接缝做薄扩展。

| 文件 |
| --- |
| src/lib/builtin-tools/ask-user-question.ts |
| src/lib/builtin-tools/cli-tools.ts |
| src/lib/builtin-tools/mcp-activate.ts |
| src/lib/builtin-tools/memory-search.ts |
| src/lib/builtin-tools/skill-create.ts |
| src/lib/tools/agent.ts |
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
| src/app/api/files/raw/route.ts |
| src/app/api/files/revert/route.ts |
| src/components/project/EnhancedFileTree.tsx |
| src/components/project/TaskList.tsx |

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
| src/components/git/GitCommitSection.tsx |
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
| src/app/api/providers/[id]/route.ts |
| src/app/api/providers/models/route.ts |
| src/app/api/providers/route.ts |
| src/components/settings/PresetConnectDialog.tsx |
| src/components/settings/ProviderForm.tsx |
| src/components/settings/ProviderManager.tsx |
| src/components/settings/provider-presets.tsx |
| src/lib/cc-switch.ts |

### fork · fork-tabs-and-browser

顶部标签、统一工作区、内置浏览器与相关 Hook。

| 文件 |
| --- |
| src/components/layout/UnifiedTopBar.tsx |

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

### fork · fork-workspace

Assistant Workspace 增强、心跳、检索与模板。

| 文件 |
| --- |
| src/lib/assistant-workspace.ts |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| .playwright-mcp/console-2026-04-11T20-54-29-907Z.log |
| .playwright-mcp/console-2026-04-11T21-44-37-198Z.log |
| .playwright-mcp/console-2026-04-11T21-45-00-663Z.log |
| .playwright-mcp/console-2026-04-17T16-33-21-889Z.log |
| .playwright-mcp/console-2026-04-17T16-33-56-167Z.log |
| .playwright-mcp/console-2026-04-17T16-34-15-658Z.log |
| .playwright-mcp/console-2026-04-17T16-46-50-275Z.log |
| .playwright-mcp/console-2026-04-17T16-47-02-058Z.log |
| .playwright-mcp/console-2026-04-17T16-47-35-967Z.log |
| .playwright-mcp/console-2026-04-19T10-49-45-512Z.log |
| .playwright-mcp/console-2026-04-19T10-49-51-060Z.log |
| .playwright-mcp/page-2026-04-09T14-48-25-998Z.png |
| .playwright-mcp/page-2026-04-10T16-28-53-225Z.png |
| .playwright-mcp/page-2026-04-11T20-54-32-439Z.yml |
| .playwright-mcp/page-2026-04-11T21-44-40-282Z.yml |
| .playwright-mcp/page-2026-04-11T21-45-13-449Z.yml |
| .playwright-mcp/page-2026-04-11T21-45-17-039Z.png |
| .playwright-mcp/page-2026-04-17T16-33-32-039Z.yml |
| .playwright-mcp/page-2026-04-17T16-34-03-752Z.yml |
| .playwright-mcp/page-2026-04-17T16-34-22-017Z.yml |
| .playwright-mcp/page-2026-04-17T16-34-27-856Z.yml |
| .playwright-mcp/page-2026-04-17T16-46-52-708Z.yml |
| .playwright-mcp/page-2026-04-17T16-46-57-779Z.yml |
| .playwright-mcp/page-2026-04-17T16-47-12-030Z.yml |
| .playwright-mcp/page-2026-04-17T16-47-18-007Z.yml |
| .playwright-mcp/page-2026-04-17T16-47-39-212Z.yml |
| .playwright-mcp/page-2026-04-17T16-47-44-524Z.yml |
| .playwright-mcp/page-2026-04-17T16-47-53-632Z.yml |
| .playwright-mcp/page-2026-04-19T10-49-46-666Z.yml |
| .playwright-mcp/page-2026-04-19T10-49-51-456Z.yml |
| .trae/rules/git-commit-message.md |
| .trae/rules/rules.md |
| build.md |
| build/icon-original.png |
| build/icon.png |
| current-ui-settings.png |
| docs/exec-plans/active/agent-sdk-0-2-111-adoption.md |
| docs/exec-plans/active/agent-timeline-runtime-rebuild.md |
| docs/exec-plans/active/chat-ui-performance-integration.md |
| docs/exec-plans/active/commercial-agent-upgrade.md |
| docs/exec-plans/active/hermes-unified-memory-system.md |
| docs/exec-plans/active/scheduled-task-refactor.md |
| docs/exec-plans/active/trae-style-agent-activity.md |
| docs/exec-plans/active/v0502-merge-plan.md |
| docs/handover/fork-sync-mechanism.md |
| docs/insights/fork-sync-mechanism.md |
| docs/research/README.md |
| docs/research/upstream-sync-bootstrap-latest.md |
| docs/research/upstream-sync-report-latest.md |
| docs/research/upstream-v0.51.1-absorption-plan.md |
| premium-ui.html |
| public/icons/toplogo.png |
| test-api.ts |
| test-peek.js |
| tmp/browser-shots/screenshot-1775773968242.png |
| tmp/browser-shots/screenshot-1775773989474.png |
| tmp/browser-shots/screenshot-1775799641550.png |

### shared · shared-bridge

Bridge / 渠道插件默认跟官方一起演进，但要保留 fork 的接入配置与策略。

| 文件 |
| --- |
| src/app/api/bridge/chat/route.ts |
| src/lib/bridge/bridge-manager.ts |
| src/lib/bridge/channel-router.ts |
| src/lib/bridge/conversation-engine.ts |
| src/lib/channels/feishu/inbound.ts |

### shared · shared-chat-runtime

聊天主链路、运行时与 Provider 解析接缝。默认先吸收官方，再以薄适配挂回 fork 能力。

| 文件 |
| --- |
| src/app/api/chat/background/route.ts |
| src/app/api/chat/interrupt/route.ts |
| src/app/api/chat/perf/route.ts |
| src/app/api/chat/review/route.ts |
| src/app/api/chat/route.ts |
| src/app/api/chat/search/route.ts |
| src/app/api/chat/sessions/[id]/route.ts |
| src/app/api/chat/sessions/route.ts |
| src/hooks/useSSEStream.ts |
| src/lib/agent-loop.ts |
| src/lib/claude-client.ts |
| src/lib/claude-settings.ts |
| src/lib/context-assembler.ts |
| src/lib/db.ts |
| src/lib/diff-utils.ts |
| src/lib/file-checkpoint.ts |
| src/lib/mcp-loader.ts |
| src/lib/message-builder.ts |
| src/lib/message-normalizer.ts |
| src/lib/permission-checker.ts |
| src/lib/permission-registry.ts |
| src/lib/provider-catalog.ts |
| src/lib/provider-doctor.ts |
| src/lib/provider-resolver.ts |
| src/lib/runtime/native-runtime.ts |
| src/lib/runtime/sdk-runtime.ts |
| src/lib/runtime/types.ts |
| src/lib/sdk-subprocess-env.ts |
| src/lib/stream-session-manager.ts |

### shared · shared-chat-ui

聊天输入、权限弹窗和会话交互 UI 随官方演进，但允许少量 fork 交互增强。

| 文件 |
| --- |
| src/app/chat/page.tsx |
| src/components/ai-elements/conversation.tsx |
| src/components/ai-elements/tool-actions-group.tsx |
| src/components/chat/ChatView.tsx |
| src/components/chat/FileReviewBar.tsx |
| src/components/chat/MessageInput.tsx |
| src/components/chat/MessageInputParts.tsx |
| src/components/chat/MessageList.tsx |
| src/components/chat/PermissionPrompt.tsx |
| src/components/chat/ReferencedContexts.tsx |
| src/components/chat/StreamingMessage.tsx |
| src/components/chat/TimelineFinalSummary.tsx |
| src/components/layout/ChatListPanel.tsx |
| src/components/settings/CliSettingsSection.tsx |
| src/hooks/useProviderModels.ts |

### unknown · unmapped

未命中 ownership map，需要人工补规则。

| 文件 |
| --- |
| .agents/skills/feishu-bitable/SKILL.md |
| .agents/skills/feishu-bitable/references/examples.md |
| .agents/skills/feishu-bitable/references/field-properties.md |
| .agents/skills/feishu-bitable/references/record-values.md |
| .agents/skills/feishu-calendar/SKILL.md |
| .agents/skills/feishu-channel-rules/SKILL.md |
| .agents/skills/feishu-channel-rules/references/markdown-syntax.md |
| .agents/skills/feishu-create-doc/SKILL.md |
| .agents/skills/feishu-fetch-doc/SKILL.md |
| .agents/skills/feishu-im-read/SKILL.md |
| .agents/skills/feishu-task/SKILL.md |
| .agents/skills/feishu-troubleshoot/SKILL.md |
| .agents/skills/feishu-update-doc/SKILL.md |
| .agents/skills/omc-reference/SKILL.md |
| .diff_agent_loop |
| .diff_api_chat_route |
| .diff_api_chat_route_staged |
| .diff_tool_actions_group |
| build/icon.icns |
| build/icon.ico |
| playwright.config.ts |
| src/__tests__/e2e/mention-picker-style.spec.ts |
| src/app/api/chat/optimize-prompt/route.ts |
| src/app/api/chat/permission/route.ts |
| src/app/api/plugins/mcp/route.ts |
| src/app/api/plugins/mcp/servers/route.ts |
| src/app/api/tasks/[id]/logs/route.ts |
| src/app/api/tasks/list/route.ts |
| src/app/api/tasks/schedule/route.ts |
| src/app/api/uploads/route.ts |
| src/app/api/workspace/events/route.ts |
| src/app/chat/[id]/page.tsx |
| src/app/favicon.ico |
| src/app/scheduled-tasks/page.tsx |
| src/components/ai-elements/prompt-input.tsx |
| src/components/chat/AgentTimeline.tsx |
| src/components/chat/ContextUsageIndicator.tsx |
| src/components/chat/ImageGenToggle.tsx |
| src/components/chat/WidgetRenderer.tsx |
| src/components/layout/ProjectGroupHeader.tsx |
| src/components/layout/SessionListItem.tsx |
| src/components/layout/panels/GitPanel.tsx |
| src/hooks/useContextUsage.ts |
| src/hooks/useStreamSubscription.ts |
| src/lib/context-estimator.ts |
| src/lib/mcp-tool-adapter.ts.patch |
| src/lib/memory-extractor.ts |
| src/lib/message-content-sanitizer.ts |
| src/lib/model-context.ts |
| src/lib/notification-mcp.ts |
| src/lib/persistent-claude-session.ts |
| src/lib/task-scheduler.ts |
| src/lib/todo-mcp.ts |
| src/lib/working-directory.ts |
| src/store/usePanelStore.ts |
| src/stores/panelStore.ts |
| test-proxy.mjs |

## Upstream Exclusive

### core · core-platform

平台与公共配置默认跟随 upstream。

| 文件 |
| --- |
| RELEASE_NOTES.md |

### core · core-settings-setup

设置、初始化向导与 MCP 配置界面默认跟随 upstream。

| 文件 |
| --- |
| src/components/setup/SetupCenter.tsx |

### fork · fork-file-tree

增强文件树、文件操作与对应面板。

| 文件 |
| --- |
| src/app/api/files/mkdir/route.ts |
| src/app/api/files/preview/route.ts |

### fork · fork-provider-overlay

CC Switch、OLMX 与 Provider 预设扩展。

| 文件 |
| --- |
| src/components/setup/ProviderCard.tsx |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| docs/exec-plans/completed/markdown-artifact-overhaul.md |
| docs/handover/markdown-artifact-overhaul.md |
| docs/insights/markdown-artifact-overhaul.md |
| docs/research/phase-0-pocs/0.2-streamdown-lru-check.md |
| docs/research/phase-0-pocs/0.3-long-shot-export.md |
| docs/research/phase-0-pocs/0.4-codemirror-integration.md |
| docs/research/phase-0-pocs/0.5-sandpack-integration.md |
| docs/research/phase-0-pocs/0.6-diffsummary-design.md |
| docs/research/phase-0-pocs/0.7-preview-source-migration.md |
| docs/research/phase-0-pocs/0.8-streamdown-remark-check.md |

### shared · shared-chat-runtime

聊天主链路、运行时与 Provider 解析接缝。默认先吸收官方，再以薄适配挂回 fork 能力。

| 文件 |
| --- |
| src/app/api/setup/route.ts |

### unknown · unmapped

未命中 ownership map，需要人工补规则。

| 文件 |
| --- |
| src/__tests__/helpers.ts |
| src/components/ai-elements/code-block.tsx |
| src/components/chat/DiffSummary.tsx |
| src/components/editor/DataTableViewer.tsx |
| src/components/editor/MarkdownEditor.lazy.tsx |
| src/components/editor/MarkdownEditor.tsx |
| src/components/editor/SandpackPreview.tsx |
| src/components/layout/PanelZone.tsx |
| src/components/skills/SkillEditor.tsx |
| src/lib/artifact-export.ts |
| src/lib/files.ts |

## Both Changed

### core · core-platform

平台与公共配置默认跟随 upstream。

| 文件 |
| --- |
| electron/preload.ts |
| package-lock.json |
| package.json |
| src/app/globals.css |
| src/i18n/en.ts |
| src/i18n/zh.ts |
| src/types/index.ts |

### fork · fork-file-tree

增强文件树、文件操作与对应面板。

| 文件 |
| --- |
| src/app/api/files/delete/route.ts |
| src/app/api/files/rename/route.ts |
| src/app/api/files/write/route.ts |
| src/components/ai-elements/file-tree.tsx |
| src/components/layout/panels/FileTreePanel.tsx |
| src/components/project/FileTree.tsx |

### fork · fork-tabs-and-browser

顶部标签、统一工作区、内置浏览器与相关 Hook。

| 文件 |
| --- |
| electron/main.ts |
| src/components/layout/AppShell.tsx |
| src/components/layout/panels/PreviewPanel.tsx |
| src/hooks/usePanel.ts |

### ignore · ignore-docs-and-temp

文档、截图、临时调试产物不参与功能同步决策。

| 文件 |
| --- |
| docs/exec-plans/README.md |
| docs/handover/README.md |
| docs/insights/README.md |

### shared · shared-chat-ui

聊天输入、权限弹窗和会话交互 UI 随官方演进，但允许少量 fork 交互增强。

| 文件 |
| --- |
| src/components/ai-elements/message.tsx |
| src/components/chat/MessageItem.tsx |
