import { findGitBash, getExpandedPath } from './platform';
import { toClaudeCodeEnv } from './provider-resolver';
import { createShadowClaudeHome } from './claude-home-shadow';
/**
 * Build the env that goes to the SDK subprocess for a resolved provider.
 *
 * Behavior:
 * - When `resolved.provider` is set (explicit DB provider) and user
 *   settingSources are enabled: builds a per-request shadow ~/.claude/ that
 *   strips ANTHROPIC_* keys from settings.json and ~/.claude.json. Fast-start
 *   SDK requests use settingSources=[] and therefore pass through the real
 *   HOME without building this shadow.
 * - When `resolved.provider` is undefined (env mode / cc-switch path):
 *   returns a pass-through real-HOME setup. cc-switch settings.json credentials
 *   are read by provider-resolver and injected through an explicit env
 *   allowlist; the SDK does not need user settingSources for auth.
 *
 * In both cases, the returned env has CodePilot's PATH expansion, Git Bash
 * detection (Windows), and the provider's auth/baseUrl/model env applied via
 * `toClaudeCodeEnv()`.
 */
export function prepareSdkSubprocessEnv(resolved) {
    const sdkEnv = { ...process.env };
    // Provider-group ownership: only build a shadow when an explicit DB
    // provider is selected AND the SDK will load user settings. The fast-start
    // default uses settingSources=[], so there is nothing for the shadow to
    // sanitize and no reason to pay the per-request filesystem cost.
    const shadow = createShadowClaudeHome({
        stripAuth: !!resolved.provider && resolved.settingSources.includes('user'),
    });
    sdkEnv.HOME = shadow.home;
    sdkEnv.USERPROFILE = shadow.home;
    // PATH expansion is needed in both Electron and dev so the subprocess can
    // find user-installed CLIs (npm global, brew, bun, etc.).
    sdkEnv.PATH = getExpandedPath();
    // Drop CLAUDECODE so a CodePilot launched from inside a `claude` session
    // doesn't trip the SDK's "nested session" guard.
    delete sdkEnv.CLAUDECODE;
    // Windows-only: auto-detect Git Bash if not already configured.
    if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
        const gitBashPath = findGitBash();
        if (gitBashPath)
            sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
    }
    // Apply the provider's resolved auth/baseUrl/model env. This MUST come
    // after the shadow setup, because toClaudeCodeEnv may clean ANTHROPIC_*
    // from baseEnv and we want HOME/USERPROFILE to survive that cleanup.
    const resolvedEnv = toClaudeCodeEnv(sdkEnv, resolved);
    Object.assign(sdkEnv, resolvedEnv);
    return { env: sdkEnv, shadow };
}
