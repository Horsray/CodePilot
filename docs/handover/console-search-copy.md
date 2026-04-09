> 产品思考见 [docs/insights/console-search-copy.md](../insights/console-search-copy.md)

# Console 搜索与复制功能交接

## 变更范围

- 控制台组件：[ConsolePanel.tsx](../../src/components/console/ConsolePanel.tsx)
- 搜索/复制公共能力：[console-utils.ts](../../src/lib/console-utils.ts)
- 单元测试：[console-utils.test.ts](../../src/__tests__/unit/console-utils.test.ts)
- i18n：`src/i18n/en.ts`、`src/i18n/zh.ts`

## 功能点

### 1) 模糊检索

- 新增实时搜索输入框，支持空格分词的多关键词 AND 匹配
- 支持忽略大小写和部分匹配
- 支持关键词高亮（`<mark>`）
- 搜索后自动滚动到第一个匹配项
- 快捷操作：
  - `Ctrl/Cmd + K` 聚焦搜索框
  - `Esc` 清空搜索词
  - `Alt + M` 切换“仅显示匹配项 / 显示全部日志”

### 2) 复制能力

- 每行日志右侧新增单行复制按钮
- 每行左侧新增勾选按钮，支持多选批量复制
- `Ctrl/Cmd + C` 复制当前已选日志（输入框焦点下不拦截）
- 复制内容格式固定为：
  - `HH:mm:ss.SSS [level] message (source)`
- 复制成功/失败使用全局 Toast 提示

### 3) 大数据性能

- 控制台改为 `react-virtuoso` 虚拟滚动，避免 1w 行全量 DOM 渲染
- 日志上限从 2000 提升到 10000
- 搜索算法线性扫描 + 轻量分词，单测验证 1w 行匹配小于 100ms

## API 说明（src/lib/console-utils.ts）

- `parseSearchKeywords(query: string): string[]`
  - 输入搜索字符串，按空白字符拆分并转小写
- `isConsoleEntryMatched(entry, keywords): boolean`
  - 判断日志是否满足多关键词 AND 匹配
- `getHighlightRanges(text, keywords): Array<[number, number]>`
  - 返回高亮区间，自动合并重叠范围
- `formatConsoleTimestamp(ts: number): string`
  - 输出 `HH:mm:ss.SSS`
- `formatConsoleEntryForCopy(entry): string`
  - 输出可复制日志行（保留时间、级别、消息、来源）
- `copyTextToClipboard(text): Promise<boolean>`
  - 优先 `navigator.clipboard.writeText`
  - 降级 `document.execCommand('copy')`，兼容旧浏览器

## 验证结果

- `npm run typecheck` ✅
- `npx eslint src/components/console/ConsolePanel.tsx src/lib/console-utils.ts src/__tests__/unit/console-utils.test.ts` ✅
- `npx tsx --test src/__tests__/unit/console-utils.test.ts` ✅
- `npm run test:unit` ⚠️ 当前仓库存在 `better-sqlite3` Node ABI 不匹配，非本次改动引入

## 演示视频脚本

建议录制 60~90 秒，覆盖以下镜头：

1. 控制台持续输出日志后，输入 `error timeout`，展示实时过滤和高亮
2. 按 `Alt + M` 在“仅匹配/全部日志”间切换
3. 按 `Esc` 清空检索
4. 点击单行复制按钮，展示成功 Toast
5. 勾选多条日志后按 `Ctrl/Cmd + C`，展示批量复制 Toast
6. 快速滚动到大量日志区域，展示虚拟滚动不卡顿
