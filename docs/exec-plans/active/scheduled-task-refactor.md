# 定时任务重构计划 - 进度报告

## 状态：前端新增功能已完成 ✅

### 已完成的后端改动

| 文件 | 改动内容 | 状态 |
|------|----------|------|
| `src/types/index.ts` | 新增 `NotificationChannel`, `ToolAuthorization`, `SessionBinding` 类型 | ✅ |
| `src/lib/db.ts` | 新增数据库字段（notification_channels, session_binding, tool_authorization 等） | ✅ |
| `src/lib/task-scheduler.ts` | 核心重构：使用 SDK 路径（支持 MCP 工具）、从 session 读取 provider 配置、新增多渠道通知 `sendMultiChannelNotification` | ✅ |
| `src/app/api/tasks/schedule/route.ts` | 支持所有新字段，修复时间解析问题 | ✅ |
| `src/app/api/plugins/mcp/servers/route.ts` | **新建** - 返回可用 MCP 服务器列表 | ✅ |

### 已完成的前端改动

| 文件 | 改动内容 | 状态 |
|------|----------|------|
| `src/app/scheduled-tasks/page.tsx` | 重构 CreateTaskDialog：新增通知渠道多选、会话绑定、工具授权选择、活跃时段设置 | ✅ |

---

## 功能说明

### 1. 通知渠道（多选）
- **Toast** - 应用内通知
- **System** - 系统通知
- **Telegram** - 手机推送（需配置 Bot Token）
- **Session** - 写入对话

### 2. 会话绑定
- 不写入任何对话
- 指定对话（从下拉列表选择）

### 3. 工具授权
- **不使用工具** - 纯文本生成
- **全量授权** - 自动使用所有可用 MCP 工具
- **部分授权** - 勾选需要的 MCP 工具

### 4. 活跃时段
- 设置任务执行的允许时间段

---

## 待完成

### 阶段一：邮件系统
| 步骤 | 操作 | 状态 |
|------|------|------|
| 1.1 | 安装 nodemailer | ⏳ |
| 1.2 | 添加邮件配置字段到 settings 表 | ⏳ |
| 1.3 | 实现 `sendEmailNotification` 函数 | ⏳ |
| 1.4 | 集成到 `sendMultiChannelNotification` | ⏳ |
| 1.5 | 前端添加邮件配置界面 | ⏳ |

---

## 测试验证

创建测试任务，验证：
1. ✅ 时间选择正确（系统时间）
2. ✅ 通知渠道选择正确
3. ✅ 会话绑定正确（消息写入指定 session）
4. ✅ 工具授权正确（MCP 工具可用）
5. ⏳ Telegram 通知（需配置 Bot）
6. ⏳ 邮件通知（需配置 SMTP）