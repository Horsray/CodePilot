## CodePilot v0.44.0

> Buddy 游戏化全面升级：3D 视觉体系、心跳双模式、后台通知、调度器健壮性修复，以及 54 个新增测试。

### 新增功能

- Buddy 宠物全面使用 3D Fluent Emoji 图片替代系统 emoji，覆盖 Wizard 揭晓、聊天空状态、新建聊天入口、侧栏推广卡、看板 Buddy 卡
- 稀有度渐变背景和胶囊标签，视觉上从灰/绿/蓝/紫/金区分 5 个等级
- 助理空会话展示 Buddy 3D 形象（有 Buddy）或 3D 蛋图（无 Buddy），非助理项目保持 CodePilot logo
- 看板 Buddy 卡重新设计：紧凑状态行、进化按钮反馈、设置按钮内联
- 心跳系统支持"软心跳"模式：在普通对话中自然顺带做日常检查，不打断用户
- 后台无窗口时（tray-only 模式），定时任务通知仍能弹出系统通知，点击恢复窗口
- 定时任务调度器支持冷启动自动恢复（不再依赖首次聊天触发）
- Buddy 重置时自动清理 soul.md 中的旧性格描述

### 修复问题

- 修复心跳指令可能混入普通对话的问题
- 修复 Buddy 领养引导和心跳检查可能同时触发的冲突
- 修复工作区内 symlink 可以绕过路径校验读取外部文件的安全漏洞
- 修复 session-only 循环任务到期后每 10 秒重复执行的问题
- 修复 session-only 任务无法列出和取消的问题
- 修复 session-only 任务失败后不退避、不自动禁用的问题
- 修复 low/normal 优先级通知被静默吞掉的问题
- 修复 MCP 工具硬编码 localhost:3000 导致 worktree 和打包环境失效的问题
- 修复自动记忆提取的"本轮已写入"检查失效的问题
- 修复记忆提取计数器跨会话串线的问题
- 修复 cron 表达式解析器对周/月级调度计算错误的问题（扩展到 4 年扫描）
- 修复不可能的 cron 表达式（如 2 月 30 日）会设置错误执行时间的问题

### 优化改进

- 心跳触发判定统一到服务端 API，前端不再重复实现
- 通知系统新增服务端队列，前端 5 秒轮询显示 Toast + 系统通知
- Electron 通知优先走 IPC 原生桥（支持点击回到窗口），浏览器 Notification 仅作开发模式 fallback
- 定时任务创建和调度共用同一份 cron/interval 解析函数，消除重复实现
- 新增 54 个单元测试覆盖 cron 解析、记忆提取计数器、心跳标记清理、通知队列、后台通知解析

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.44.0/CodePilot-0.44.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.44.0/CodePilot-0.44.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.44.0/CodePilot-Setup-0.44.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
