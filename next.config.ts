import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig: NextConfig = {
  output: 'standalone',
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
};

export default nextConfig;
