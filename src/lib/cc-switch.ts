import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CCSwitchResolvedConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  currentModel: string;
  roleModels: {
    sonnet?: string;
    opus?: string;
    haiku?: string;
    default?: string;
  };
}

interface ClaudeSettings {
  env?: Record<string, string | undefined>;
}

export function readCCSwitchClaudeSettings(): CCSwitchResolvedConfig | null {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as ClaudeSettings;
    const env = parsed.env || {};
    const roleModels = {
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || undefined,
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || undefined,
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || undefined,
      default: env.ANTHROPIC_MODEL || undefined,
    };
    const models = [
      roleModels.default,
      roleModels.sonnet,
      roleModels.opus,
      roleModels.haiku,
    ].filter((v): v is string => !!v && v.trim().length > 0);
    const uniqueModels = Array.from(new Set(models));
    if (uniqueModels.length === 0) return null;
    return {
      baseUrl: env.ANTHROPIC_BASE_URL || '',
      apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
      models: uniqueModels,
      currentModel: roleModels.default || uniqueModels[0],
      roleModels,
    };
  } catch {
    return null;
  }
}
