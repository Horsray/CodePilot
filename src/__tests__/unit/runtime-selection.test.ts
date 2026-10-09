/**
 * runtime-selection.test.ts — Tests for runtime selection and OAuth status.
 *
 * - OAuth status: inlined (real getOAuthStatus reads host DB, non-deterministic)
 * - Runtime selection: inlined because registry.ts depends on runtime
 *   registration side effects that conflict with isolated unit tests.
 *   The inlined logic is documented as a mirror of registry.ts and
 *   should be updated when the source changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Suite 1: predictNativeRuntime (inlined — registry.ts has side effects) ──
// 单一路径后固定返回 false，表示永远不再预测到 Native runtime。

function predictNativeRuntime(
  _providerId: string | undefined,
  _cliEnabled: boolean,
  _agentRuntime: string,
  _sdkAvailable: boolean,
): boolean {
  return false;
}

describe('predictNativeRuntime (mirrors registry.ts)', () => {
  it('legacy native setting no longer changes the prediction', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'native', true), false);
  });
  it('claude-code-sdk remains non-native when CLI exists', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk', true), false);
  });
  it('missing CLI no longer predicts native fallback', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk', false), false);
  });
  it('legacy auto is also treated as Claude Code only', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', false), false);
    assert.equal(predictNativeRuntime(undefined, true, 'auto', true), false);
  });
});

// ── Suite 2: resolveRuntime auto semantics (mirrors registry.ts) ──

function resolveRuntime(sdkAvailable: boolean): string {
  if (!sdkAvailable) {
    throw new Error('Claude Code CLI runtime is unavailable. Please install or reconnect Claude Code.');
  }
  return 'claude-code-sdk';
}

describe('resolveRuntime (mirrors registry.ts)', () => {
  it('CLI 可用时固定返回 claude-code-sdk', () => {
    assert.equal(resolveRuntime(true), 'claude-code-sdk');
  });

  it('CLI 不可用时直接报错，不再回退 native', () => {
    assert.throws(
      () => resolveRuntime(false),
      /Claude Code CLI runtime is unavailable/,
    );
  });
});

// ── Suite 3: OpenAI OAuth status (inlined — real impl reads host DB) ──

describe('OpenAI OAuth status (inlined logic)', () => {
  // All OAuth status tests are inlined because the real getOAuthStatus()
  // reads from the host machine's DB — test results would depend on
  // whether the developer has logged into OpenAI, making it non-deterministic.

  function deriveOAuthStatus(
    accessToken: string | null,
    expiresAt: number,
    refreshToken: string | null,
  ): { authenticated: boolean; needsRefresh?: boolean } {
    if (!accessToken) return { authenticated: false };
    const REFRESH_BUFFER_MS = 5 * 60 * 1000;
    if (expiresAt && Date.now() > expiresAt && !refreshToken) {
      return { authenticated: false };
    }
    const needsRefresh = expiresAt > 0 && Date.now() > expiresAt - REFRESH_BUFFER_MS;
    return { authenticated: true, needsRefresh };
  }

  it('valid token → authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 3600_000, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });

  it('expired + no refresh → not authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, null);
    assert.equal(r.authenticated, false);
  });

  it('expired + has refresh → authenticated + needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('near expiry (within 5min buffer) → needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 60_000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('expiresAt=0 → no expiry check', () => {
    const r = deriveOAuthStatus('tok', 0, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });
});

// ── Suite 4: SDK availability matrix (mirrors sdk-runtime.ts isAvailable) ──

describe('SDK isAvailable matrix (inlined logic)', () => {
  // Mirrors the 3-layer check in sdk-runtime.ts:76-97.
  // Mirrors sdk-runtime.ts isAvailable() — now a simple CLI binary check.
  // Auth is managed by the CLI itself; availability only depends on binary.

  function sdkIsAvailable(cliBinaryExists: boolean): boolean {
    return cliBinaryExists;
  }

  it('no CLI binary → unavailable', () => {
    assert.equal(sdkIsAvailable(false), false);
  });

  it('CLI binary exists → available', () => {
    assert.equal(sdkIsAvailable(true), true);
  });
});

// ── Suite 5: Announcement dismiss persistence (mirrors FeatureAnnouncementDialog) ──

describe('Announcement dismiss persistence (inlined logic)', () => {
  // Mirrors the dismiss check in FeatureAnnouncementDialog.tsx:24-39.
  // LIMITATION: tests the decision matrix only, not the actual API persistence
  // path (settings/app whitelist, localStorage sync). The whitelist regression
  // we fixed requires a running Next.js server to exercise — belongs in smoke/e2e.

  function shouldShowAnnouncement(opts: {
    localStorageDismissed: boolean;
    dbSettingDismissed: boolean;
    setupCompleted: boolean;
  }): { show: boolean; syncLocalStorage: boolean } {
    // Fast check: localStorage says dismissed
    if (opts.localStorageDismissed) return { show: false, syncLocalStorage: false };

    // DB says dismissed (localStorage was lost) → don't show, sync back
    if (opts.dbSettingDismissed) return { show: false, syncLocalStorage: true };

    // Only show if setup is completed (existing user)
    if (opts.setupCompleted) return { show: true, syncLocalStorage: false };

    // New user (setup not done) → don't show
    return { show: false, syncLocalStorage: false };
  }

  it('localStorage dismissed → do not show', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, false);
  });

  it('DB dismissed but localStorage lost → do not show + sync localStorage', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, true);
  });

  it('neither dismissed + setup completed → show (existing user upgrading)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, true);
  });

  it('neither dismissed + setup not completed → do not show (new user)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: false });
    assert.equal(r.show, false);
  });

  it('both dismissed → do not show (redundant but safe)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
  });
});
