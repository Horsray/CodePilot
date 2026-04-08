import type { CodexExtension, CodexExtensionConfig } from './types';

const CODEX_CONFIG_KEY = 'codepilot:codex-config';

const DEFAULT_CONFIG: CodexExtensionConfig = {
  enabled: true,
  extensions: [],
  globalSettings: {},
};

export function loadCodexConfig(): CodexExtensionConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CODEX_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled ?? true,
        extensions: parsed.extensions || [],
        globalSettings: parsed.globalSettings || {},
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

export function saveCodexConfig(config: CodexExtensionConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CODEX_CONFIG_KEY, JSON.stringify(config));
}

export function getBuiltInExtensions(): CodexExtension[] {
  return [
    {
      id: 'codex-core',
      name: 'Codex Core',
      description: 'Core Codex functionality for extension management and API integration',
      version: '1.0.0',
      author: 'CodePilot',
      enabled: true,
      builtIn: true,
      permissions: ['storage', 'api'],
    },
    {
      id: 'codex-chat-enhance',
      name: 'Chat Enhancement',
      description: 'Enhanced chat features including code syntax highlighting and smart suggestions',
      version: '1.0.0',
      author: 'CodePilot',
      enabled: true,
      builtIn: true,
      permissions: ['chat', 'storage'],
    },
    {
      id: 'codex-file-explorer',
      name: 'File Explorer',
      description: 'Quick file navigation and management within chat context',
      version: '1.0.0',
      author: 'CodePilot',
      enabled: true,
      builtIn: true,
      permissions: ['filesystem', 'storage'],
    },
    {
      id: 'codex-terminal',
      name: 'Terminal Integration',
      description: 'Integrated terminal access and command execution',
      version: '1.0.0',
      author: 'CodePilot',
      enabled: true,
      builtIn: true,
      permissions: ['terminal', 'filesystem'],
    },
  ];
}

export function mergeExtensions(
  saved: CodexExtension[],
  builtIn: CodexExtension[]
): CodexExtension[] {
  const savedMap = new Map(saved.map(ext => [ext.id, ext]));
  const merged = [...builtIn];

  for (const ext of saved) {
    if (!ext.builtIn) {
      const existing = merged.find(m => m.id === ext.id);
      if (!existing) {
        merged.push(ext);
      }
    }
  }

  for (const ext of merged) {
    const savedExt = savedMap.get(ext.id);
    if (savedExt) {
      Object.assign(ext, {
        enabled: savedExt.enabled,
        settings: savedExt.settings,
      });
    }
  }

  return merged;
}
