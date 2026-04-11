## CodePilot v0.48.2

> v0.48 系列稳定性修复版 — 主要修复了第三方服务商配置和对话管理的几个关键问题，建议所有 v0.48.x 用户升级。

### 修复问题

- **第三方服务商设为默认后无法使用**：设置阿里云百炼、智谱、OpenRouter 等第三方服务商为默认后，新对话首条消息报 "No provider credentials available" 或进程崩溃的问题。根因是 UI 上的"当前选中"标记被错误地当作"启用/禁用"过滤，导致用户明确设置的默认服务商被忽略
- **编辑第三方服务商后测试连接失败**：之前前端会把编辑对话框里显示的遮罩密钥（`***xxx`）原样发送给服务器做测试，导致一律 401。现在未改动时后端自动从数据库读取真实密钥
- **重命名对话点了没反应**：macOS / Windows 上点击左侧会话列表三点菜单 → 重命名对话后，输入框无法打开的问题（Electron 禁用了 window.prompt）
- **诊断页面的误导性警告**：Claude Code 诊断日志中出现的 "Provider is inactive, re-resolving" 警告实际上是代码逻辑 bug，会让用户误以为配置有问题。已清除
- **切换认证方式后测试使用旧凭证**：服务商编辑对话框切换 API Key / Auth Token 时的状态迁移不一致，可能导致测试连接使用错误凭证

### 新增功能

- **编辑时可以直接测试连接**：编辑已有服务商时，未改动 API Key 也能直接点"测试连接"，自动使用已保存的密钥。之前这种场景按钮是禁用的，用户必须重新输入一遍密钥才能测
- **主动清除已存 API Key**：服务商编辑对话框新增"清除已存密钥"按钮，支持撤销。之前一旦保存就无法删除已存密钥，只能重新输入新值覆盖

### 优化改进

- 会话重命名改用应用内对话框，支持 Enter 提交、Esc 取消、打开时自动全选原标题方便直接替换
- 测试连接按钮状态对齐完整的密钥生命周期：无密钥禁用、保留原密钥可测、标记清除后禁用（避免测试旧密钥却保存新状态的误导性成功）
- 服务商编辑对话框的 API Key 输入框在编辑态显示"已保存，留空则沿用原密钥"提示，不再泄露遮罩字符串

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.48.2/CodePilot-0.48.2-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.48.2/CodePilot-0.48.2-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.48.2/CodePilot.Setup.0.48.2.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
