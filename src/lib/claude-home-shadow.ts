/**
 * claude-home-shadow.ts — Per-request shadow ~/.claude/ for DB-provider isolation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const AUTH_KEYS_TO_STRIP = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]);

export interface ShadowHome {
  home: string;
  isShadow: boolean;
  cleanup(): void;
}

const REAL_HOME = (): string => os.homedir();
const isWindows = process.platform === 'win32';

function passthrough(): ShadowHome {
  return { home: REAL_HOME(), isShadow: false, cleanup: () => {} };
}

function readSettingsJson(realClaudeDir: string): { content: Record<string, unknown> | null; raw: string | null } {
  const candidates = [
    path.join(realClaudeDir, 'settings.json'),
    path.join(realClaudeDir, 'claude.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { content: parsed, raw };
    } catch {}
  }
  return { content: null, raw: null };
}

function envBlockHasAnyAuthEntry(content: Record<string, unknown> | null): boolean {
  if (!content) return false;
  const env = (content.env && typeof content.env === 'object') ? content.env as Record<string, unknown> : null;
  if (!env) return false;
  for (const key of AUTH_KEYS_TO_STRIP) {
    const v = env[key];
    if (typeof v === 'string' && v.length > 0) return true;
  }
  return false;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function settingsJsonHasAuthOverride(): boolean {
  const settingsContent = readSettingsJson(path.join(REAL_HOME(), '.claude')).content;
  if (envBlockHasAnyAuthEntry(settingsContent)) return true;

  const dotClaudeJson = readJsonFile(path.join(REAL_HOME(), '.claude.json'));
  if (envBlockHasAnyAuthEntry(dotClaudeJson)) return true;

  return false;
}

function stripAuthEnv(settings: Record<string, unknown>): Record<string, unknown> {
  const env = settings.env;
  if (!env || typeof env !== 'object') return settings;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (AUTH_KEYS_TO_STRIP.has(k)) continue;
    cleaned[k] = v;
  }
  return { ...settings, env: cleaned };
}

function mirrorEntry(realPath: string, shadowPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(realPath);
  } catch {
    return;
  }

  try {
    if (isWindows && stat.isDirectory()) {
      fs.symlinkSync(realPath, shadowPath, 'junction');
    } else {
      fs.symlinkSync(realPath, shadowPath);
    }
    return;
  } catch {}

  if (stat.isDirectory()) {
    try {
      fs.cpSync(realPath, shadowPath, { recursive: true, dereference: false });
    } catch {}
  } else {
    try {
      fs.copyFileSync(realPath, shadowPath);
    } catch {}
  }
}

export function createShadowClaudeHome(opts: { stripAuth: boolean }): ShadowHome {
  if (!opts.stripAuth) return passthrough();

  const realClaudeDir = path.join(REAL_HOME(), '.claude');
  const settingsContent = fs.existsSync(realClaudeDir) ? readSettingsJson(realClaudeDir).content : null;
  const dotClaudeJsonPath = path.join(REAL_HOME(), '.claude.json');
  const dotClaudeJsonContent = readJsonFile(dotClaudeJsonPath);

  const settingsHasAuth = envBlockHasAnyAuthEntry(settingsContent);
  const dotClaudeHasAuth = envBlockHasAnyAuthEntry(dotClaudeJsonContent);
  if (!settingsHasAuth && !dotClaudeHasAuth) return passthrough();

  const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-shadow-claude-'));
  const shadowClaudeDir = path.join(shadowRoot, '.claude');

  try {
    fs.mkdirSync(shadowClaudeDir, { recursive: true });

    if (fs.existsSync(realClaudeDir)) {
      let entries: string[];
      try {
        entries = fs.readdirSync(realClaudeDir);
      } catch {
        entries = [];
      }
      for (const name of entries) {
        if (name === 'settings.json' || name === 'claude.json') continue;
        mirrorEntry(path.join(realClaudeDir, name), path.join(shadowClaudeDir, name));
      }
    }

    const settingsToWrite = settingsContent ? stripAuthEnv(settingsContent) : {};
    fs.writeFileSync(path.join(shadowClaudeDir, 'settings.json'), JSON.stringify(settingsToWrite, null, 2));

    if (dotClaudeJsonContent) {
      const dotClaudeToWrite = stripAuthEnv(dotClaudeJsonContent);
      fs.writeFileSync(path.join(shadowRoot, '.claude.json'), JSON.stringify(dotClaudeToWrite, null, 2));
    }
  } catch (err) {
    console.warn('[shadow-home] Failed to materialize shadow tree, falling back to real HOME:',
      err instanceof Error ? err.message : err);
    try { fs.rmSync(shadowRoot, { recursive: true, force: true }); } catch {}
    return passthrough();
  }

  const id = crypto.createHash('sha1').update(shadowRoot).digest('hex').slice(0, 8);
  console.log(`[shadow-home] Built shadow HOME ${id} for DB-provider request — settings.json + .claude.json env stripped`);

  let cleanedUp = false;
  return {
    home: shadowRoot,
    isShadow: true,
    cleanup: () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        fs.rmSync(shadowRoot, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[shadow-home] Failed to clean up shadow dir ${id}:`, err instanceof Error ? err.message : err);
      }
    },
  };
}
