# Trae 风格 Agent 活动可视化执行计划

## 目标

在聊天对话内提供接近 Trae 的 Agent 活动体验：
- 展示思考、当前过程、结论、是否完成
- 展示 Agent 查看过的上下文、文件、Markdown 文档
- 展示文件修改卡片与可读 diff 预览
- 保持现有聊天流稳定，不改模型核心能力

## 范围

### 第一阶段
- 基于现有 `thinking / tool_use / tool_result / status` 事件，重构对话内活动面板
- 展示上下文来源摘要、文件访问摘要、Markdown 阅读摘要
- 为 `Edit` / `Write` 工具增加对话内 diff 预览卡片
- 优化视觉层次、折叠交互、滚动体验

### 第二阶段
- 评估并接入会话级文件回滚能力
- 将现有 rewind/checkpoint 能力与对话内文件修改卡片打通
- 补充持久化后的消息回放一致性

## 非目标
- 不实现模型供应商未暴露的真实内部推理明细
- 不承诺拿到 100% 精确 token/context 账本；无官方数据时继续用估算并明确标注
- 第一阶段不重做消息存储结构

## 触及文件
- `src/components/ai-elements/tool-actions-group.tsx`
- `src/components/chat/StreamingMessage.tsx`
- `src/components/chat/MessageItem.tsx`（如需复用 UI）
- `src/types/index.ts`（仅在确有必要时扩展）
- `src/app/api/chat/route.ts`（仅在确有必要时补充事件字段）

## 风险
- 流式工具结果结构在不同工具间不统一，diff 预览需要容错
- 不能误导用户把“估算上下文”看成“模型官方真实上下文”
- 不能破坏现有 streaming message 的布局稳定性

## 验证
- `npm run test`
- `npm run dev`
- 通过 chrome-devtools MCP 打开聊天页，验证：
  - 活动面板正常渲染
  - 文件 diff 卡片正常折叠/展开
  - console 无报错

## 进度
- [x] 立项与边界确认
- [x] 第一阶段实现（活动面板 + 上下文分组 + 文件 diff 卡片）
- [x] 本地测试（`npm run test` 已通过）
- [ ] CDP 验证 UI（当前被 `npm run dev` 启动期异常阻塞：`The "path" argument must be of type string. Received undefined`）
- [x] 评估第二阶段回滚接入（仓库已有 user-message 级 rewind 能力，可复用到对话内文件变更卡片）
