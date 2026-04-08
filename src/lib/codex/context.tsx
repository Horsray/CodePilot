"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { CodexExtension, CodexContextValue } from './types';
import {
  loadCodexConfig,
  saveCodexConfig,
  getBuiltInExtensions,
  mergeExtensions,
} from './store';

const CodexContext = createContext<CodexContextValue | null>(null);

export function CodexProvider({ children }: { children: ReactNode }) {
  const [extensions, setExtensions] = useState<CodexExtension[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const config = loadCodexConfig();
    const builtIn = getBuiltInExtensions();
    const merged = mergeExtensions(config.extensions, builtIn);
    setExtensions(merged);
    setEnabled(config.enabled);
    setIsLoading(false);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persistConfig = useCallback((newExtensions: CodexExtension[], newEnabled: boolean) => {
    const config = {
      enabled: newEnabled,
      extensions: newExtensions,
      globalSettings: {},
    };
    saveCodexConfig(config);
  }, []);

  const toggleCodex = useCallback((newEnabled: boolean) => {
    setEnabled(newEnabled);
    setExtensions(prev => {
      persistConfig(prev, newEnabled);
      return prev;
    });
  }, [persistConfig]);

  const enableExtension = useCallback(async (id: string) => {
    setExtensions(prev => {
      const updated = prev.map(ext =>
        ext.id === id ? { ...ext, enabled: true } : ext
      );
      persistConfig(updated, enabled);
      return updated;
    });
  }, [enabled, persistConfig]);

  const disableExtension = useCallback(async (id: string) => {
    setExtensions(prev => {
      const updated = prev.map(ext =>
        ext.id === id ? { ...ext, enabled: false } : ext
      );
      persistConfig(updated, enabled);
      return updated;
    });
  }, [enabled, persistConfig]);

  const updateExtensionSettings = useCallback(
    async (id: string, settings: Record<string, unknown>) => {
      setExtensions(prev => {
        const updated = prev.map(ext =>
          ext.id === id ? { ...ext, settings: { ...ext.settings, ...settings } } : ext
        );
        persistConfig(updated, enabled);
        return updated;
      });
    },
    [enabled, persistConfig]
  );

  const openCodexPanel = useCallback(() => setIsPanelOpen(true), []);
  const closeCodexPanel = useCallback(() => setIsPanelOpen(false), []);

  const value = useMemo<CodexContextValue>(
    () => ({
      extensions,
      enabled,
      isLoading,
      toggleCodex,
      enableExtension,
      disableExtension,
      updateExtensionSettings,
      openCodexPanel,
      closeCodexPanel,
      isPanelOpen,
    }),
    [
      extensions,
      enabled,
      isLoading,
      toggleCodex,
      enableExtension,
      disableExtension,
      updateExtensionSettings,
      openCodexPanel,
      closeCodexPanel,
      isPanelOpen,
    ]
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}

export function useCodex(): CodexContextValue {
  const context = useContext(CodexContext);
  if (!context) {
    throw new Error('useCodex must be used within a CodexProvider');
  }
  return context;
}
