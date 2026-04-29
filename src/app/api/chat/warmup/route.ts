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
  adoptPersistentClaudeSessionBySignature,
} from '@/lib/persistent-claude-session';
import { loadAllMcpServers } from '@/lib/mcp-loader';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { buildSystemPrompt } from '@/lib/agent-system-prompt';
import { toSdkMcpConfig } from '@/lib/claude-client';

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
    const {
      session_id,
      working_directory,
      model: requestedModel,
      provider_id: requestedProviderId,
    } = body as {
      session_id?: string;
      working_directory?: string;
      model?: string;
      provider_id?: string;
    };

    if (!session_id && !working_directory) {
      return Response.json({ error: 'session_id or working_directory is required' }, { status: 400 });
    }

    const session = session_id ? getSession(session_id) : null;
    if (session_id && !session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // 中文注释：解析 provider，复用统一解析器确保和 chat route 一致
    const resolved = resolveForClaudeCode(undefined, {
      providerId: requestedProviderId || session?.provider_id || undefined,
      sessionProviderId: session?.provider_id || undefined,
      model: requestedModel || session?.model || undefined,
      sessionModel: session?.model || undefined,
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
      { path: working_directory || session?.sdk_cwd || session?.working_directory, source: 'requested' },
    ]);
    const warmupSessionId =
      session_id
      || `warmup:${resolved.provider?.id || requestedProviderId || 'env'}:${requestedModel || session?.model || resolved.model || 'default'}:${resolvedCwd.path}`;

    // 中文注释：功能名称「OMC 预热跳过」，用法是在检测到已启用 OMC 插件时，
    // 不再启动持久会话预热，避免首轮消息进入结构化消息队列路径，尽量保持与终端版
    // Claude Code 更一致的原生 query / resume 行为。
    let enabledPlugins: Array<{ type: 'local'; path: string }> = [];
    let omcPluginEnabled = false;
    try {
      const { getEnabledPluginConfigs, hasEnabledOmcPlugin } = await import('@/lib/plugin-discovery');
      enabledPlugins = getEnabledPluginConfigs(resolvedCwd.path);
      omcPluginEnabled = hasEnabledOmcPlugin(enabledPlugins);
      if (omcPluginEnabled) {
        return Response.json({
          warmed_up: false,
          skipped: true,
          reason: 'omc-native-query',
          message: 'OMC 已启用，已跳过持久预热以保持原生终端式会话链路。',
        });
      }
    } catch (error) {
      console.warn('[warmup API] Failed to resolve enabled plugins for warmup decision:', error);
    }

    // +++ 新增：获取基础的 System Prompt +++
    const basePromptResult = buildSystemPrompt({
      ...(session_id ? { sessionId: session_id } : {}),
      workingDirectory: resolvedCwd.path,
      modelId: requestedModel || session?.model || resolved.model || undefined,
      omcPluginEnabled,
      // 中文注释：功能名称「预热阶段原生规则发现优先」，用法是在 Claude Code CLI
      // 预热链路中不再手工拼接项目 `CLAUDE.md/AGENTS.md`，改由 Claude Code
      // 自己按 settingSources 与插件机制发现，避免正式聊天前就产生重复规则。
      includeDiscoveredProjectInstructions: false,
    });

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
      model: requestedModel || session?.model || resolved.model || undefined,
      
      // +++ 新增：在 queryOptions 中追加 systemPrompt +++
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: basePromptResult.prompt
      },

    };

    if (enabledPlugins.length > 0) {
      queryOptions.plugins = enabledPlugins as Options['plugins'];
    }

    // 中文注释：功能名称「预热 Hook 事件保持一致」，用法是当聊天主链路会开启 Claude
    // Full Capabilities 时，预热进程也同步打开 hook 生命周期事件，避免复用后丢失
    // 插件/OMC 的 SessionStart、InstructionsLoaded 等事件。
    // 中文注释：功能名称「预热 Hook 事件固定开启」，用法是在仅保留 Claude Code CLI
    // 主路径后，让预热进程始终与正式聊天保持同一套 hook 生命周期观测能力。
    queryOptions.includeHookEvents = true;

    // 中文注释：功能名称「预热全量 MCP 对齐」，用法是让预热进程与正式聊天一样
    // 直接暴露当前工作区可用的全部外部 MCP，避免复用一个“工具列表不完整”的热身会话。
    queryOptions.mcpServers = toSdkMcpConfig(loadAllMcpServers(resolvedCwd.path) || {});
    
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

    // CLI tools MCP 是每轮常驻加载的（非 keyword-gated），必须在预热时也加载，
    // 否则 claude-client.ts 中 hasOnDemandMcpServers 永远为 true，导致预热进程永远无法复用。
    const { createCliToolsMcpServer, CLI_TOOLS_MCP_SYSTEM_PROMPT } = await import('@/lib/cli-tools-mcp');
    queryOptions.mcpServers['codepilot-cli-tools'] = createCliToolsMcpServer();
    if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
      queryOptions.systemPrompt.append += '\n\n' + CLI_TOOLS_MCP_SYSTEM_PROMPT;
    }

    // 加载 keyword-gated 的 MCP Servers (预热时不加载，避免拖慢预热和首次回复)
    // 对于这类按需 MCP，如果用户的首条消息命中，系统会在 claude-client.ts 中检测到并开启全新的会话，不会强行复用预热进程
    // widget, media, dashboard 仍按需加载

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
      providerKey: resolved.provider?.id || requestedProviderId || session?.provider_id || 'env',
      options: queryOptions,
    });

    // 中文注释：功能名称「预热会话接力复用」，用法是在空白聊天页已经按 cwd/model 预热过时，
    // 会话页使用真实 session_id 继续接管同签名预热进程，避免再次冷启动一份新的 Claude 进程。
    if (session_id) {
      adoptPersistentClaudeSessionBySignature(signature, warmupSessionId);
    }

    // 中文注释：功能名称「缓存预热结果同步」，用法是在命中已完成的预热缓存时，
    // 同步补写 sdkSessionId，确保后续流式请求和页面状态都能识别这次预热已就绪。
    const cached = isSessionWarmedUp(warmupSessionId)
      ? getWarmedUpInitData(warmupSessionId)
      : null;
    if (cached) {
      if (session_id && cached.session_id) {
        try {
          updateSdkSessionId(session_id, cached.session_id);
        } catch { /* best effort — 不影响缓存复用 */ }
      }
      return Response.json({ warmed_up: true, from_cache: true, warmup_session_id: warmupSessionId, ...cached });
    }

    // 中文注释：执行预热，启动 SDK 子进程并读取 system/init
    const initData = await warmupPersistentClaudeSession({
      codepilotSessionId: warmupSessionId,
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
    if (session_id && initData.session_id) {
      try {
        updateSdkSessionId(session_id, initData.session_id);
      } catch { /* best effort — 不影响预热结果 */ }
    }

    return Response.json({ warmed_up: true, warmup_session_id: warmupSessionId, ...initData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[warmup API] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
