import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  output: 'standalone',
  // 中文注释：禁用 Turbopack，使用 Webpack 构建
  // Turbopack 与自定义 webpack 配置不兼容
  turbopack: {},
  // 中文注释：Webpack 配置 - 确保关键依赖正确打包，避免运行时 chunk 加载失败
  webpack: (config, { isServer }) => {
    // 修复 mermaid 相关包的代码分割问题
    // 错误：ENOENT: no such file or directory, open '.../vendor-chunks/mermaid.js'
    // 原因：Next.js standalone 模式下某些动态导入的 chunk 未被正确包含
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization?.splitChunks,
        cacheGroups: {
          ...config.optimization?.splitChunks?.cacheGroups,
          // 将 mermaid 相关包打包到主 bundle，避免单独的 chunk 丢失
          mermaid: {
            test: /[\\/]node_modules[\\/](mermaid|@streamdown[\\/]mermaid)[\\/]/,
            name: 'mermaid-bundle',
            chunks: 'all',
            enforce: true,
          },
        },
      },
    };
    return config;
  },
  // serverExternalPackages: keep these in node_modules at runtime instead of bundling.
  // - better-sqlite3 / zlib-sync: native modules, can't be bundled
  // - node-pty: native module for terminal support
  // - discord.js / @discordjs/ws: dynamic require chain
  // - @anthropic-ai/claude-agent-sdk: ships its own `cli.js` that the SDK spawns
  //   as a child process. When Next.js bundles the SDK, the standalone build
  //   omits cli.js, so the SDK fails with "Claude Code executable not found at
  //   .../node_modules/@anthropic-ai/claude-agent-sdk/cli.js" in production.
  //   Sentry recorded ~247 events in 14d before this was added.
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'discord.js', '@discordjs/ws', 'zlib-sync', '@anthropic-ai/claude-agent-sdk'],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_SENTRY_DSN: 'https://245dc3525425bcd8eb99dd4b9a2ca5cd@o4511161899548672.ingest.us.sentry.io/4511161904791552',
  },
  // outputFileTracingExcludes: strip non-code dirs out of every route's NFT.
  // Turbopack sees the recursive fs.readdir() in src/lib/files#scanDirectory
  // (used by /api/files/suggest) and conservatively marks the whole project
  // as reachable — dumping README / RELEASE_NOTES / docs / .codepilot cache
  // / apps/site content into every route's .nft.json and surfacing it as
  // "next.config.ts was unexpectedly traced" warnings on `npm run build`.
  // Runtime still reads those paths — exclusion only removes them from the
  // static NFT manifest, which CodePilot doesn't consume for deployment
  // (Electron ships the whole project regardless).
  outputFileTracingExcludes: {
    // Key matches both app-router routes and instrumentation.js entry.
    '**/*': [
      'next.config.ts',
      'AGENTS.md',
      'ARCHITECTURE.md',
      'CHANGELOG.md',
      'CLAUDE.md',
      'LICENSE',
      'README.md',
      'README_CN.md',
      'README_JA.md',
      'RELEASE_NOTES.md',
      '.codepilot/**',
      'apps/**',
      'docs/**',
      'release/**',
      'scripts/**',
      'test-results/**',
      'playwright-report/**',
      '**/*.md',
      '**/*.mdx',
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
    ],
  },
};

export default nextConfig;
