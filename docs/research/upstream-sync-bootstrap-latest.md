# Upstream Sync Bootstrap

- upstream remote: `upstream`
- upstream ref: `upstream/main`
- current branch: `rescue/recover-lost-work-20260413`
- latest upstream tag: `v0.50.3`
- sync branch: `未自动创建`
- report: `docs/research/upstream-sync-report-latest.md`

## Ownership Check

```text
# Fork Ownership Check

> 中文注释：功能名称「fork 差异边界检查」。
> 用法：开发前或提交前运行 `npm run sync:ownership`，确认当前工作区改动是否落在预期的 fork/shared/core 边界内。

| 归属 | 规则 | 文件数 | 示例文件 |
| --- | --- | --- | --- |
| core | core-platform | 3 | package.json<br/>src/i18n/en.ts<br/>src/i18n/zh.ts |
| core | core-sync-governance | 8 | AGENTS.md<br/>CLAUDE.md<br/>fork-sync-playbook.md |
| core | core-tests | 2 | src/__tests__/unit/session-search.test.ts<br/>src/__tests__/unit/feishu-app-registration.test.ts |
| core | core-tools | 4 | src/lib/builtin-tools/index.ts<br/>src/lib/tools/ask-user-question.ts<br/>src/lib/builtin-tools/ask-user-question.ts |
| ignore | ignore-docs-and-temp | 6 | docs/handover/README.md<br/>docs/insights/README.md<br/>docs/exec-plans/active/v0502-merge-plan.md |
| shared | shared-bridge | 7 | src/components/bridge/FeishuBridgeSection.tsx<br/>src/lib/channels/feishu/gateway.ts<br/>src/lib/channels/feishu/inbound.ts |
| shared | shared-chat-ui | 3 | src/components/chat/MessageInput.tsx<br/>src/components/chat/PermissionPrompt.tsx<br/>src/hooks/useSlashCommands.ts |
| unknown | unmapped | 1 | fork-patches.manifest.json |

发现未映射文件，请补充 fork-ownership-map.json。
```

> 中文注释：功能名称「upstream 同步 bootstrap」。
> 用法：运行 `npm run sync:bootstrap` 或 `npm run sync:bootstrap:branch`，自动完成 fetch upstream、生成差异报告、执行 ownership 边界检查。