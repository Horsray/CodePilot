import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CCSwitchModelConfig {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_REASONING_MODEL?: string;
  ANTHROPIC_SMALL_FAST_MODEL?: string;
  [key: string]: string | undefined;
}

export interface CCSwitchConfig {
  [modelName: string]: CCSwitchModelConfig;
}

export function getCCSwitchConfigPath(): string {
  return path.join(os.homedir(), '.cc-switch', 'config.json');
}

export function readCCSwitchConfig(): CCSwitchConfig | null {
  try {
    const configPath = getCCSwitchConfigPath();
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as CCSwitchConfig;
  } catch (error) {
    console.error('Failed to read cc-switch config:', error);
    return null;
  }
}

export function getCCSwitchClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export interface CCSwitchClaudeSettingsEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_REASONING_MODEL?: string;
  ANTHROPIC_SMALL_FAST_MODEL?: string;
  [key: string]: string | undefined;
}

export interface CCSwitchClaudeSettings {
  env?: CCSwitchClaudeSettingsEnv;
  [key: string]: unknown;
}

export interface CCSwitchResolvedConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  currentModel: string;
}

export function readCCSwitchClaudeSettings(): CCSwitchResolvedConfig | null {
  try {
    const settingsPath = getCCSwitchClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content) as CCSwitchClaudeSettings;
    
    const env = settings.env;
    if (!env) {
      return null;
    }
    
    const models: string[] = [];
    
    // Add actual model names from the config
    if (env.ANTHROPIC_DEFAULT_SONNET_MODEL && !models.includes(env.ANTHROPIC_DEFAULT_SONNET_MODEL)) {
      models.push(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
    }
    if (env.ANTHROPIC_DEFAULT_OPUS_MODEL && !models.includes(env.ANTHROPIC_DEFAULT_OPUS_MODEL)) {
      models.push(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
    }
    if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL && !models.includes(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)) {
      models.push(env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    }
    if (env.ANTHROPIC_MODEL && !models.includes(env.ANTHROPIC_MODEL)) {
      models.push(env.ANTHROPIC_MODEL);
    }
    
    if (models.length === 0) {
      return null;
    }
    
    return {
      baseUrl: env.ANTHROPIC_BASE_URL || '',
      apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
      models,
      currentModel: env.ANTHROPIC_MODEL || models[0],
    };
  } catch (error) {
    console.error('Failed to read cc-switch Claude settings:', error);
    return null;
  }
}

export function isCCSwitchEnabled(): boolean {
  const config = readCCSwitchConfig();
  const settings = readCCSwitchClaudeSettings();
  return config !== null || settings !== null;
}
