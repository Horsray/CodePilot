## CodePilot v0.53.0

> 设计 Agent 新增 OpenAI GPT Image 2 图像生成能力，同时给 Nano Banana 和 GPT Image 都加上"第三方兼容 API"选项——有中转代理的用户不用再改代码。配套补齐模型选择、实时模型标识、2K/4K 尺寸支持、第三方连接测试等一圈可见性改进。

### 新增功能

- **OpenAI GPT Image 2 图像生成** — 设计 Agent 的服务商列表里新增 OpenAI (Image) 一档，支持 GPT Image 2 / 1.5 / 1 / 1-mini 四个模型。GPT Image 2 尺寸按官方规格算真实的像素比：1:1/16:9/9:16/3:2/2:3/4:3/3:4/4:5/5:4/21:9 十个比例 × 1K/2K/4K 三档分辨率，每一档都会尊重你选的比例而不是套用老三档（1024×1024 / 1536×1024 / 1024×1536）。支持参考图（垫图）走 `/v1/images/edits` 端点，连续编辑不再被丢弃
- **媒体服务商第三方兼容** — Nano Banana 和 GPT Image 都多了"Third-party"预设，只需要填 Base URL 和 Key，其他配置完全照搬官方。现在可以把图像生成走自己架设的 OpenAI 兼容 / Gemini 兼容代理
- **当前图像模型实时显示** — 聊天里的"图片生成"卡片右上角会显示当前要用的模型和服务商（比如"GPT Image 2 · OpenAI (Image)"）。当默认服务商缺 Key 或被改过类型时会显示琥珀色提示，点一下跳到设置页
- **"图片生成默认"服务商标记** — 同时配了多个图像服务商的用户，现在可以在设置里一键把某一行设为"用于图片生成"。点某个服务商下的模型胶囊按钮会自动把那一行标为默认

### 优化改进

- **设计 Agent 选型更确定** — 原先同时配置多个图像服务商时由数据库行顺序决定用哪个，行为不可控。现在走"显式 providerId → 模型名家族前缀 → 用户设定的默认 → 优先 Gemini 兼容"四步优先级，每一步都可预测
- **第三方媒体服务商连接测试正确路由** — 之前 OpenAI/Gemini 图像服务商的"测试连接"按钮跑的是 Anthropic `/v1/messages` 探针，对这两个服务永远失败。现在 OpenAI Image 走 `GET /v1/models` + Bearer，Gemini Image 走 `GET /v1beta/models?key=...`，第三方配置也能真实验证
- **服务商 Base URL 精确匹配加上协议隔离** — 加入 GPT Image 后 `https://api.openai.com/v1` 同时属于多个预设。之前聊天用的 openai-compatible 服务商在这个 URL 下会错误继承 GPT Image 模型目录，现在精确匹配会检查协议一致性
- **第三方媒体服务商强制要求 Base URL** — 创建和编辑时如果 OpenAI/Gemini Image 的 Base URL 为空会被拦下并提示。之前留空会静默回落到官方端点，让"第三方配置"形同虚设
- **失效默认图像服务商有清理入口** — 默认图像服务商的行被删除、类型被改成非媒体类型、或 Key 被清空时，服务商设置页会显示一条琥珀色提示 + 清除按钮。后端也会在删除/改类型时自动清理设置，两边兜底

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.53.0/CodePilot-0.53.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.53.0/CodePilot-0.53.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.53.0/CodePilot.Setup.0.53.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
