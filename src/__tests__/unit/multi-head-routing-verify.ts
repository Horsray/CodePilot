/**
 * 多头路由深度验证 - 追踪 resolveAgentModel 的 use-case 映射
 * 功能：检查每个 agent 类型是否正确映射到对应的 provider:model
 */
export {};

process.env.CLAUDE_GUI_DATA_DIR = '/Users/horsray/.codepilot';

async function main() {
  const { resolveAgentModel } = await import('../../lib/agent-routing');
  const { resolveProvider } = await import('../../lib/provider-resolver');
  const { getAgent } = await import('../../lib/agent-registry');

  const MULTI_HEAD_ID = '241db736cf9c68b513adac4af95ca5e4';

  console.log('=== resolveAgentModel 详细追踪 ===\n');

  // 先检查 multi_head provider 的 roleModels
  const parentResolved = resolveProvider({ providerId: MULTI_HEAD_ID });
  console.log('Parent resolved:');
  console.log(`  protocol: ${parentResolved.protocol}`);
  console.log(`  roleModels: ${JSON.stringify(parentResolved.roleModels)}`);
  console.log(`  provider: ${parentResolved.provider?.name || 'undefined'}`);
  console.log('');

  // 测试每个 agent 类型
  const agents = [
    { id: 'explore', expected: 'haiku → oLMX' },
    { id: 'search', expected: 'haiku → oLMX' },
    { id: 'writer', expected: 'haiku → oLMX' },
    { id: 'document-specialist', expected: 'haiku → oLMX' },
    { id: 'architect', expected: 'opus → MiMo' },
    { id: 'planner', expected: 'opus → MiMo' },
    { id: 'critic', expected: 'opus → MiMo' },
    { id: 'analyst', expected: 'opus → MiMo' },
    { id: 'code-reviewer', expected: 'opus → MiMo' },
    { id: 'general', expected: 'sonnet → MiniMax' },
    { id: 'executor', expected: 'sonnet → MiniMax' },
    { id: 'verifier', expected: 'sonnet → MiniMax' },
    { id: 'debugger', expected: 'sonnet → MiniMax' },
  ];

  for (const { id, expected } of agents) {
    const agentDef = getAgent(id);
    if (!agentDef) {
      console.log(`[${id}] ❌ Agent not found`);
      continue;
    }

    const routing = resolveAgentModel(agentDef, MULTI_HEAD_ID, 'MiMo-V2.5-Pro');
    const isCorrect = (
      (expected.includes('oLMX') && routing.providerId === 'bbef5adbf26d92e1c5ce9763be8db24d') ||
      (expected.includes('MiMo') && routing.providerId === 'bac5a8636fa15c456f6a3f0eb763cdfc') ||
      (expected.includes('MiniMax') && routing.providerId === '3da309e20114a2abd0df48c52d6c1985')
    );
    const status = isCorrect ? '✅' : '❌';
    console.log(`${status} [${id}] expected=${expected} → providerId=${routing.providerId?.slice(0, 8)}... model=${routing.model}`);
  }

  console.log('\n=== resolveProvider 递归路由验证 ===\n');

  // 模拟 createModel 的调用路径
  const testCases = [
    { providerId: 'bbef5adbf26d92e1c5ce9763be8db24d', model: 'Qwen3.6-35B-A3B-8bit', label: 'haiku → oLMX' },
    { providerId: '3da309e20114a2abd0df48c52d6c1985', model: 'MiniMax-M2.7', label: 'sonnet → MiniMax' },
    { providerId: 'bac5a8636fa15c456f6a3f0eb763cdfc', model: 'MiMo-V2.5-Pro', label: 'opus → MiMo' },
  ];

  for (const { providerId, model, label } of testCases) {
    const resolved = resolveProvider({ providerId, model });
    console.log(`[${label}]`);
    console.log(`  protocol=${resolved.protocol} provider=${resolved.provider?.name || 'undefined'} model=${resolved.model} upstreamModel=${resolved.upstreamModel}`);
    console.log(`  hasCredentials=${resolved.hasCredentials} baseUrl=${resolved.provider?.base_url || '(empty)'}`);
    console.log('');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
