# 生图服务选择与错误可见性修复

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状排查 + 根因确认 | ✅ 已完成 | 已确认生图后端按固定顺序自动选 provider，前端无法感知目标服务 |
| Phase 1 | 增加媒体 provider 列表接口与显式选择 | ✅ 已完成 | 生成卡片已暴露 Google / 中转站选择，并向后端显式传入 providerId |
| Phase 2 | 错误文案增强与回归验证 | ✅ 已完成 | 错误已附带 provider 名称，浏览器验证通过 |

## 决策日志

- 2026-04-08: 当前 `/api/media/generate` 会先选 `generic-image`，没有再退到 `gemini-image`，但这一策略对用户完全不可见，导致 quota / 配额问题很难定位。
- 2026-04-08: 生图服务选择不应继续隐藏在后端默认逻辑里，图片确认卡片需要让用户明确知道“请求将发往哪里”。
- 2026-04-08: 复用现有 provider 配置源，不新增独立设置表；媒体 provider 列表由现有 `api_providers` 推导。

## 详细设计

### 目标

- 在设计 agent 的图片生成确认卡片中展示当前生图服务。
- 支持从已配置的媒体 provider 中手动切换服务。
- 当 Google 或中转站失败时，错误信息中明确标出实际使用的 provider。

### 已确认根因

- `src/lib/image-generator.ts` 当前固定优先选择 `generic-image`，否则退到 `gemini-image`。
- `src/app/api/media/generate/route.ts` 没有接收 `providerId`，因此前端无法声明目标服务。
- `src/components/chat/ImageGenConfirmation.tsx` 只允许编辑 prompt / ratio / resolution，没有展示生图服务。

### 方案

- 新增媒体 provider 列表接口，返回已配置的 `gemini-image` / `generic-image` 服务及模型信息。
- `ImageGenConfirmation` 加载媒体 provider 列表，展示当前默认服务，并允许手动选择。
- `/api/media/generate` 接收 `providerId` 并透传给 `generateSingleImage(...)`。
- `image-generator` 按 `providerId` 精确选择服务；错误抛出时附带 provider 名称，便于前端展示。
- 兼容 Google 官方与中转站共用 `gemini-image` 协议的情况，不再用“是否有 base_url”这种不稳定规则来判断服务类型。

### 验收标准

- 图片生成卡片里能明确看到当前服务商名称。
- 已配置多个媒体 provider 时，可以切换 Google / 中转站后再生成。
- provider 失败时，报错中明确包含服务商名称。
- `npm run typecheck` 通过，浏览器实际验证卡片渲染与切换逻辑正常。
