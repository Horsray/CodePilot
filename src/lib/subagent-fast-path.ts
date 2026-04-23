import type { ToolSet } from 'ai';

type FastPathKind = 'local_code_search' | 'web_fetch' | 'web_search';

export interface SubAgentFastPathResult {
  kind: FastPathKind;
  report: string;
  cacheHit: boolean;
}

interface FastPathRequest {
  kind: FastPathKind;
  prompt: string;
  query?: string;
  url?: string;
  keywords?: string[];
  filePatterns?: string[];
}

interface ExecuteSubAgentFastPathOptions {
  agentId: string;
  prompt: string;
  workingDirectory: string;
  tools: ToolSet;
  abortSignal?: AbortSignal;
  onStage?: (stage: string, detail?: string) => void;
}

const FAST_PATH_AGENT_IDS = new Set(['explore', 'search', 'document-specialist']);
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
const WEB_QUERY_SIGNALS = [
  '联网',
  '网页',
  '网站',
  '官网',
  '官方文档',
  'web',
  'url',
  'http://',
  'https://',
  'latest',
  '最新',
  '查一下',
  '搜一下',
  '搜索',
];
const COMPLEXITY_SIGNALS = [
  '对比',
  '比较',
  '分析',
  '架构',
  '设计',
  '方案',
  '调研',
  '写代码',
  '实现',
  '修复',
  '多步骤',
  '多个步骤',
  '总结',
];
const FILE_PATTERN_RE = /\b(?:[\w.-]+\/)*[\w.*-]+\.[A-Za-z0-9*]{1,8}\b/g;
const URL_RE = /https?:\/\/[^\s"'`<>]+/i;
const FAST_PATH_CACHE_TTL_MS = 15_000;

const fastPathCache = new Map<string, { expiresAt: number; result: SubAgentFastPathResult }>();
const inFlightFastPaths = new Map<string, Promise<SubAgentFastPathResult | null>>();

export function isSimpleWebLookupTask(prompt: string): boolean {
  if (isLocalCodeSearchTask(prompt)) return false;
  if (URL_RE.test(prompt)) return true;

  const normalized = prompt.toLowerCase();
  const webHits = WEB_QUERY_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  const complexHits = COMPLEXITY_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;

  return webHits > 0 && complexHits <= 1 && prompt.length <= 220;
}

function isLocalCodeSearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localHits = LOCAL_CODE_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  const externalHits = EXTERNAL_RESEARCH_SIGNALS.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  return localHits > 0 && externalHits === 0;
}

