/**
 * sdk-subprocess-env.ts — Single-source-of-truth env builder for every SDK subprocess spawn.
 */
import { findGitBash, getExpandedPath } from './platform';
import { toClaudeCodeEnv, type ResolvedProvider } from './provider-resolver';
import { createShadowClaudeHome, type ShadowHome } from './claude-home-shadow';

export interface SdkSubprocessSetup {
  env: Record<string, string>;
  shadow: ShadowHome;
}

export function prepareSdkSubprocessEnv(resolved: ResolvedProvider): SdkSubprocessSetup {
  const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };

  const shadow = createShadowClaudeHome({ stripAuth: !!resolved.provider });
  sdkEnv.HOME = shadow.home;
  sdkEnv.USERPROFILE = shadow.home;

  sdkEnv.PATH = getExpandedPath();
  delete sdkEnv.CLAUDECODE;

  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash();
    if (gitBashPath) sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
  }

  const resolvedEnv = toClaudeCodeEnv(sdkEnv, resolved);
  Object.assign(sdkEnv, resolvedEnv);

  return { env: sdkEnv, shadow };
}
