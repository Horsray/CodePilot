# 服务商编辑路由修复

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 根因定位 | ✅ 已完成 | 已确认已连接中转平台被错误匹配到 Google Gemini 官方 preset |
| Phase 1 | 修复编辑入口与列表展示 | ✅ 已完成 | 前后端 preset fallback 已按官方 Gemini / 中转站分流 |
| Phase 2 | 验证与归档 | ✅ 已完成 | `npm run typecheck` 通过，浏览器验证完成 |

## 决策日志

- 2026-04-08: `provider_type === gemini-image` 不能再直接映射为 Google 官方 preset，必须结合 `base_url` 判断是否为官方 Gemini。
- 2026-04-08: 中转平台不应只在“连接时”可编辑，已连接列表中的编辑入口必须保留对 base URL 和模型列表的维护能力。

## 详细设计

- `provider-presets.tsx`
  - `findMatchingPreset(...)` 对 `gemini-image` provider 改为按 `base_url` 分流：官方 Gemini -> `gemini-image`，非官方 -> `custom-media`。
- `provider-catalog.ts`
  - `findPresetForLegacy(...)` 同步采用同样的分流，避免设置页之外的后端逻辑继续误判。
- `ProviderManager.tsx`
  - 已连接中转平台卡片增加 endpoint 摘要，降低“看起来像官方 Gemini”的误导。

## 验收标准

- 点击已连接的“通用中转平台”编辑按钮，会打开带 `名称 / Base URL / 模型列表` 的中转平台表单，而不是 Google 官方简化表单。
- 已连接列表中能看到中转平台的 endpoint 摘要。
- `npm run typecheck` 通过，浏览器验证编辑弹窗字段正确显示且无新报错。

## 验证记录

- 2026-04-08: `npm run typecheck` 通过。
- 2026-04-08: 浏览器验证通过。
  - 已连接的中转 provider 列表项可见 `Endpoint: https://relay.example.com/v1/images/generations`
  - 点击编辑后弹窗显示 `名称 / Base URL / 模型列表`
  - 模型列表 textarea 回显为 `e2e-model-a\ne2e-model-b`
  - 截图：`tmp/provider-edit-routing-fix.png`
