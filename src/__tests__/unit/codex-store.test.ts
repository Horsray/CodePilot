import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCodexConfig,
  saveCodexConfig,
  getBuiltInExtensions,
  mergeExtensions,
} from '../../lib/codex/store';
import type { CodexExtension, CodexExtensionConfig } from '../../lib/codex/types';

const CODEX_CONFIG_KEY = 'codepilot:codex-config';

const mockLocalStorage = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => mockLocalStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockLocalStorage.set(key, value),
  removeItem: (key: string) => mockLocalStorage.delete(key),
  clear: () => mockLocalStorage.clear(),
  key: (index: number) => Array.from(mockLocalStorage.keys())[index] ?? null,
  get length() { return mockLocalStorage.size; },
} as Storage;

describe('Codex store', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('getBuiltInExtensions', () => {
    it('should return 4 built-in extensions', () => {
      const extensions = getBuiltInExtensions();
      assert.equal(extensions.length, 4);
    });

    it('should have codex-core as first extension', () => {
      const extensions = getBuiltInExtensions();
      assert.equal(extensions[0].id, 'codex-core');
      assert.equal(extensions[0].builtIn, true);
      assert.equal(extensions[0].enabled, true);
    });

    it('should have valid properties for all extensions', () => {
      const extensions = getBuiltInExtensions();
      for (const ext of extensions) {
        assert.ok(ext.id, `extension ${ext.name} should have an id`);
        assert.ok(ext.name, `extension ${ext.id} should have a name`);
        assert.ok(ext.description, `extension ${ext.id} should have a description`);
        assert.ok(ext.version, `extension ${ext.id} should have a version`);
        assert.ok(ext.author, `extension ${ext.id} should have an author`);
        assert.equal(ext.builtIn, true);
        assert.equal(typeof ext.enabled, 'boolean');
      }
    });
  });

  describe('loadCodexConfig', () => {
    it('should return default config when localStorage is empty', () => {
      const config = loadCodexConfig();
      assert.equal(config.enabled, true);
      assert.deepEqual(config.extensions, []);
      assert.deepEqual(config.globalSettings, {});
    });

    it('should load saved config from localStorage', () => {
      const savedConfig: CodexExtensionConfig = {
        enabled: false,
        extensions: [
          {
            id: 'test-ext',
            name: 'Test Extension',
            description: 'A test extension',
            version: '1.0.0',
            author: 'Tester',
            enabled: false,
            builtIn: false,
          },
        ],
        globalSettings: { theme: 'dark' },
      };
      mockLocalStorage.set(CODEX_CONFIG_KEY, JSON.stringify(savedConfig));

      const config = loadCodexConfig();
      assert.equal(config.enabled, false);
      assert.equal(config.extensions.length, 1);
      assert.equal(config.extensions[0].id, 'test-ext');
      assert.deepEqual(config.globalSettings, { theme: 'dark' });
    });

    it('should handle corrupted localStorage data', () => {
      mockLocalStorage.set(CODEX_CONFIG_KEY, 'not valid json');
      const config = loadCodexConfig();
      assert.equal(config.enabled, true);
      assert.deepEqual(config.extensions, []);
    });
  });

  describe('saveCodexConfig', () => {
    it('should save config to localStorage', () => {
      const config: CodexExtensionConfig = {
        enabled: true,
        extensions: [],
        globalSettings: { key: 'value' },
      };
      saveCodexConfig(config);

      const raw = mockLocalStorage.get(CODEX_CONFIG_KEY);
      assert.ok(raw, 'config should be saved to localStorage');
      const parsed = JSON.parse(raw);
      assert.equal(parsed.enabled, true);
      assert.deepEqual(parsed.globalSettings, { key: 'value' });
    });
  });

  describe('mergeExtensions', () => {
    it('should merge saved extensions with built-in extensions', () => {
      const builtIn = getBuiltInExtensions();
      const saved: CodexExtension[] = [
        {
          id: 'codex-core',
          name: 'Codex Core',
          description: 'Core',
          version: '1.0.0',
          author: 'CodePilot',
          enabled: false,
          builtIn: true,
        },
        {
          id: 'custom-ext',
          name: 'Custom Extension',
          description: 'A custom extension',
          version: '2.0.0',
          author: 'Developer',
          enabled: true,
          builtIn: false,
        },
      ];

      const merged = mergeExtensions(saved, builtIn);

      const codexCore = merged.find((e) => e.id === 'codex-core');
      assert.ok(codexCore, 'codex-core should exist in merged list');
      assert.equal(codexCore!.enabled, false, 'codex-core should have saved enabled state');

      const customExt = merged.find((e) => e.id === 'custom-ext');
      assert.ok(customExt, 'custom-ext should exist in merged list');
      assert.equal(customExt!.enabled, true);
    });

    it('should preserve built-in extensions that are not in saved config', () => {
      const builtIn = getBuiltInExtensions();
      const saved: CodexExtension[] = [];

      const merged = mergeExtensions(saved, builtIn);
      assert.equal(merged.length, builtIn.length, 'all built-in extensions should be preserved');
    });

    it('should handle extensions with settings', () => {
      const builtIn = getBuiltInExtensions();
      const saved: CodexExtension[] = [
        {
          id: 'codex-core',
          name: 'Codex Core',
          description: 'Core',
          version: '1.0.0',
          author: 'CodePilot',
          enabled: true,
          settings: { customSetting: 'value' },
          builtIn: true,
        },
      ];

      const merged = mergeExtensions(saved, builtIn);
      const codexCore = merged.find((e) => e.id === 'codex-core');
      assert.deepEqual(codexCore!.settings, { customSetting: 'value' });
    });
  });
});
