import { NextRequest } from 'next/server';
import { getSession } from '@/lib/db';
import { resolveForClaudeCode, resolveProvider as resolveProviderUnified } from '@/lib/provider-resolver';
import { prepareSdkSubprocessEnv } from '@/lib/sdk-subprocess-env';
import { resolveWorkingDirectory } from '@/lib/working-directory';
import { findClaudeBinary } from '@/lib/platform';
import {
  buildPersistentClaudeSignature,
  adoptPersistentClaudeSessionBySignature,
  warmupPersistentClaudeSession,
  isSessionWarmedUp,
} from '@/lib/persistent-claude-session';
import { loadAllMcpServers } from '@/lib/mcp-loader';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { buildSystemPrompt } from '@/lib/agent-system-prompt';
import { assembleContext } from '@/lib/context-assembler';
import { toSdkMcpConfig, sanitizeEnv } from '@/lib/claude-client';

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

    // 中文注释：解析 provider，使用和 chat route 完全一致的两步解析：
    // 第一步：resolveProviderUnified 解析出完整 provider 对象
    // 第二步：resolveForClaudeCode(explicitProvider, ...) 传入 provider 对象
    // 之前只用了 resolveForClaudeCode(undefined, ...)，导致签名中的 providerKey/env
    // 与 chat route 不匹配，WarmQuery 永远无法被消费。
    const effectiveProviderId = requestedProviderId || session?.provider_id || '';
    const unifiedResolved = resolveProviderUnified({
      providerId: effectiveProviderId || undefined,
      sessionProviderId: session?.provider_id || undefined,
      model: requestedModel || session?.model || undefined,
      sessionModel: session?.model || undefined,
    });
    const resolved = resolveForClaudeCode(unifiedResolved.provider, {
      providerId: effectiveProviderId || undefined,
      sessionProviderId: session?.provider_id || undefined,
    });

    // 中文注释：准备 SDK 子进程环境变量和 shadow home
    const setup = prepareSdkSubprocessEnv(resolved);

    // 中文注释：解析工作目录，回退到 session.working_directory
    const resolvedCwd = resolveWorkingDirectory([
      { path: working_directory || session?.sdk_cwd || session?.working_directory, source: 'requested' },
    ]);
    const warmupSessionId =
      session_id
      || `warmup:${resolved.provider?.id || requestedProviderId || 'env'}:${requestedModel || session?.model || resolved.model || 'default'}:${resolvedCwd.path}`;

    // 中文注释：功能名称「OMC 预热对齐」，用法是在检测到已启用 OMC 插件时仍然允许
    // 启动持久会话预热，避免首轮消息每次都重新冷启动 Claude Code 进程。
    // OMC 的 agent/skill/hook 决策已经回到原生链路，这里只负责性能层面的会话保活。
    let enabledPlugins: Array<{ type: 'local'; path: string }> = [];
    let omcPluginEnabled = false;
    try {
      const { getEnabledPluginConfigs, hasEnabledOmcPlugin } = await import('@/lib/plugin-discovery');
      enabledPlugins = getEnabledPluginConfigs(resolvedCwd.path);
      omcPluginEnabled = hasEnabledOmcPlugin(enabledPlugins);
    } catch (error) {
      console.warn('[warmup API] Failed to resolve enabled plugins for warmup decision:', error);
    }

    const assembled = session
      ? await assembleContext({
          session,
          entryPoint: 'desktop',
          userPrompt: '',
          omcPluginEnabled,
        })
      : null;
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
    const warmupSystemPrompt = assembled?.systemPrompt || basePromptResult.prompt;

    // 动态判断是否加载 Widget (因为是预热，假设没有特定 prompt 触发，按保守策略或全局策略处理)
    // 对于预热，我们只加载全局的 MCP 和基础的 MCP。由于缺乏当前 prompt，我们加载最常用的
    // 在真实应用中，有些是 keyword-gated 的。为避免冷启动，我们可以在 warmup 时预加载它们。
    // 但是，为了安全，我们也可以选择只加载全局的。

    // 中文注释：构建最低配置的 queryOptions，不仅包含签名相关字段，还必须包含系统提示词和基础 MCP
    // permissionMode 必须与 chat route 完全一致：claude-client.ts 硬编码为 'bypassPermissions'。
    // 之前的 'trust'/'explore' 与 chat route 的 'bypassPermissions' 不同，导致签名永远不匹配。
    const queryOptions: Options = {
      cwd: resolvedCwd.path,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: sanitizeEnv(setup.env as Record<string, string>),
      settingSources: resolved.settingSources as Options['settingSources'],
      // 中文注释：必须使用 upstreamModel（catalog 解析后的模型 ID），而不是原始 requestedModel。
      // chat route 使用 resolved.upstreamModel || resolved.model，如果这里用 requestedModel
      // （如 'claude-sonnet-4-5'），而 chat route 用 'claude-sonnet-4-5-20250929'，
      // 签名中的 model 字段不匹配 → isSignatureCompatible 返回 false → warmup 永远无法被消费。
      model: unifiedResolved.upstreamModel || resolved.model || requestedModel || session?.model || undefined,

      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: warmupSystemPrompt
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

    // 中文注释：功能名称「全量 MCP 预热」，用法是在预热阶段加载所有按需 MCP Server
    // （widget/media/image-gen/dashboard/team），确保 mcpSignature 与 chat route 一致，
    // 避免签名不匹配导致预热进程被销毁、首轮响应退回冷启动。
    // 这些 MCP 都是 in-process 的（createSdkMcpServer），初始化耗时 < 50ms，
    // 不会显著拖慢预热速度。
    {
      const { createWidgetMcpServer } = await import('@/lib/widget-guidelines');
      queryOptions.mcpServers = {
        ...(queryOptions.mcpServers || {}),
        'codepilot-widget': createWidgetMcpServer(),
      };
    }

    {
      const { createMediaImportMcpServer, MEDIA_MCP_SYSTEM_PROMPT } = await import('@/lib/media-import-mcp');
      const { createImageGenMcpServer } = await import('@/lib/image-gen-mcp');
      queryOptions.mcpServers = {
        ...(queryOptions.mcpServers || {}),
        'codepilot-media': createMediaImportMcpServer(warmupSessionId, resolvedCwd.path),
        'codepilot-image-gen': createImageGenMcpServer(warmupSessionId, resolvedCwd.path),
      };
      if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
        queryOptions.systemPrompt.append += '\n\n' + MEDIA_MCP_SYSTEM_PROMPT;
      }
    }

    {
      const { createDashboardMcpServer, DASHBOARD_MCP_SYSTEM_PROMPT } = await import('@/lib/dashboard-mcp');
      queryOptions.mcpServers = {
        ...(queryOptions.mcpServers || {}),
        'codepilot-dashboard': createDashboardMcpServer(warmupSessionId, resolvedCwd.path),
      };
      if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
        queryOptions.systemPrompt.append += '\n\n' + DASHBOARD_MCP_SYSTEM_PROMPT;
      }
    }

    // Team MCP: handled natively by OMC plugin, no need for codepilot-team.

    // 加入所有内置 MCP 的 allowedTools 以防自动触发权限弹窗
    const allowedTools = [
      'mcp__codepilot-memory-search',
      'mcp__codepilot-notify',
      'mcp__codepilot-widget',
      'mcp__codepilot-widget-guidelines',
      'mcp__codepilot-media',
      'mcp__codepilot-image-gen',
      'mcp__codepilot-cli-tools',
      'mcp__codepilot-dashboard',
      'mcp__codepilot-todo',
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
      'Task',
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
      'AskUserQuestion',
      'mcp__codepilot-ask-user__AskUserQuestion',
      'WebSearch',
      'WebFetch',
      'context7_resolve-library-id',
      'context7_query-docs',
    ];

    queryOptions.allowedTools = allowedTools;
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

    // 中文注释：构建签名，providerKey 计算方式与 chat route 完全一致：
    // resolved.provider?.id || effectiveProviderId || session?.provider_id || 'env'
    const providerKey = resolved.provider?.id || effectiveProviderId || session?.provider_id || 'env';
    const signature = buildPersistentClaudeSignature({
      providerKey,
      options: queryOptions,
    });
    console.log('[warmup API] Signature computed:', {
      warmupSessionId,
      realSessionId: session_id || '(none)',
      signature: signature.slice(0, 80) + '...',
      signatureParsed: (() => { try { const s = JSON.parse(signature); return { providerKey: s.providerKey, model: s.model, cwd: s.cwd?.slice(-30), permissionMode: s.permissionMode, settingSources: s.settingSources, authKind: s.env?.authKind }; } catch { return '(parse error)'; } })(),
      providerKey,
      model: queryOptions.model,
      cwd: queryOptions.cwd?.slice(-30),
      permissionMode: queryOptions.permissionMode,
      settingSources: queryOptions.settingSources,
      mcpServerNames: queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers) : [],
      envAnthropicBaseUrl: queryOptions.env?.ANTHROPIC_BASE_URL || '(none)',
      envAuthKind: queryOptions.env?.ANTHROPIC_AUTH_TOKEN ? 'auth_token' : queryOptions.env?.ANTHROPIC_API_KEY ? 'api_key' : 'none',
    });

    // 中文注释：功能名称「预热会话接力复用」，用法是在空白聊天页已经按 cwd/model 预热过时，
    // 会话页使用真实 session_id 继续接管同签名 persistent 进程，避免再次冷启动一份新的 Claude 进程。
    if (session_id) {
      adoptPersistentClaudeSessionBySignature(signature, warmupSessionId);
    }

    if (isSessionWarmedUp(warmupSessionId)) {
      console.log('[warmup API] Persistent session already warmed for', warmupSessionId);
      return Response.json({ warmed_up: true, from_cache: true, warmup_session_id: warmupSessionId });
    }

    // 中文注释：预热 persistent Claude session，而不是额外启动 one-shot WarmQuery。
    // 一个 CodePilot 会话应该对应一个后台 Claude Code 进程；WarmQuery 无法接力给
    // 后续轮次，消费它会导致第二轮退回 resume 冷启动。
    const initData = await warmupPersistentClaudeSession({
      codepilotSessionId: warmupSessionId,
      signature,
      options: queryOptions,
      shadowHandle: setup.shadow || undefined,
    });
    // 中文注释：返回诊断信息给前端，方便用户在浏览器 console 中查看预热状态
    return Response.json({
      warmed_up: !!initData,
      warmup_session_id: warmupSessionId,
      model: initData?.model || queryOptions.model,
      sdk_session_id: initData?.session_id || '',
      provider_key: providerKey,
      mcp_count: queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers).length : 0,
      mcp_names: queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers) : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[warmup API] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
