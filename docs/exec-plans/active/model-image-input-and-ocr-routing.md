# 模型图片输入能力与 OCR 路由

> 创建时间：2026-10-08  
> 最后更新：2026-10-08

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 能力与现状核实 | ✅ 已完成 | 官方资料确认 MiMo、MiniMax、DeepSeek 的模型级差异；项目无 OCR 实现。 |
| Phase 1 | 模型能力解析与预设回填 | ✅ 已完成 | 复用 `capabilities.vision`，并兼容历史 DB 模型行。 |
| Phase 2 | OCR 配置与服务 | ✅ 已完成 | 使用用户配置的视觉模型作 OCR。 |
| Phase 3 | 聊天分流、UI 与验证 | ✅ 已完成 | 视觉直传 / OCR 文本降级 / 未配置阻止；单元、类型与设置页已验证。 |

## 决策日志

- 2026-10-08：能力按模型而非服务商整体判定；同一服务商可同时包含支持与不支持视觉的模型。
- 2026-10-08：OCR 不引入本地二进制，使用用户配置的视觉模型，避免打包 Tesseract/语言模型并保持中文识别质量。
- 2026-10-08：未知能力不静默上传图片；需要显式配置，防止文本模型收到不兼容的多模态请求。

## 详细设计

### 数据与解析

沿用 `provider_models.capabilities_json` 和 catalog 的 `capabilities.vision`。内置已验证模型填默认值；自定义服务商使用 provider options 中的默认图片输入策略作为目录未识别模型的兜底。

### 分流

聊天路由在保存与调用 runtime 之前判断实际解析到的 provider + model：`vision=true` 保留原图；`vision=false` 调用已配置 OCR 模型并将结果作为文本附加到用户消息，同时标记图片只用于界面和历史展示，禁止在当前及后续历史回放中再次传给文本模型；未知能力返回可操作的配置错误。

### OCR

新增独立服务，以 Vercel AI SDK 调用指定 provider/model 并发送图片内容，要求仅转录可见文字、保留阅读顺序。OCR provider/model 缺失或其模型无视觉能力时，拒绝请求并提示配置，而不是回退到当前文本模型。

### 验收

- catalog 中 MiMo、MiniMax、DeepSeek 的已知模型能力准确；
- capability resolver 对 catalog、用户覆盖、未知模型分别返回确定策略；
- OCR 分流不会把原图再次送入 native history 或 SDK stream；
- 单元测试覆盖上述行为，`npm run test` 通过；UI 改动在本地应用中验证。
