/**
 * provider-presence.ts — Single-source-of-truth: does CodePilot itself have
 * a usable provider to talk to a model with?
 */

import type { ApiProvider } from '@/types';
import { getSetting, getAllProviders } from '@/lib/db';
import { isOAuthUsable } from '@/lib/openai-oauth-manager';

export function providerHasUsableCodePilotAuth(p: ApiProvider): boolean {
  if (p.api_key) return true;

  const raw = p.env_overrides_json || p.extra_env || '';
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const bedrock = parsed.CLAUDE_CODE_USE_BEDROCK;
      const vertex = parsed.CLAUDE_CODE_USE_VERTEX;
      if (bedrock != null && bedrock !== '' && bedrock !== '0' && bedrock !== false) return true;
      if (vertex != null && vertex !== '' && vertex !== '0' && vertex !== false) return true;
    }
  } catch {
    if (raw.includes('CLAUDE_CODE_USE_BEDROCK')) return true;
    if (raw.includes('CLAUDE_CODE_USE_VERTEX')) return true;
  }

  return false;
}

export function hasCodePilotProvider(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return true;
  }

  try {
    if (getSetting('anthropic_auth_token')) return true;
  } catch {
    return true;
  }

  try {
    if (isOAuthUsable()) return true;
  } catch {
    return true;
  }

  try {
    for (const p of getAllProviders()) {
      if (providerHasUsableCodePilotAuth(p)) return true;
    }
  } catch {
    return true;
  }

  return false;
}
