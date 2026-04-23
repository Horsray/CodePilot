import type { AgentDefinition } from './agent-registry';

export interface SubAgentExecutionProfile {
  initialStatus: string;
  mode: 'default' | 'local_code_search';
  sla: {
    softMs: number;
    hardMs: number;
  };
}

const SEARCH_LIKE_AGENT_IDS = new Set(['explore', 'search']);

const LOCAL_CODE_SIGNALS = [
  '代码库',
  '项目中搜索',
  '在 /',
  'working directory',
  'repo',
  'repository',
  '文件路径',
  '代码片段',
  '关键字',
  '关键词',
  '出现在哪些文件',
  '在哪个文件',
  '哪个文件',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
];

const EXTERNAL_RESEARCH_SIGNALS = [
  '联网',
  '互联网',
  'web',
  '官网',
  '官方文档',
  '最新',
  'news',
  'google',
  'bing',
  'openai',
  'anthropic',
];

function getSubAgentSla(agentId: string, mode: 'default' | 'local_code_search') {
  if (mode === 'local_code_search') {
    return { softMs: 20_000, hardMs: 60_000 };
  }

  switch (agentId) {
    case 'planner':
      return { softMs: 30_000, hardMs: 90_000 };
    case 'explore':
    case 'search':
    case 'document-specialist':
      return { softMs: 30_000, hardMs: 120_000 };
    case 'analyst':
    case 'architect':
    case 'critic':
    case 'code-reviewer':
    case 'security-reviewer':
      return { softMs: 45_000, hardMs: 150_000 };
    case 'executor':
    case 'debugger':
    case 'test-engineer':
    case 'qa-tester':
    case 'verifier':
      return { softMs: 60_000, hardMs: 180_000 };
    default:
      return { softMs: 45_000, hardMs: 150_000 };
  }
}

export function isLocalCodeSearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localHits = LOCAL_CODE_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  const externalHits = EXTERNAL_RESEARCH_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  return localHits > 0 && externalHits === 0;
}

export function buildSubAgentExecutionProfile(agentDef: AgentDefinition, prompt: string): SubAgentExecutionProfile {
  const mode = SEARCH_LIKE_AGENT_IDS.has(agentDef.id) && isLocalCodeSearchTask(prompt)
    ? 'local_code_search'
    : 'default';

  return {
    initialStatus: mode === 'local_code_search' ? '准备代码检索' : '等待模型响应',
    mode,
    sla: getSubAgentSla(agentDef.id, mode),
  };
}
