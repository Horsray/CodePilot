/**
 * postinstall patch for Next.js 16.2.1 generateBuildId bug.
 *
 * Next.js 16.2.1 loses config.generateBuildId during config processing,
 * causing "TypeError: generate is not a function" at build time.
 *
 * This patch adds a null check in generate-build-id.js to handle the case
 * where config.generateBuildId is undefined.
 *
 * See: https://github.com/vercel/next.js/issues/XXXXX
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'build', 'generate-build-id.js');

try {
  if (!fs.existsSync(filePath)) {
    // next.js not installed yet — skip
    process.exit(0);
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Only patch if not already patched
  if (content.includes('typeof generate !== \'function\'')) {
    // Already patched
    process.exit(0);
  }

  // Apply the patch
  content = content.replace(
    'async function generateBuildId(generate, fallback) {\n    let buildId = await generate();',
    'async function generateBuildId(generate, fallback) {\n    if (typeof generate !== \'function\') generate = () => null;\n    let buildId = await generate();'
  );

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[patch] Fixed Next.js generateBuildId bug');
} catch (err) {
  // Non-fatal — build will fail with the original error if patch fails
  console.warn('[patch] Failed to patch generate-build-id.js:', err.message);
}
