# 生图中转接口地址与协议适配

> 创建时间：2026-04-08
> 最后更新：2026-04-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | WhatAI / 中转站协议调研 | ✅ 已完成 | 已确认 WhatAI 文档区分 Base URL 与实际 POST path，且并非所有中转都使用同一生图协议 |
| Phase 1 | 设置与编辑界面扩展 | ✅ 已完成 | `custom-media` 已支持维护接口协议与接口地址，并在已连接列表展示 |
| Phase 2 | 后端协议适配 | ✅ 已完成 | 已支持 `custom-image` 与 `openai-images` 两类生图 relay 协议 |
| Phase 3 | 验证与归档 | ✅ 已完成 | typecheck、浏览器验证、mock endpoint 验证均已完成 |

## 决策日志

- 2026-04-08: 单独维护 `base_url` 不足以兼容 WhatAI 这类“根地址 + 固定 endpoint path”的平台，必须显式维护接口地址。
- 2026-04-08: 当前设计 agent 的生图链路只落地 `自定义图片接口` 与 `OpenAI-compatible images/generations` 两类协议；`chat/completions` 文档单独存在，但不应作为当前生图默认协议。
- 2026-04-08: 为了兼容旧配置，新字段优先放入 `options_json`，未配置时保持旧逻辑。
- 2026-04-08: 对于 `openai-images` 协议，当用户只提供根域名 `base_url` 时，后端自动补全到 `/v1/images/generations`，避免误打官网首页。
- 2026-04-08: 对 WhatAI 这类已存在的旧配置，在未显式写入 `media_protocol` 时按 host 推断为 `openai-images`，避免用户必须手动重配后才恢复可用。

## 详细设计

- 设置/编辑界面：
  - `custom-media` 增加 `接口类型`、`接口地址（Endpoint Path 或完整 URL）` 字段。
  - WhatAI 之类平台可以配置：
    - Base URL: `https://api.whatai.cc`
    - Endpoint Path: `/v1/images/generations`
    - 协议类型: `openai-images`
- 后端：
  - `options_json` 新增图片中转配置：
    - `media_protocol`
    - `media_endpoint`
  - 发送请求时按协议构造最终 URL 和 payload。
  - `openai-images` 默认请求体包含 `model / prompt / n / response_format / size`，并支持根域名自动补全 endpoint。
- 列表展示：
  - 已连接 provider 卡片同时展示 endpoint 与协议，便于区分。

## 验收标准

- `custom-media` 在新增与编辑时可以维护接口类型与接口地址。
- WhatAI 类配置不会再直接 POST 到站点根地址。
- 旧的自定义图片中转配置无需迁移即可继续工作。
- `npm run typecheck` 通过，浏览器验证表单与请求参数正确。
