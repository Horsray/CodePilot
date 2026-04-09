/**
 * electron-builder afterPack hook.
 *
 * The standard @electron/rebuild step only rebuilds native modules found
 * in the `files` config. Since native modules enter the app through
 * extraResources (via .next/standalone/), they get skipped.
 *
 * This hook:
 * 1. Explicitly rebuilds native modules for the target Electron ABI
 * 2. Copies the rebuilt .node into all locations within standalone resources
 */
const fs = require('fs');
const os = require('os');
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

  const projectDir = process.cwd();

  // Define native modules to rebuild and copy
  const nativeModules = [
    {
      name: 'better-sqlite3',
      binaryName: 'better_sqlite3.node',
      sourcePath: path.join(projectDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    },
    {
      name: 'node-pty',
      binaryName: 'pty.node',
      sourcePath: path.join(projectDir, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
    },
  ];

  for (const moduleInfo of nativeModules) {
    const { name, binaryName, sourcePath } = moduleInfo;

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `codepilot-${name}-backup-`));
    const backupNodePath = path.join(backupDir, binaryName);

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, backupNodePath);
    }

    try {
      console.log(`[afterPack] Rebuilding ${name} for Electron ABI...`);

      try {
        const rebuildCmd = `npx electron-rebuild -f -o ${name} -v ${electronVersion} -a ${archName}`;
        console.log(`[afterPack] Running: ${rebuildCmd}`);
        execSync(rebuildCmd, {
          cwd: projectDir,
          stdio: 'inherit',
          timeout: 120000,
        });
        console.log(`[afterPack] Rebuild of ${name} completed successfully`);
      } catch (err) {
        console.error(`[afterPack] Failed to rebuild ${name}:`, err.message);
        try {
          const { rebuild } = require('@electron/rebuild');
          await rebuild({
            buildPath: projectDir,
            electronVersion: electronVersion,
            arch: archName,
            onlyModules: [name],
            force: true,
          });
          console.log(`[afterPack] Rebuild of ${name} via @electron/rebuild API succeeded`);
        } catch (err2) {
          console.error(`[afterPack] @electron/rebuild API also failed for ${name}:`, err2.message);
          throw new Error(`Cannot rebuild ${name} for Electron ABI`);
        }
      }

      if (!fs.existsSync(sourcePath)) {
        throw new Error(`[afterPack] Rebuilt ${binaryName} not found at ${sourcePath}`);
      }

      const sourceStats = fs.statSync(sourcePath);
      console.log(`[afterPack] Rebuilt .node file for ${name}: ${sourcePath} (${sourceStats.size} bytes)`);

      const searchRoots = [
        path.join(appOutDir, 'CodePilot.app', 'Contents', 'Resources', 'standalone'),
        path.join(appOutDir, 'Contents', 'Resources', 'standalone'),
        path.join(appOutDir, 'resources', 'standalone'),
      ];

      let replaced = 0;

      function walkAndReplace(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkAndReplace(fullPath);
          } else if (entry.name === binaryName) {
            const beforeSize = fs.statSync(fullPath).size;
            fs.copyFileSync(sourcePath, fullPath);
            const afterSize = fs.statSync(fullPath).size;
            console.log(`[afterPack] Replaced ${fullPath} (${beforeSize} -> ${afterSize} bytes)`);
            replaced++;
          }
        }
      }

      for (const root of searchRoots) {
        walkAndReplace(root);
      }

      if (replaced > 0) {
        console.log(`[afterPack] Successfully replaced ${replaced} ${binaryName} file(s) with Electron ABI build`);
      } else {
        console.warn(`[afterPack] WARNING: No ${binaryName} files found in standalone resources!`);
      }
    } finally {
      try {
        if (fs.existsSync(backupNodePath)) {
          fs.copyFileSync(backupNodePath, sourcePath);
          console.log(`[afterPack] Restored Node ABI ${binaryName} in project node_modules`);
        }
      } finally {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    }
  }
};
