/**
 * 多头路由完整验证 — 调试 roleModels upstream 解析
 */
export {};
process.env.CLAUDE_GUI_DATA_DIR = '/Users/horsray/.codepilot';

async function main() {
  const { resolveProvider, toClaudeCodeEnv } = await import('../../lib/provider-resolver');
  const { getAllProviders } = await import('../../lib/db');

  const multiHead = getAllProviders().find(p => p.protocol === 'multi_head');
  if (!multiHead) { console.error('No multi_head provider'); return; }

  console.log('=== multi_head 解析 ===\n');
  const resolved = resolveProvider({ providerId: multiHead.id, model: 'MiMo-V2.5-Pro' });

  console.log('roleModels after buildResolution:');
  for (const [k, v] of Object.entries(resolved.roleModels)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nupstreamModel:', resolved.upstreamModel);
  console.log('parentTierModel:', resolved.parentTierModel || '(none)');

  console.log('\n=== toClaudeCodeEnv ===\n');
  const env = toClaudeCodeEnv({}, resolved);
  console.log('ANTHROPIC_MODEL:', env.ANTHROPIC_MODEL || '(not set)');
  console.log('ANTHROPIC_DEFAULT_OPUS_MODEL:', env.ANTHROPIC_DEFAULT_OPUS_MODEL || '(not set)');
  console.log('ANTHROPIC_DEFAULT_SONNET_MODEL:', env.ANTHROPIC_DEFAULT_SONNET_MODEL || '(not set)');
  console.log('ANTHROPIC_DEFAULT_HAIKU_MODEL:', env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '(not set)');
  console.log('ANTHROPIC_BASE_URL:', env.ANTHROPIC_BASE_URL || '(not set)');
  console.log('ANTHROPIC_AUTH_TOKEN:', env.ANTHROPIC_AUTH_TOKEN ? '***' + env.ANTHROPIC_AUTH_TOKEN.slice(-4) : '(not set)');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
