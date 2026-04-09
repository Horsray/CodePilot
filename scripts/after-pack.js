/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * electron-builder afterPack hook.
 *
 * The standard @electron/rebuild step only rebuilds native modules found
 * in the `files` config. Since better-sqlite3 enters the app through
 * extraResources (via .next/standalone/), it gets skipped.
 *
 * This hook:
 * 1. Explicitly rebuilds native modules for the target Electron ABI
 * 2. Copies rebuilt binaries into standalone resources
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const arch = context.arch;
  // electron-builder arch enum: 1=x64, 3=arm64, etc.
  const archName = arch === 3 ? 'arm64' : arch === 1 ? 'x64' : arch === 0 ? 'ia32' : String(arch);
  const platform = context.packager.platform.name; // 'mac', 'windows', 'linux'

  // Get Electron version from packager config or from installed package
  const electronVersion =
    context.electronVersion ||
    context.packager?.config?.electronVersion ||
    require(path.join(process.cwd(), 'node_modules', 'electron', 'package.json')).version;

  console.log(`[afterPack] Electron ${electronVersion}, arch=${archName}, platform=${platform}`);

  const nativeModules = ['better-sqlite3', 'node-pty'];

  // Step 1: Explicitly rebuild native modules for the target Electron version
  const projectDir = process.cwd();
  console.log(`[afterPack] Rebuilding native modules for Electron ABI: ${nativeModules.join(', ')}`);

  try {
    // Use @electron/rebuild via npx (it's a dependency of electron-builder)
    const rebuildCmd = `npx electron-rebuild -f ${nativeModules.map((mod) => `-o ${mod}`).join(' ')} -v ${electronVersion} -a ${archName}`;
    console.log(`[afterPack] Running: ${rebuildCmd}`);
    execSync(rebuildCmd, {
      cwd: projectDir,
      stdio: 'inherit',
      timeout: 120000,
    });
    console.log('[afterPack] Native module rebuild completed successfully');
  } catch (err) {
    console.error('[afterPack] Failed to rebuild native modules:', err.message);
    // Try alternative: use @electron/rebuild programmatically
    try {
      const { rebuild } = require('@electron/rebuild');
      await rebuild({
        buildPath: projectDir,
        electronVersion: electronVersion,
        arch: archName,
        onlyModules: nativeModules,
        force: true,
      });
      console.log('[afterPack] Rebuild via @electron/rebuild API succeeded');
    } catch (err2) {
      console.error('[afterPack] @electron/rebuild API also failed:', err2.message);
      throw new Error(`Cannot rebuild native modules for Electron ABI: ${nativeModules.join(', ')}`);
    }
  }

  // Step 2: Verify rebuilt .node files
  const rebuiltSource = path.join(
    projectDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  );
  const rebuiltPtySource = path.join(
    projectDir, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'
  );

  if (!fs.existsSync(rebuiltSource)) {
    throw new Error(`[afterPack] Rebuilt better_sqlite3.node not found at ${rebuiltSource}`);
  }
  if (!fs.existsSync(rebuiltPtySource)) {
    throw new Error(`[afterPack] Rebuilt pty.node not found at ${rebuiltPtySource}`);
  }

  const sourceStats = fs.statSync(rebuiltSource);
  console.log(`[afterPack] Rebuilt .node file: ${rebuiltSource} (${sourceStats.size} bytes, mtime: ${sourceStats.mtime.toISOString()})`);
  const ptySourceStats = fs.statSync(rebuiltPtySource);
  console.log(`[afterPack] Rebuilt .node file: ${rebuiltPtySource} (${ptySourceStats.size} bytes, mtime: ${ptySourceStats.mtime.toISOString()})`);

  // Step 3: Find and replace native binaries in standalone resources
  // macOS: <appOutDir>/CodePilot.app/Contents/Resources/standalone/...
  // Windows/Linux: <appOutDir>/resources/standalone/...
  const searchRoots = [
    path.join(appOutDir, 'CodePilot.app', 'Contents', 'Resources', 'standalone'),
    path.join(appOutDir, 'Contents', 'Resources', 'standalone'),
    path.join(appOutDir, 'resources', 'standalone'),
  ];

  let replacedSqlite = 0;
  let replacedPty = 0;
  let replacedSpawnHelper = 0;
  let injectedPty = 0;
  let injectedSpawnHelper = 0;

  function walkAndReplace(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndReplace(fullPath);
      } else if (entry.name === 'better_sqlite3.node') {
        const beforeSize = fs.statSync(fullPath).size;
        fs.copyFileSync(rebuiltSource, fullPath);
        const afterSize = fs.statSync(fullPath).size;
        console.log(`[afterPack] Replaced ${fullPath} (${beforeSize} -> ${afterSize} bytes)`);
        replacedSqlite++;
      } else if (entry.name === 'pty.node') {
        const beforeSize = fs.statSync(fullPath).size;
        fs.copyFileSync(rebuiltPtySource, fullPath);
        const afterSize = fs.statSync(fullPath).size;
        console.log(`[afterPack] Replaced ${fullPath} (${beforeSize} -> ${afterSize} bytes)`);
        replacedPty++;
      } else if (entry.name === 'spawn-helper') {
        const helperSource = path.join(projectDir, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
        if (fs.existsSync(helperSource)) {
          const beforeSize = fs.statSync(fullPath).size;
          fs.copyFileSync(helperSource, fullPath);
          fs.chmodSync(fullPath, 0o755);
          const afterSize = fs.statSync(fullPath).size;
          console.log(`[afterPack] Replaced ${fullPath} (${beforeSize} -> ${afterSize} bytes)`);
          replacedSpawnHelper++;
        }
      }
    }
  }

  for (const root of searchRoots) {
    walkAndReplace(root);
  }

  // 中文注释：注入 node-pty 原生二进制到指定包目录（支持 node-pty 和 node-pty-哈希目录）。
  function injectNodePtyBinary(packageDir) {
    const releaseDir = path.join(packageDir, 'build', 'Release');
    fs.mkdirSync(releaseDir, { recursive: true });

    const ptyTarget = path.join(releaseDir, 'pty.node');
    fs.copyFileSync(rebuiltPtySource, ptyTarget);
    injectedPty++;
    console.log(`[afterPack] Injected ${ptyTarget}`);

    const helperSource = path.join(projectDir, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
    if (fs.existsSync(helperSource)) {
      const helperTarget = path.join(releaseDir, 'spawn-helper');
      fs.copyFileSync(helperSource, helperTarget);
      fs.chmodSync(helperTarget, 0o755);
      injectedSpawnHelper++;
      console.log(`[afterPack] Injected ${helperTarget}`);
    }
  }

  // 中文注释：扫描 node_modules 与 .next/node_modules，覆盖 Next 打包后的哈希目录。
  function injectNodePtyUnder(baseDir) {
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/^node-pty($|-)/.test(entry.name)) continue;
      injectNodePtyBinary(path.join(baseDir, entry.name));
    }
  }

  for (const root of searchRoots) {
    injectNodePtyUnder(path.join(root, 'node_modules'));
    injectNodePtyUnder(path.join(root, '.next', 'node_modules'));
  }

  if (replacedSqlite > 0 || replacedPty > 0 || injectedPty > 0) {
    console.log(
      `[afterPack] Successfully replaced better_sqlite3.node=${replacedSqlite}, pty.node=${replacedPty}, spawn-helper=${replacedSpawnHelper}; injected pty.node=${injectedPty}, injected spawn-helper=${injectedSpawnHelper}`
    );
  } else {
    console.warn('[afterPack] WARNING: No rebuilt native binaries were found in standalone resources!');
    for (const root of searchRoots) {
      if (fs.existsSync(root)) {
        console.log(`[afterPack] Contents of ${root}:`, fs.readdirSync(root).slice(0, 20));
      } else {
        console.log(`[afterPack] Path does not exist: ${root}`);
      }
    }
  }

  // Note: Ad-hoc code signing moved to scripts/after-sign.js (afterSign hook).
  // afterSign runs after electron-builder's own signing step (which is a no-op
  // with CSC_IDENTITY_AUTO_DISCOVERY=false), ensuring the signature is the last
  // modification before DMG/ZIP creation.
};
