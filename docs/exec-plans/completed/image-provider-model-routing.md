# 生图中转模型路由与错误治理

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 中转平台报错根因确认 | ✅ 已完成 | 当前中转分支直接按 JSON 解析，命中 HTML 错误页时会抛 `Unexpected token '<'` |
| Phase 1 | 中转平台多模型配置与选择链路 | ✅ 已完成 | 已贯通设置页、生成卡片与后端请求 |
| Phase 2 | 错误文案增强与验证 | ✅ 已完成 | `npm run typecheck` 通过，浏览器验证通过并生成截图 |

## 决策日志

- 2026-04-08: Google 官方 Gemini 图片服务继续走官方固定模型入口，不给用户暴露自定义模型名，避免偏离官方支持矩阵。
- 2026-04-08: 通用中转平台的模型列表直接复用现有 provider 配置，不新增独立图片模型表，先以 `env_overrides_json.model_names` + `role_models_json.default` 作为配置源。
- 2026-04-08: 中转平台返回 HTML 时，后端需要把上游目标地址和响应类型转成可读错误，而不是把 JSON parse 异常直接透出。

## 详细设计

### 目标

- 当中转平台返回 HTML/网关页/登录页时，用户能直接知道是“服务地址不对或上游返回了网页”。
- 设置页允许为中转平台维护多个模型名称。
- 设计 Agent 的图片生成卡片在选择中转平台后，允许切换模型，并把所选模型显式传到 `/api/media/generate`。
- Google 官方 provider 不显示自定义模型选择，继续沿用官方逻辑。

### 方案

- `PresetConnectDialog`：
  - 将 `custom-media` 的 `model_names` 从单输入扩展为多行文本，按行/逗号解析。
  - 保存时把首个模型写入 `role_models_json.default`，完整列表写入 `env_overrides_json.model_names`。
- `ImageGenConfirmation`：
  - 读取 provider 的 `env_overrides_json` / `role_models_json`。
  - 根据选中 provider 计算模型列表；仅非 Google 官方 provider 展示模型下拉。
  - 请求 `/api/media/generate` 时带上 `providerId` 和 `model`。
- `image-generator`：
  - 官方 Gemini 继续用官方 SDK。
  - 中转平台分支按文本读取响应，先判断 `content-type` / HTML，再解析 JSON，抛出可读错误。

### 验收标准

- 中转平台返回 HTML 时，错误信息不再是 `Unexpected token '<'`，而是包含 provider 名称和响应类型提示。
- 中转平台配置支持多个模型名，重新打开编辑框时能正确回显。
- 图片生成卡片在选中中转平台后出现模型选择器，请求体包含所选 `model`。
- `npm run typecheck` 通过，浏览器实际验证交互与请求参数正常。

## 验证记录

- 2026-04-08: `curl -I https://api.whatai.cc` 返回 `content-type: text/html; charset=utf-8`，确认当前用户配置的根地址会返回网页而不是 JSON API。
- 2026-04-08: `npm run typecheck` 通过。
- 2026-04-08: 浏览器验证通过。
  - 设置页能显示中转 provider 的多模型 badge。
  - 图片生成卡片切换到中转 provider 后会显示模型下拉。
  - 拦截 `/api/media/generate` 验证请求体已包含 `providerId` 和选中的 `model`。
  - 截图：`tmp/image-provider-model-routing.png`
