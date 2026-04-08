import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type PlanningWithFilesLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export type PlanningWithFilesInstallTarget = 'claude' | 'agents';
export type PlanningWithFilesInstallScope = 'global' | 'project';

export type PlanningWithFilesErrorCode =
  | 'PWF_FETCH_FAILED'
  | 'PWF_FETCH_TIMEOUT'
  | 'PWF_INVALID_RESPONSE'
  | 'PWF_WRITE_FAILED'
  | 'PWF_INVALID_CWD';

export class PlanningWithFilesError extends Error {
  readonly code: PlanningWithFilesErrorCode;
  readonly cause?: unknown;
  constructor(code: PlanningWithFilesErrorCode, message: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

export interface PlanningWithFilesCacheConfig {
  enabled: boolean;
  ttlMs: number;
}

export interface PlanningWithFilesSourceConfig {
  repo: string;
  ref: string;
  skillPath: string;
}

export interface PlanningWithFilesPathsConfig {
  claudeSkillsDir: string;
  agentsSkillsDir: string;
}

export interface PlanningWithFilesInitOptions {
  logLevel?: PlanningWithFilesLogLevel;
  timeoutMs?: number;
  cache?: Partial<PlanningWithFilesCacheConfig>;
  source?: Partial<PlanningWithFilesSourceConfig>;
  paths?: Partial<PlanningWithFilesPathsConfig>;
  fetchImpl?: typeof fetch;
}

export interface PlanningWithFilesInstallOptions {
  target: PlanningWithFilesInstallTarget;
  scope: PlanningWithFilesInstallScope;
  cwd?: string;
  force?: boolean;
}

export interface PlanningWithFilesInstallResult {
  installed: boolean;
  fromCache: boolean;
  targetDir: string;
  skillFilePath: string;
  contentHash: string;
}

export interface PlanningWithFilesSkill {
  install(opts: PlanningWithFilesInstallOptions): Promise<PlanningWithFilesInstallResult>;
  isInstalled(opts: Omit<PlanningWithFilesInstallOptions, 'force'>): boolean;
  fetchSkillMarkdown(): Promise<{ content: string; contentHash: string; fromCache: boolean }>;
  getConfig(): Required<PlanningWithFilesResolvedConfig>;
}

interface PlanningWithFilesResolvedConfig {
  logLevel: PlanningWithFilesLogLevel;
  timeoutMs: number;
  cache: PlanningWithFilesCacheConfig;
  source: PlanningWithFilesSourceConfig;
  paths: PlanningWithFilesPathsConfig;
  fetchImpl: typeof fetch;
}

const GLOBAL_KEY = '__planningWithFilesSkill__' as const;
const SKILL_ID = 'planning-with-files' as const;
const SKILL_FILE = 'SKILL.md' as const;

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

function resolveDefaultConfig(opts: PlanningWithFilesInitOptions = {}): Required<PlanningWithFilesResolvedConfig> {
  const cache: PlanningWithFilesCacheConfig = {
    enabled: opts.cache?.enabled ?? true,
    ttlMs: opts.cache?.ttlMs ?? 5 * 60_000,
  };

  const source: PlanningWithFilesSourceConfig = {
    repo: opts.source?.repo ?? 'OthmanAdi/planning-with-files',
    ref: opts.source?.ref ?? 'master',
    skillPath: opts.source?.skillPath ?? 'skills/planning-with-files/SKILL.md',
  };

  const pathsConfig: PlanningWithFilesPathsConfig = {
    claudeSkillsDir: opts.paths?.claudeSkillsDir ?? path.join(os.homedir(), '.claude', 'skills'),
    agentsSkillsDir: opts.paths?.agentsSkillsDir ?? path.join(os.homedir(), '.agents', 'skills'),
  };

  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    logLevel: opts.logLevel ?? 'warn',
    timeoutMs: opts.timeoutMs ?? 15_000,
    cache,
    source,
    paths: pathsConfig,
    fetchImpl,
  };
}

function logFactory(level: PlanningWithFilesLogLevel) {
  const levelOrder: Record<PlanningWithFilesLogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };
  const allow = (min: PlanningWithFilesLogLevel) => levelOrder[level] >= levelOrder[min];
  return {
    error: (...args: unknown[]) => { if (allow('error')) console.error('[planning-with-files]', ...args); },
    warn: (...args: unknown[]) => { if (allow('warn')) console.warn('[planning-with-files]', ...args); },
    info: (...args: unknown[]) => { if (allow('info')) console.log('[planning-with-files]', ...args); },
    debug: (...args: unknown[]) => { if (allow('debug')) console.log('[planning-with-files]', ...args); },
  };
}

class PlanningWithFilesSkillImpl implements PlanningWithFilesSkill {
  private readonly config: Required<PlanningWithFilesResolvedConfig>;
  private readonly log: ReturnType<typeof logFactory>;
  private cacheEntry: { content: string; contentHash: string; fetchedAt: number } | null = null;

  constructor(config: Required<PlanningWithFilesResolvedConfig>) {
    this.config = config;
    this.log = logFactory(config.logLevel);
  }

