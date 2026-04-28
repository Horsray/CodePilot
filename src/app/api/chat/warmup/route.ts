import { NextRequest } from 'next/server';
import { getSession, updateSdkSessionId } from '@/lib/db';
import { resolveForClaudeCode } from '@/lib/provider-resolver';
import { prepareSdkSubprocessEnv } from '@/lib/sdk-subprocess-env';
import { resolveWorkingDirectory } from '@/lib/working-directory';
import { findClaudeBinary } from '@/lib/platform';
import {
  warmupPersistentClaudeSession,
  buildPersistentClaudeSignature,
  isSessionWarmedUp,
  getWarmedUpInitData,
} from '@/lib/persistent-claude-session';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { buildSystemPrompt } from '@/lib/agent-system-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 中文注释：解析 Windows .cmd 包装器，提取实际 .js 脚本路径供 SDK 直接调用
function resolveScriptFromCmd(cmdPath: string): string | undefined {
  try {
    const content = fs.readFileSync(cmdPath, 'utf-8');
    const cmdDir = path.dirname(cmdPath);
    const patterns = [
      /"%~dp0\\([^"]*claude[^"]*\.js)"/i,
      /%~dp0\\(\S*claude\S*\.js)/i,
      /"%dp0%\\([^"]*claude[^"]*\.js)"/i,
    ];
    for (const re of patterns) {
      const m = content.match(re);
      if (m) {
        const resolved = path.normalize(path.join(cmdDir, m[1]));
        if (fs.existsSync(resolved)) return resolved;
      }
    }
  } catch { /* ignore read errors */ }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id } = body;

    if (!session_id) {
      return Response.json({ error: 'session_id is required' }, { status: 400 });
    }

    // 中文注释：已预热则直接返回缓存数据，避免重复启动子进程
    if (isSessionWarmedUp(session_id)) {
      const cached = getWarmedUpInitData(session_id);
      return Response.json({ warmed_up: true, from_cache: true, ...cached });
    }

    const session = getSession(session_id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // 中文注释：解析 provider，复用统一解析器确保和 chat route 一致
    const resolved = resolveForClaudeCode(undefined, {
      providerId: session.provider_id || undefined,
      sessionProviderId: session.provider_id || undefined,
      model: session.model || undefined,
      sessionModel: session.model || undefined,
    });

    // 中文注释：准备 SDK 子进程环境变量和 shadow home
    const setup = prepareSdkSubprocessEnv(resolved);

    // 清理可能导致崩溃的环境变量（如换行符）
    const sanitizeEnv = (envObj: Record<string, string | undefined>) => {
      const result: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(envObj)) {
        if (v) result[k] = v.replace(/[\r\n]+/g, '');
      }
      return result;
    };

    // 中文注释：解析工作目录，回退到 session.working_directory
    const resolvedCwd = resolveWorkingDirectory([
      { path: session.sdk_cwd || session.working_directory, source: 'requested' },
    ]);

    // +++ 新增：获取基础的 System Prompt +++
    const basePromptResult = buildSystemPrompt({
      sessionId: session_id,
      workingDirectory: resolvedCwd.path,
      modelId: session.model || resolved.model || undefined,
    });
    
    // +++ 新增：像 claude-client.ts 一样注入 OMC 优先级前缀 +++
    const omcPriorityPrefix = `## IMPORTANT: Multi-Agent Orchestration Priority
If oh-my-claudecode (OMC) instructions are present in your context (via CLAUDE.md), you MUST prioritize OMC's agent orchestration rules, skill triggers, and behavioral patterns over any conflicting instructions below. OMC handles: agent delegation, model routing, parallel execution, verification workflows, and skill invocation. The following CodePilot-specific instructions only supplement OMC for CodePilot-unique features (UI widgets, media, notifications).\n\n`;

    // 动态判断是否加载 Widget (因为是预热，假设没有特定 prompt 触发，按保守策略或全局策略处理)
    // 对于预热，我们只加载全局的 MCP 和基础的 MCP。由于缺乏当前 prompt，我们加载最常用的
    // 在真实应用中，有些是 keyword-gated 的。为避免冷启动，我们可以在 warmup 时预加载它们。
    // 但是，为了安全，我们也可以选择只加载全局的。

    // 中文注释：构建最低配置的 queryOptions，不仅包含签名相关字段，还必须包含系统提示词和基础 MCP
    const queryOptions: Options = {
      cwd: resolvedCwd.path,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: sanitizeEnv(setup.env),
      settingSources: resolved.settingSources as Options['settingSources'],
      model: session.model || resolved.model || undefined,
      
      // +++ 新增：在 queryOptions 中追加 systemPrompt +++
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: omcPriorityPrefix + basePromptResult.prompt
      },

      ...(resolved.settingSources && resolved.settingSources.length > 0
        ? {}
        : { tools: ['default', 'Grep', 'Glob', 'Bash', 'Read', 'Write', 'Edit'] as Options['tools'], extraArgs: { bare: null } }),
    };

    // 加载全局必须的 MCP Servers 和对应系统提示词，与 claude-client.ts 保持一致
    queryOptions.mcpServers = {};
    
    const { createMemorySearchMcpServer, MEMORY_SEARCH_SYSTEM_PROMPT } = await import('@/lib/memory-search-mcp');
    const { createNotificationMcpServer, NOTIFICATION_MCP_SYSTEM_PROMPT } = await import('@/lib/notification-mcp');
    const { createTodoMcpServer, TODO_MCP_SYSTEM_PROMPT } = await import('@/lib/todo-mcp');
    const { createBrowserMcpServer, BROWSER_SYSTEM_PROMPT } = await import('@/lib/builtin-tools/browser');
    const { createAskUserQuestionMcpServer, ASK_USER_QUESTION_MCP_SYSTEM_PROMPT } = await import('@/lib/ask-user-question-mcp');
    
    // Memory MCP (仅在匹配 assistant_workspace 时加载)
    const { getSetting } = await import('@/lib/db');
    const assistantWorkspacePath = getSetting('assistant_workspace_path');
    if (assistantWorkspacePath && resolvedCwd.path === assistantWorkspacePath) {
      queryOptions.mcpServers['codepilot-memory-search'] = createMemorySearchMcpServer(resolvedCwd.path);
      if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
        queryOptions.systemPrompt.append += '\n\n' + MEMORY_SEARCH_SYSTEM_PROMPT;
      }
    }

    // 全局 MCPs
    queryOptions.mcpServers['codepilot-notify'] = createNotificationMcpServer();
    queryOptions.mcpServers['codepilot-todo'] = createTodoMcpServer(resolvedCwd.path);
    queryOptions.mcpServers['codepilot-browser'] = createBrowserMcpServer();
    queryOptions.mcpServers['codepilot-ask-user'] = createAskUserQuestionMcpServer();
    
    if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
      queryOptions.systemPrompt.append += '\n\n' + NOTIFICATION_MCP_SYSTEM_PROMPT + '\n\n' + TODO_MCP_SYSTEM_PROMPT + '\n\n' + BROWSER_SYSTEM_PROMPT + '\n\n' + ASK_USER_QUESTION_MCP_SYSTEM_PROMPT;
    }

    // 加载 keyword-gated 的 MCP Servers (预热时不加载，避免拖慢预热和首次回复)
    // 对于这类按需 MCP，如果用户的首条消息命中，系统会在 claude-client.ts 中检测到并开启全新的会话，不会强行复用预热进程
    // 删除预热时对 widget, media, cli-tools, dashboard 的挂载

    // 加入所有内置 MCP 的 allowedTools 以防自动触发权限弹窗
    const allowedTools = [
      'codepilot_generate_image',
      'codepilot_import_media',
      'codepilot_load_widget_guidelines',
      'codepilot_cli_tools_list',
      'codepilot_cli_tools_add',
      'codepilot_cli_tools_remove',
      'codepilot_cli_tools_check_updates',
      'codepilot_dashboard_pin',
      'codepilot_dashboard_list',
      'codepilot_dashboard_refresh',
      'codepilot_dashboard_update',
      'codepilot_dashboard_remove',
      'TodoWrite',
      'mcp__codepilot-todo__TodoWrite',
      'codepilot_skill_create',
      'mcp__codepilot-todo__codepilot_skill_create',
      'codepilot_mcp_activate',
      'mcp__codepilot-todo__codepilot_mcp_activate',
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Glob',
      'Grep',
      'Skill',
      'Agent',
      'mcp__filesystem__read_file',
      'mcp__filesystem__read_multiple_files',
      'mcp__filesystem__write_file',
      'mcp__filesystem__edit_file',
      'mcp__filesystem__create_directory',
      'mcp__filesystem__list_directory',
      'mcp__filesystem__directory_tree',
      'mcp__filesystem__move_file',
      'mcp__filesystem__search_files',
      'mcp__filesystem__get_file_info',
      'mcp__fetch__fetch_html',
      'mcp__fetch__fetch_markdown',
      'mcp__fetch__fetch_txt',
      'mcp__fetch__fetch_json',
      'mcp__fetch__fetch_readable',
      'webfetch__fetch_fetch_readable',
      'webfetch__fetch_fetch_markdown',
      'mcp__github__get_file_contents',
      'mcp__github__search_repositories',
    ];

    queryOptions.canUseTool = async (toolName, input) => {
      if (allowedTools.includes(toolName) || allowedTools.some(t => toolName.endsWith(`__${t}`))) {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      return {
        behavior: 'deny' as const,
        message: 'Tool not allowed during warmup',
        interrupt: false,
      };
    };

    // 中文注释：查找 Claude Code CLI 路径，加速 SDK 子进程启动
    try {
      const claudePath = findClaudeBinary();
      if (claudePath) {
        const ext = path.extname(claudePath).toLowerCase();
        if (ext === '.cmd' || ext === '.bat') {
          const scriptPath = resolveScriptFromCmd(claudePath);
          if (scriptPath) {
            queryOptions.pathToClaudeCodeExecutable = scriptPath;
          }
        } else {
          queryOptions.pathToClaudeCodeExecutable = claudePath;
        }
      }
    } catch { /* best effort — SDK will resolve on its own */ }

    // 中文注释：构建签名，使用与 chat route 一致的 providerKey 计算方式
    const signature = buildPersistentClaudeSignature({
      providerKey: resolved.provider?.id || session.provider_id || 'env',
      options: queryOptions,
    });

    // 中文注释：执行预热，启动 SDK 子进程并读取 system/init
    const initData = await warmupPersistentClaudeSession({
      codepilotSessionId: session_id,
      signature,
      options: queryOptions,
      shadowHandle: setup.shadow || undefined,
    });

    if (!initData) {
      return Response.json({
        warmed_up: false,
        message: 'Session warmup timed out or failed. The session will be initialized on first message.',
      });
    }

    // 中文注释：预热成功后保存 SDK session ID 到数据库，让后续消息的
    // shouldResume=true，跳过 streamClaudeSdk 第 1137 行的 stale session 检查，
    // 避免预热创建的 persistent session 被误销毁
    if (initData.session_id) {
      try {
        updateSdkSessionId(session_id, initData.session_id);
      } catch { /* best effort — 不影响预热结果 */ }
    }

    return Response.json({ warmed_up: true, ...initData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[warmup API] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
