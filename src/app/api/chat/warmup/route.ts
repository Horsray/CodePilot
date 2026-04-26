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

    // 中文注释：解析工作目录，回退到 session.working_directory
    const resolvedCwd = resolveWorkingDirectory([
      { path: session.sdk_cwd || session.working_directory, source: 'requested' },
    ]);

    // 中文注释：构建最低配置的 queryOptions，仅包含签名相关字段
    const queryOptions: Options = {
      cwd: resolvedCwd.path,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      env: setup.env,
      settingSources: resolved.settingSources as Options['settingSources'],
      model: session.model || resolved.model || undefined,
      ...(resolved.settingSources && resolved.settingSources.length > 0
        ? {}
        : { extraArgs: { bare: null } }),
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
