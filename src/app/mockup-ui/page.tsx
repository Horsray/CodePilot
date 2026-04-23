import { SubAgentTimeline } from '@/components/chat/SubAgentTimeline';

export default function MockupPage() {
  const subAgents: any[] = [
    {
      id: 'task-search',
      name: 'search',
      displayName: '探索者',
      prompt: '探索代码库并收集相关上下文，了解 Next.js Standalone 模式和 413 Payload Too Large 错误的原因',
      status: 'running',
      startedAt: Date.now() - 15000,
      model: 'claude-3-5-sonnet-20241022',
      progress: `分析目标：定位 413 Payload Too Large 的底层抛出位置
> 准备执行检索工具：Grep 
> 关键字 "Failed to send message"
> 已获取相关路由 /api/chat

正在检索相关 Nginx 和 Standalone server.js 限制配置...
> 准备执行工具: browser_search
> 结果: ✅ 找到 Next.js 官方关于 bodySizeLimit 的文档

分析完毕：
1. App Router 默认没有 1MB 限制
2. Electron 中的 Standalone 模式使用了极简 HTTP Server
3. Nginx / 反向代理默认限制会导致此问题`
    },
    {
      id: 'task-execute',
      name: 'executor',
      displayName: '执行者',
      prompt: '根据探索者的报告，修复前端 stream-session-manager 的错误捕获逻辑，增加 413 拦截',
      status: 'completed',
      startedAt: Date.now() - 45000,
      completedAt: Date.now() - 12000,
      model: 'claude-3-5-sonnet-20241022',
      report: `**💭 思考过程：**
已经定位到 \`src/lib/stream-session-manager.ts\`。需要在捕获 413 时提供友好的错误提示。

**🛠️ 工具执行 (1 次)：**
- ✅ 编辑了文件 stream-session-manager.ts，成功添加了状态码拦截判断。

**📝 最终输出：**
成功修复了 Frontend 捕获逻辑，413 错误现在会向用户提示"请求体积过大：发送的消息、附件或提及的文件过多"。`
    }
  ];

  return (
    <div className="p-8 max-w-3xl mx-auto bg-background min-h-screen">
      <div className="mb-4 text-xl font-bold border-b pb-2">团队模式 UI 渲染预览</div>
      <SubAgentTimeline subAgents={subAgents} />
    </div>
  );
}