  getConfig(): Required<PlanningWithFilesResolvedConfig> {
    return this.config;
  }

  async fetchSkillMarkdown(): Promise<{ content: string; contentHash: string; fromCache: boolean }> {
    if (this.config.cache.enabled && this.cacheEntry) {
      const age = Date.now() - this.cacheEntry.fetchedAt;
      if (age <= this.config.cache.ttlMs) {
        return { content: this.cacheEntry.content, contentHash: this.cacheEntry.contentHash, fromCache: true };
      }
    }

    const { repo, ref, skillPath } = this.config.source;
    const url = `https://raw.githubusercontent.com/${repo}/${ref}/${skillPath}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const resp = await this.config.fetchImpl(url, {
        method: 'GET',
        headers: { 'Accept': 'text/plain' },
        signal: controller.signal,
      });

      if (!resp || typeof resp.ok !== 'boolean') {
        throw new PlanningWithFilesError('PWF_INVALID_RESPONSE', 'Fetch returned invalid response');
      }
      if (!resp.ok) {
        const status = (resp as Response).status;
        throw new PlanningWithFilesError('PWF_FETCH_FAILED', `Fetch failed with status ${status}`);
      }

      const content = await (resp as Response).text();
      if (!content || content.trim().length === 0) {
        throw new PlanningWithFilesError('PWF_FETCH_FAILED', 'Fetched SKILL.md is empty');
      }

      const contentHash = sha1(content);
      if (this.config.cache.enabled) {
        this.cacheEntry = { content, contentHash, fetchedAt: Date.now() };
      }
      return { content, contentHash, fromCache: false };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PlanningWithFilesError('PWF_FETCH_TIMEOUT', `Fetch timed out after ${this.config.timeoutMs}ms`, err);
      }
      if (err instanceof PlanningWithFilesError) throw err;
      throw new PlanningWithFilesError('PWF_FETCH_FAILED', 'Failed to fetch skill markdown', err);
    } finally {
      clearTimeout(timer);
    }
  }

  isInstalled(opts: Omit<PlanningWithFilesInstallOptions, 'force'>): boolean {
    const { targetDir, skillFilePath } = this.computeInstallPaths(opts);
    if (!fs.existsSync(targetDir)) return false;
    return fs.existsSync(skillFilePath);
  }

  async install(opts: PlanningWithFilesInstallOptions): Promise<PlanningWithFilesInstallResult> {
    const { force = false } = opts;
    const { targetDir, skillDir, skillFilePath } = this.computeInstallPaths(opts);

    if (!force && fs.existsSync(skillFilePath)) {
      const content = fs.readFileSync(skillFilePath, 'utf8');
      return {
        installed: false,
        fromCache: true,
        targetDir,
        skillFilePath,
        contentHash: sha1(content),
      };
    }

    const fetched = await this.fetchSkillMarkdown();

    try {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFilePath, fetched.content, 'utf8');
      this.log.info(`Installed ${SKILL_ID} to ${skillFilePath}`);
      return {
        installed: true,
        fromCache: fetched.fromCache,
        targetDir,
        skillFilePath,
        contentHash: fetched.contentHash,
      };
    } catch (err) {
      throw new PlanningWithFilesError('PWF_WRITE_FAILED', `Failed to write ${SKILL_FILE}`, err);
    }
  }

  private computeInstallPaths(opts: Omit<PlanningWithFilesInstallOptions, 'force'>): {
    targetDir: string;
    skillDir: string;
    skillFilePath: string;
  } {
    const baseDir = (() => {
      if (opts.scope === 'project') {
        const cwd = (opts.cwd || process.cwd()).trim();
        if (!cwd) throw new PlanningWithFilesError('PWF_INVALID_CWD', 'Project scope requires a valid cwd');
        const resolvedCwd = path.resolve(cwd);
        return path.join(resolvedCwd, '.claude', 'skills');
      }
      return opts.target === 'claude' ? this.config.paths.claudeSkillsDir : this.config.paths.agentsSkillsDir;
    })();

    const targetDir = path.resolve(baseDir);
    const skillDir = path.join(targetDir, SKILL_ID);
    const resolvedSkillDir = path.resolve(skillDir);
    const root = targetDir.endsWith(path.sep) ? targetDir : targetDir + path.sep;
    if (!resolvedSkillDir.startsWith(root)) {
      throw new PlanningWithFilesError('PWF_WRITE_FAILED', 'Resolved skill path escapes target directory');
    }
    const skillFilePath = path.join(resolvedSkillDir, SKILL_FILE);
    return { targetDir, skillDir: resolvedSkillDir, skillFilePath };
  }
}

export function initPlanningWithFilesSkill(opts: PlanningWithFilesInitOptions = {}): PlanningWithFilesSkill {
  const config = resolveDefaultConfig(opts);
  const instance = new PlanningWithFilesSkillImpl(config);
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = instance;
  return instance;
}

export function getPlanningWithFilesSkill(): PlanningWithFilesSkill {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as PlanningWithFilesSkill | undefined;
  if (existing) return existing;
  return initPlanningWithFilesSkill();
}

