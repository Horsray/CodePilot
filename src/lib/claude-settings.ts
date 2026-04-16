/**
 * claude-settings.ts — Read Anthropic credentials from ~/.claude/settings.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeSettingsCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

export function readClaudeSettingsCredentials(): ClaudeSettingsCredentials | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'claude.json'),
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      const env = parsed?.env;
      if (!env || typeof env !== 'object') continue;

      const pick = (key: string): string | undefined => {
        const v = env[key];
        return typeof v === 'string' && v.length > 0 ? v : undefined;
      };

      const apiKey = pick('ANTHROPIC_API_KEY');
      const authToken = pick('ANTHROPIC_AUTH_TOKEN');
      const baseUrl = pick('ANTHROPIC_BASE_URL');

      if (!apiKey && !authToken && !baseUrl) continue;
      return { apiKey, authToken, baseUrl };
    } catch {
      // 读取失败视为不存在。
    }
  }

  return null;
}

export function hasClaudeSettingsCredentials(): boolean {
  const creds = readClaudeSettingsCredentials();
  return !!(creds?.apiKey || creds?.authToken);
}
