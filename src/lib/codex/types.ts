export interface CodexExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
  permissions?: string[];
  builtIn: boolean;
}

export interface CodexExtensionConfig {
  enabled: boolean;
  extensions: CodexExtension[];
  globalSettings: Record<string, unknown>;
}

export interface CodexAPI {
  getExtensions: () => Promise<CodexExtension[]>;
  getExtension: (id: string) => Promise<CodexExtension | null>;
  enableExtension: (id: string) => Promise<void>;
  disableExtension: (id: string) => Promise<void>;
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => Promise<void>;
  installExtension: (id: string, marketplace?: string) => Promise<void>;
  uninstallExtension: (id: string) => Promise<void>;
}

export interface CodexContextValue {
  extensions: CodexExtension[];
  enabled: boolean;
  isLoading: boolean;
  toggleCodex: (enabled: boolean) => void;
  enableExtension: (id: string) => Promise<void>;
  disableExtension: (id: string) => Promise<void>;
  updateExtensionSettings: (id: string, settings: Record<string, unknown>) => Promise<void>;
  openCodexPanel: () => void;
  closeCodexPanel: () => void;
  isPanelOpen: boolean;
}
