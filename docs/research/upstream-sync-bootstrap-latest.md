# Upstream Sync Bootstrap

- upstream remote: `upstream`
- upstream ref: `upstream/main`
- current branch: `integration/v0.50.3-merge`
- latest upstream tag: `v0.51.0`
- sync branch: `未自动创建`
- report: `docs/research/upstream-sync-report-latest.md`

## Ownership Check

```text
# Fork Ownership Check

> 中文注释：功能名称「fork 差异边界检查」。
> 用法：开发前或提交前运行 `npm run sync:ownership`，确认当前工作区改动是否落在预期的 fork/shared/core 边界内。

| 归属 | 规则 | 文件数 | 示例文件 |
| --- | --- | --- | --- |
| ignore | ignore-docs-and-temp | 1 | docs/research/upstream-sync-report-latest.md |
```

> 中文注释：功能名称「upstream 同步 bootstrap」。
> 用法：运行 `npm run sync:bootstrap` 或 `npm run sync:bootstrap:branch`，自动完成 fetch upstream、生成差异报告、执行 ownership 边界检查。