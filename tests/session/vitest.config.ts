import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/session/setup.ts'],
    include: [
      'tests/session/**/*.test.ts',
      'tests/session/**/*.test.tsx',
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/session',
      include: [
        'src/**/*.{ts,tsx}',
        'packages/**/*.{ts,tsx}',
      ],
      exclude: [
        'node_modules',
        'dist',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    retry: 1,
    bail: 0,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },
    logHeapUsage: true,
    allowOnly: true,
    dangerouslyDisableUnhandledRejection: false,
    sequence: {
      concurrent: true,
      shuffle: false,
      hooks: 'stack',
      setupFiles: 'list',
    },
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-key-for-unit-tests-only',
      SESSION_TIMEOUT: '3600',
      MAX_LOGIN_ATTEMPTS: '5',
      LOGIN_LOCKOUT_DURATION: '900',
    },
  },
  resolve: {
    alias: {
      '@': './src',
      '@tests': './tests',
    },
  },
});
