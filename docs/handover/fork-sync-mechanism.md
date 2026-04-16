> 产品思考见 [docs/insights/fork-sync-mechanism.md](../insights/fork-sync-mechanism.md)

# Fork 同步机制

CodePilot 需要长期跟随 upstream 快速演进，同时保留 fork 的明确增量能力。如果继续沿用“每次手工看 diff 再临场决定”的方式，随着 upstream 更新频率提高，维护成本会线性甚至超线性上升。

本机制的目标是把同步流程从“人脑记忆 + 临场 patch”改造成“所有权地图 + patch manifest + 自动报告 + 边界检查”的工具化工作流。

## 组成

### 1. 所有权地图

文件：`fork-ownership-map.json`

作用：

- 定义每条路径默认归属 `fork / shared / core / ignore`
- 把原本分散的“经验判断”固化为可执行规则
- 为差异报告和边界检查提供统一来源

典型规则：

- `fork`：文件树、顶部标签/布局、终端/控制台、Git 面板、媒体网关、CC Switch/OLMX
- `shared`：聊天主链路接缝、Bridge/Channels、聊天 UI 接缝
- `core`：平台配置、工具注册层、测试、同步治理脚本
- `ignore`：文档、截图、临时调试产物

### 2. Patch Queue Manifest

文件：`fork-patches.manifest.json`

作用：

- 把 fork 的长期增量能力记录成 patch/overlay 单元
- 每个单元说明：
  - 能力摘要
  - 接缝入口文件
  - 自己拥有的路径
  - 与 upstream 同步时的保留策略

这样在 upstream 更新时，不再问“这堆差异里哪些是我们的核心能力”，而是先看 patch manifest。

### 3. Upstream 差异报告

文件：`scripts/upstream-sync-report.mjs`

命令：

```bash
npm run sync:report
npm run sync:report:write
```

作用：

- 以 `git merge-base HEAD upstream/main` 为共同基线
- 自动分出：
  - `forkExclusive`
  - `upstreamExclusive`
  - `bothChanged`
- 再按 ownership map 分组输出

输出文件：

- `docs/research/upstream-sync-report-latest.md`

### 4. Working Tree 边界检查

文件：`scripts/check-fork-ownership.mjs`

命令：

```bash
npm run sync:ownership
npm run sync:ownership:strict
```

作用：

- 对当前 `git status --short` 里的改动文件做 ownership 归类
- 让开发者在提交前知道自己是否越过了约定边界
- `--strict` 模式下，若出现未知归类文件则直接返回非零退出码，便于后续接入 CI

### 5. Bootstrap 工作流

文件：`scripts/upstream-sync-bootstrap.mjs`

命令：

```bash
npm run sync:bootstrap
npm run sync:bootstrap:branch
```

作用：

- `git fetch upstream --tags --prune`
- 自动解析 `upstream/main` 的最新 tag
- 生成最新 upstream 差异报告
- 运行 ownership 检查
- 输出摘要到 `docs/research/upstream-sync-bootstrap-latest.md`

`sync:bootstrap:branch` 额外会在当前 HEAD 上创建同步分支，分支名格式：

```text
sync/upstream-YYYYMMDD-{latestTag}
```

## 推荐工作流

### 日常开发

```bash
npm run sync:ownership
```

目的：

- 让工作区改动始终处于预期边界内
- 一旦发现 unknown 或明显越界，优先补充 ownership map 或把代码重新下沉到正确模块

### 跟进 upstream 版本

```bash
git checkout integration/official-skeleton
npm run sync:bootstrap:branch
```

随后：

1. 阅读 `docs/research/upstream-sync-report-latest.md`
2. 优先处理 `upstreamExclusive`
3. 对 `bothChanged` 中的 `shared` / 少量 `core` 文件做人工合并
4. 按 `fork-patches.manifest.json` 检查 fork 核心能力是否保留
5. 跑 `npm run test`

## 设计原则

### 原则 1：官方优先

`shared` 和 `core` 路径默认先吸收 upstream，再用最小 patch 回挂 fork 能力。

### 原则 2：Fork 能力整组拥有

文件树、顶部标签、终端、媒体、Git、CC Switch 等能力不应该继续碎片化地散落到更多官方核心文件里。

### 原则 3：接缝文件变薄

`route.ts`、`claude-client.ts`、`agent-loop.ts`、`provider-resolver.ts`、`runtime/*` 只能作为薄接缝，不应持续堆积新的 fork 业务逻辑。

### 原则 4：先看机制，再看代码

任何同步任务都必须先：

1. 看 ownership map
2. 看 patch manifest
3. 跑 sync report

而不是先凭记忆打开多个 diff 页面。

## 当前已知限制

- ownership map 仍然依赖路径模式，不识别“同一文件内不同代码块”的所有权
- patch manifest 目前是人工维护的 JSON，不是自动从代码注解生成
- bootstrap 只负责 fetch / 报告 / 边界检查，不会自动合并 upstream
- 还没有把 `sync:ownership:strict` 接进 CI

## 后续建议

1. 把 `sync:ownership:strict` 接入 pre-commit 或 CI
2. 给 `shared-chat-runtime` 再做一轮真正的 seam 瘦身
3. 继续把 fork 核心能力从官方主链路中外移成 patch/adapter 单元
4. 如果后续 patch 数量继续增长，再考虑把 patch manifest 拆成目录化结构