export async function tryExecuteSubAgentFastPath(
  options: ExecuteSubAgentFastPathOptions,
): Promise<SubAgentFastPathResult | null> {
  const request = detectFastPathRequest(options.agentId, options.prompt);
  if (!request) return null;

  const cacheKey = `${request.kind}:${options.workingDirectory}:${request.query || request.url || options.prompt}`;
  const now = Date.now();
  const cached = fastPathCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    options.onStage?.('命中快速缓存', `复用最近一次 ${describeFastPath(request.kind)} 结果`);
    return { ...cached.result, cacheHit: true };
  }

  const existing = inFlightFastPaths.get(cacheKey);
  if (existing) {
    options.onStage?.('等待同类检索结果', '复用并发中的相同子任务');
    const shared = await existing;
    if (!shared) return null;
    return { ...shared, cacheHit: true };
  }

  const promise = executeFastPathRequest(options, request)
    .then((result) => {
      if (result) {
        fastPathCache.set(cacheKey, {
          expiresAt: Date.now() + FAST_PATH_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    })
    .finally(() => {
      inFlightFastPaths.delete(cacheKey);
    });

  inFlightFastPaths.set(cacheKey, promise);
  return promise;
}

function detectFastPathRequest(agentId: string, prompt: string): FastPathRequest | null {
  if (!FAST_PATH_AGENT_IDS.has(agentId)) return null;

  if (isLocalCodeSearchTask(prompt)) {
    const keywords = extractKeywords(prompt);
    const filePatterns = extractFilePatterns(prompt);
    if (keywords.length === 0 && filePatterns.length === 0) {
      return null;
    }
    return {
      kind: 'local_code_search',
      prompt,
      keywords,
      filePatterns,
    };
  }

  if (!isSimpleWebLookupTask(prompt)) return null;

  const url = extractUrl(prompt);
  if (url) {
    return { kind: 'web_fetch', prompt, url };
  }

  const query = normalizeWebQuery(prompt);
  if (!query) return null;

  return {
    kind: 'web_search',
    prompt,
    query,
  };
}

async function executeFastPathRequest(
  options: ExecuteSubAgentFastPathOptions,
  request: FastPathRequest,
): Promise<SubAgentFastPathResult | null> {
  switch (request.kind) {
    case 'local_code_search':
      return executeLocalCodeSearch(options, request);
    case 'web_fetch':
      return executeWebFetch(options, request);
    case 'web_search':
      return executeWebSearch(options, request);
    default:
      return null;
  }
}

async function executeLocalCodeSearch(
  options: ExecuteSubAgentFastPathOptions,
  request: FastPathRequest,
): Promise<SubAgentFastPathResult | null> {
  const grepTool = getTool(options.tools, ['Grep']);
  const globTool = getTool(options.tools, ['Glob']);
  const readTool = getTool(options.tools, ['Read']);

  if (!grepTool && !globTool) return null;

  const keywordReports: string[] = [];
  const snippetReports: string[] = [];
  const seenSnippetKeys = new Set<string>();
  const keywordMatches = new Map<string, Array<{ file: string; line: number; text: string }>>();
  const fileReports: string[] = [];

  if (request.filePatterns && request.filePatterns.length > 0 && globTool) {
    options.onStage?.('执行快速文件检索', request.filePatterns.join(', '));
    for (const rawPattern of request.filePatterns.slice(0, 3)) {
      const pattern = toGlobPattern(rawPattern);
      const output = await invokeTool(globTool, { pattern }, options.abortSignal);
      const files = normalizeLines(output).slice(0, 12);
      if (files.length > 0) {
        fileReports.push(`- ${rawPattern}: ${files.join(', ')}`);
      }
    }
  }

  if (request.keywords && request.keywords.length > 0 && grepTool) {
    for (const keyword of request.keywords.slice(0, 3)) {
      options.onStage?.('执行快速关键词检索', keyword);
      const output = await invokeTool(
        grepTool,
        {
          pattern: escapeRegex(keyword),
          path: options.workingDirectory,
          max_results: 12,
        },
        options.abortSignal,
      );
      const matches = parseGrepMatches(output).slice(0, 8);
      if (matches.length === 0) continue;

      keywordMatches.set(keyword, matches);
      const uniqueFiles = [...new Set(matches.map((match) => match.file))];
      keywordReports.push(`- "${keyword}": ${uniqueFiles.join(', ')}`);

      if (readTool) {
        for (const match of matches.slice(0, 4)) {
          const snippetKey = `${match.file}:${match.line}`;
          if (seenSnippetKeys.has(snippetKey)) continue;
          seenSnippetKeys.add(snippetKey);
          const snippet = await invokeTool(
            readTool,
            {
              file_path: normalizeToolFilePath(match.file, options.workingDirectory),
              offset: Math.max(match.line - 3, 0),
              limit: 6,
            },
            options.abortSignal,
          );
          if (typeof snippet === 'string' && !snippet.startsWith('Error:')) {
            snippetReports.push(`- ${match.file}:${match.line}\n${snippet}`);
          }
        }
      }
    }
  }

  if (fileReports.length === 0 && keywordReports.length === 0 && snippetReports.length === 0) {
    return {
      kind: 'local_code_search',
      cacheHit: false,
      report: `未找到与该检索任务相关的结果。\nPrompt: ${request.prompt}`,
    };
  }

  const sections: string[] = ['已通过快速检索通道直接完成本地搜索。'];
  if (fileReports.length > 0) {
    sections.push(`文件命中:\n${fileReports.join('\n')}`);
  }
  if (keywordReports.length > 0) {
    sections.push(`关键词命中:\n${keywordReports.join('\n')}`);
  }
  if (snippetReports.length > 0) {
    sections.push(`关键片段:\n${snippetReports.join('\n\n')}`);
  }

  return {
    kind: 'local_code_search',
    cacheHit: false,
    report: sections.join('\n\n'),
  };
}

async function executeWebFetch(
  options: ExecuteSubAgentFastPathOptions,
  request: FastPathRequest,
): Promise<SubAgentFastPathResult | null> {
  const url = request.url;
  if (!url) return null;

  options.onStage?.('抓取网页内容', url);

  const fetchTool = getTool(options.tools, [
    'webfetch__fetch_fetch_readable',
    'mcp__fetch__fetch_readable',
    'mcp__fetch__fetch_html',
  ]);

  let output: string | null = null;
  if (fetchTool) {
    output = await tryInvokeToolVariants(
      fetchTool,
      [
        { url },
        { url, max_length: 12000 },
        { url, maxLength: 12000 },
      ],
      options.abortSignal,
    );
  }

  if (!output) {
    output = await fetchUrlDirectly(url, options.abortSignal);
  }

  if (!output) return null;

  return {
    kind: 'web_fetch',
    cacheHit: false,
    report: `已通过快速网页抓取通道完成任务。\nURL: ${url}\n\n${trimOutput(output, 6000)}`,
  };
}

async function executeWebSearch(
  options: ExecuteSubAgentFastPathOptions,
  request: FastPathRequest,
): Promise<SubAgentFastPathResult | null> {
  const query = request.query;
  if (!query) return null;

  options.onStage?.('执行快速网页搜索', query);

  const searchTool = getTool(options.tools, [
    'web_search',
    'WebSearch',
    'mcp__MiniMax__web_search',
    'mcp__bailian-web-search__bailian_web_search',
  ]);

  if (!searchTool) return null;

  const output = await tryInvokeToolVariants(
    searchTool,
    [
      { query, max_results: 5 },
      { query, count: 5 },
      { query },
      { q: query, count: 5 },
      { q: query },
      { keyword: query },
    ],
    options.abortSignal,
  );

  if (!output) return null;

  return {
    kind: 'web_search',
    cacheHit: false,
    report: `已通过快速网页搜索通道完成任务。\nQuery: ${query}\n\n${trimOutput(output, 5000)}`,
  };
}

function getTool(tools: ToolSet, candidates: string[]) {
  const entries = tools as Record<string, unknown>;
  for (const name of candidates) {
    const tool = entries[name];
    if (tool && typeof tool === 'object' && 'execute' in tool) {
      return tool as { execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown> | unknown };
    }
  }
  return null;
}

async function invokeTool(
  tool: { execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown> | unknown },
  input: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<string> {
  const output = await tool.execute(input, { abortSignal });
  return stringifyToolOutput(output);
}

async function tryInvokeToolVariants(
  tool: { execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown> | unknown },
  variants: Array<Record<string, unknown>>,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  for (const variant of variants) {
    try {
      const output = await invokeTool(tool, variant, abortSignal);
      if (output && !output.startsWith('Error:')) {
        return output;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function normalizeLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('No files found') && !line.startsWith('Error'));
}

function parseGrepMatches(output: string): Array<{ file: string; line: number; text: string }> {
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    matches.push({
      file: match[1],
      line: Number(match[2]),
      text: match[3].trim(),
    });
  }
  return matches;
}

function normalizeToolFilePath(filePath: string, workingDirectory: string): string {
  if (filePath.startsWith('/')) return filePath;
  return `${workingDirectory.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
}

function extractKeywords(prompt: string): string[] {
  const quoted = [...prompt.matchAll(/["“'`](.{1,120}?)["”'`]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const keywordMatch = prompt.match(/(?:关键字|关键词|keyword)\s*[:：]?\s*([^\s，。；,;]+)/i);
  const inferred = keywordMatch ? [keywordMatch[1].trim()] : [];
  return [...new Set([...quoted, ...inferred])].slice(0, 4);
}

function extractFilePatterns(prompt: string): string[] {
  return [...new Set((prompt.match(FILE_PATTERN_RE) || []).map((part) => part.trim()))].slice(0, 4);
}

function toGlobPattern(pattern: string): string {
  if (pattern.includes('*') || pattern.includes('/')) return pattern;
  return `**/${pattern}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractUrl(prompt: string): string | undefined {
  return prompt.match(URL_RE)?.[0];
}

function normalizeWebQuery(prompt: string): string {
  return prompt
    .replace(URL_RE, ' ')
    .replace(/^(请|帮我|麻烦|可以)?\s*(联网)?\s*(查一下|搜一下|搜索|查找|看看|获取)\s*/i, '')
    .replace(/\s*(并|然后).*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrlDirectly(url: string, abortSignal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const linkedSignal = abortSignal;

  const abortForwarder = () => controller.abort();
  linkedSignal?.addEventListener('abort', abortForwarder, { once: true });

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'CodePilot-SubAgent-FastPath/1.0',
      },
    });
    const text = await res.text();
    const normalized = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${res.status} ${res.statusText}\n${normalized}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    linkedSignal?.removeEventListener('abort', abortForwarder);
  }
}

function trimOutput(output: string, limit: number): string {
  return output.length > limit ? `${output.slice(0, limit)}...` : output;
}

function describeFastPath(kind: FastPathKind): string {
  switch (kind) {
    case 'local_code_search':
      return '本地代码检索';
    case 'web_fetch':
      return '网页抓取';
    case 'web_search':
      return '网页搜索';
    default:
      return '快速检索';
  }
}
