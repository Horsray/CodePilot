# Planning With Files Skill（全局技能模块）

## 背景

本模块用于在 CodePilot 项目内提供一个“全局可用”的能力封装，用于拉取并安装第三方 Claude Code Skill：`planning-with-files`，并以统一 API 的形式在项目内复用。其上游源代码仓库：

- https://github.com/OthmanAdi/planning-with-files

该 Skill 的核心逻辑以 `SKILL.md` 的 Agent Skill 形式存在，安装到 `~/.claude/skills/` 或 `~/.agents/skills/` 后，CodePilot 的 Skills 体系可自动扫描并展示。

## 安装步骤

### 1) 代码内调用安装（推荐）

在任意 Node 侧（Next.js server / Electron main / 脚本）调用：

```ts
import { initPlanningWithFilesSkill } from '@/lib/planning-with-files';

const pwf = initPlanningWithFilesSkill({
  logLevel: 'info',
  timeoutMs: 15000,
  cache: { enabled: true, ttlMs: 5 * 60_000 },
});

await pwf.install({ target: 'claude', scope: 'global', force: false });
```

### 2) Project scope 安装（放进当前项目）

```ts
import { getPlanningWithFilesSkill } from '@/lib/planning-with-files';

await getPlanningWithFilesSkill().install({
  target: 'claude',
  scope: 'project',
  cwd: process.cwd(),
  force: true,
});
```

## API 列表

模块文件：`src/lib/planning-with-files.ts`

### `initPlanningWithFilesSkill(options?)`

创建并注册全局单例（存放在 `globalThis`），并返回服务实例。

参数（可选）：

- `logLevel`: `'silent' | 'error' | 'warn' | 'info' | 'debug'`
- `timeoutMs`: 请求超时（ms）
- `cache`: `{ enabled?: boolean; ttlMs?: number }`（进程内缓存）
- `source`: `{ repo?: string; ref?: string; skillPath?: string }`（上游源配置）
- `paths`: `{ claudeSkillsDir?: string; agentsSkillsDir?: string }`（安装目录覆盖，主要用于测试/自定义）
- `fetchImpl`: 自定义 fetch（主要用于测试/代理）

### `getPlanningWithFilesSkill()`

获取全局单例；如未初始化则按默认配置初始化。

### `skill.install(opts)`

安装 Skill（下载上游 `SKILL.md` 并写入目标目录）。

参数：

- `target`: `'claude' | 'agents'`
- `scope`: `'global' | 'project'`
- `cwd?`: `scope: 'project'` 时需要（默认使用 `process.cwd()`）
- `force?`: `true` 强制覆盖已存在的 `SKILL.md`

返回：

- `installed`: 是否实际发生写入
- `fromCache`: 是否命中进程内缓存
- `targetDir`: 目标 skills 根目录
- `skillFilePath`: 最终写入的 `SKILL.md` 完整路径
- `contentHash`: 写入内容的 sha1

### `skill.isInstalled(opts)`

检查目标位置是否已存在对应的 `SKILL.md`。

### `skill.fetchSkillMarkdown()`

拉取上游 `SKILL.md` 并返回 `{ content, contentHash, fromCache }`。

## 错误码说明

抛出的错误类型为 `PlanningWithFilesError`，包含字段：

- `code`: `PlanningWithFilesErrorCode`
- `message`
- `cause?`

错误码：

- `PWF_FETCH_TIMEOUT`: 拉取上游内容超时
- `PWF_FETCH_FAILED`: 拉取失败（HTTP 非 2xx 或网络异常）
- `PWF_INVALID_RESPONSE`: fetch 返回非预期对象
- `PWF_WRITE_FAILED`: 写入 `SKILL.md` 失败（权限/路径冲突等）
- `PWF_INVALID_CWD`: project scope 的 cwd 无效

## 性能基准（基于实现的可预期上限）

本模块主要成本在网络请求与一次性文件写入：

- 冷启动：一次 HTTPS 拉取 + 单文件写入（`SKILL.md`）
- 热路径：命中进程内缓存（TTL 内）时为 O(1) 内存读取 + 写文件（force）或直接跳过（不 force 且已存在）

基准建议（用于本地自测）：

- `install(force: false)` 在已安装情况下应接近“零网络开销”
- 缓存开启且 TTL 内重复安装到不同 target（claude/agents）只产生 1 次网络请求

## 测试

单元测试文件：

- `src/__tests__/unit/planning-with-files-skill.test.ts`

覆盖点：

- 正常安装（global / project）
- 缓存命中
- 超时异常
- 写入异常

