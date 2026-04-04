## CodePilot v0.47.0

> 服务商系统全面治理，新增连接测试和匿名错误上报，品牌重定位为多模型 AI Agent 桌面客户端。

### 新增功能

- 服务商配置新增"测试连接"按钮：填完 API Key 后立即验证是否能连通，不用发消息才发现配置有误
- 服务商配置新增引导面板：显示计费模式标签、API Key 获取链接、配置注意事项
- 新增匿名错误上报（Sentry）：帮助开发者定位高频问题，默认开启，可在设置中关闭
- 新增服务商模型管理 API：支持为每个服务商自定义添加/删除模型
- 新增小米 MiMo 服务商（按量付费 + Token Plan 两种模式）

### 修复问题

- 修复智谱 GLM、Moonshot、OpenRouter、百炼等 6 个服务商的认证方式配置错误，大幅减少首次连接失败
- 修复用户终端 Claude Code 的 settings.json 配置覆盖 CodePilot 服务商选择的问题
- 修复运行时报错缺少恢复操作建议的问题，现在会显示"重新获取 Key"等可点击链接
- 修复模型选择下拉框出现横向滚动条的问题
- 修复"管理服务商"按钮跳转到通用设置而非服务商页面的问题
- 修复 Kimi 使用了错误的认证头（Bearer 而非 X-Api-Key）的问题

### 优化改进

- 品牌重定位：从"Claude Code 桌面 GUI"更新为"多模型 AI Agent 桌面客户端"
- README 全面重构（中/英/日三语）：新增下载量和 Stars badges，下载区前置，17+ 服务商表格
- 服务商系统新增 Zod Schema 校验：防止无效配置上线，新增 61 个自动化测试
- 服务商配置页去除 230 行重复代码，统一为单一数据源
- 官网服务商文档更新：修正国内服务商表格，新增各服务商注意事项
- GitHub About 描述和联系方式更新

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.47.0/CodePilot-0.47.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.47.0/CodePilot-0.47.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.47.0/CodePilot.Setup.0.47.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / 智谱 / Kimi / Ollama 等）
- 推荐安装 Claude Code CLI 以获得完整功能
