/**
 * 工具名称映射：将原始 MCP 工具名转换为人类可读的中文名称。
 * 展示格式：{可读名称} | {原始工具名}
 */

const MCP_TOOL_NAME_MAP: Record<string, string> = {
  // CodePilot 内置 MCP
  'mcp__codepilot-memory-search__codepilot_memory_recent': '记忆召回',
  'mcp__codepilot-notify__codepilot_notify': '发送通知',
  'mcp__codepilot-todo__TodoWrite': '更新任务列表',
  'mcp__codepilot-todo__codepilot_todo_write': '更新任务列表',
  'mcp__codepilot-todo__codepilot_skill_create': '沉淀技能',
  'mcp__codepilot-todo__codepilot_mcp_activate': '激活 MCP 工具',
  'mcp__codepilot-widget__codepilot_load_widget_guidelines': '加载组件规范',
  'mcp__codepilot-widget-guidelines__codepilot_load_widget_guidelines': '加载组件规范',
  'mcp__codepilot-media__codepilot_import_media': '导入媒体',
  'mcp__codepilot-image-gen__codepilot_generate_image': '生成图片',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_list': '查看 CLI 工具',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_add': '添加 CLI 工具',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_remove': '移除 CLI 工具',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_check_updates': '检查 CLI 更新',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_update': '更新 CLI 工具',
  'mcp__codepilot-cli-tools__codepilot_cli_tools_install': '安装 CLI 工具',
  'mcp__codepilot-dashboard__codepilot_dashboard_pin': '固定到仪表盘',
  'mcp__codepilot-dashboard__codepilot_dashboard_list': '查看仪表盘',
  'mcp__codepilot-dashboard__codepilot_dashboard_refresh': '刷新仪表盘',
  'mcp__codepilot-dashboard__codepilot_dashboard_update': '更新仪表盘',
  'mcp__codepilot-dashboard__codepilot_dashboard_remove': '移除仪表盘项',
  'mcp__codepilot-team__Team': '团队协作',
  'mcp__codepilot-ask-user__AskUserQuestion': '向用户提问',
  'mcp__codepilot-browser__codepilot_browser_navigate': '浏览器导航',
  'mcp__codepilot-browser__codepilot_browser_snapshot': '浏览器截图',

  // 文件系统
  'mcp__filesystem__read_file': '读取文件',
  'mcp__filesystem__read_text_file': '读取文本文件',
  'mcp__filesystem__read_media_file': '读取媒体文件',
  'mcp__filesystem__read_multiple_files': '读取多个文件',
  'mcp__filesystem__write_file': '写入文件',
  'mcp__filesystem__edit_file': '编辑文件',
  'mcp__filesystem__create_directory': '创建目录',
  'mcp__filesystem__list_directory': '查看目录内容',
  'mcp__filesystem__list_allowed_directories': '查看允许目录',
  'mcp__filesystem__directory_tree': '查看目录树',
  'mcp__filesystem__move_file': '移动文件',
  'mcp__filesystem__search_files': '搜索文件',
  'mcp__filesystem__get_file_info': '获取文件信息',

  // 网页抓取
  'mcp__fetch__fetch_html': '抓取网页(HTML)',
  'mcp__fetch__fetch_markdown': '抓取网页(Markdown)',
  'mcp__fetch__fetch_txt': '抓取网页(文本)',
  'mcp__fetch__fetch_json': '抓取网页(JSON)',
  'mcp__fetch__fetch_readable': '抓取网页(Readable)',
  'webfetch__fetch_fetch_readable': '抓取网页(Readable)',
  'webfetch__fetch_fetch_markdown': '抓取网页(Markdown)',

  // GitHub
  'mcp__github__get_file_contents': '获取 GitHub 文件',
  'mcp__github__search_repositories': '搜索 GitHub 仓库',
  'mcp__github__search_code': '搜索 GitHub 代码',
  'mcp__github__create_issue': '创建 GitHub Issue',
  'mcp__github__create_pull_request': '创建 Pull Request',

  // 记忆
  'mcp__memory__search_nodes': '搜索记忆节点',
  'mcp__memory__read_graph': '读取记忆图谱',
  'mcp__memory__create_entities': '创建记忆实体',
  'mcp__memory__add_observations': '添加记忆观察',
  'mcp__memory__open_nodes': '打开记忆节点',

  // Context7
  'context7_resolve-library-id': '解析库 ID',
  'context7_query-docs': '查询文档',
};

/** 内置工具中文名映射 */
const BUILTIN_TOOL_NAME_MAP: Record<string, string> = {
  'Read': '读取文件',
  'Write': '写入文件',
  'Edit': '编辑文件',
  'Bash': '执行命令',
  'Glob': '文件搜索',
  'Grep': '内容搜索',
  'Skill': '调用技能',
  'Agent': '启动子代理',
  'Task': '任务管理',
  'TodoWrite': '更新任务列表',
  'WebSearch': '联网搜索',
  'WebFetch': '网页抓取',
  'AskUserQuestion': '向用户提问',
  'ExitPlanMode': '退出计划模式',
  'EnterPlanMode': '进入计划模式',
  'TaskStop': '停止任务',
  'NotebookEdit': '编辑笔记本',
};

/**
 * 提取 MCP 工具的短名称。
 * 例如 'mcp__codepilot-ask-user__AskUserQuestion' → 'AskUserQuestion'
 */
function extractShortName(name: string): string {
  const idx = name.lastIndexOf('__');
  if (idx !== -1) return name.slice(idx + 2);
  return name;
}

/** 获取工具的可读展示名称，格式：{可读名称} | {短名称} */
export function getToolDisplayName(name: string): string {
  const readable = MCP_TOOL_NAME_MAP[name] ?? BUILTIN_TOOL_NAME_MAP[name];
  const short = extractShortName(name);

  if (readable) {
    // 如果短名称已经等于可读名称（非 MCP 工具），只返回可读名称
    if (readable === short) return readable;
    return `${readable} | ${short}`;
  }

  // 模糊匹配
  const lowerName = name.toLowerCase();

  if (lowerName.includes('websearch') || lowerName.includes('web_search')) {
    return `联网搜索 | ${short}`;
  }
  if (lowerName.includes('webfetch') || (lowerName.includes('fetch') && !lowerName.includes('filesystem'))) {
    return `网页抓取 | ${short}`;
  }
  if (lowerName.includes('memory')) {
    if (lowerName.includes('search') || lowerName.includes('recent')) return `记忆召回 | ${short}`;
    if (lowerName.includes('store') || lowerName.includes('save') || lowerName.includes('write')) return `记忆整理 | ${short}`;
    return `记忆操作 | ${short}`;
  }
  if (lowerName.includes('filesystem')) {
    if (lowerName.includes('read_multiple')) return `读取多个文件 | ${short}`;
    if (lowerName.includes('read_text') || lowerName.includes('read_file')) return `读取文件 | ${short}`;
    if (lowerName.includes('list_dir')) return `查看目录内容 | ${short}`;
    if (lowerName.includes('dir_tree') || lowerName.includes('directory_tree')) return `查看目录树 | ${short}`;
    if (lowerName.includes('write')) return `写入文件 | ${short}`;
    if (lowerName.includes('search')) return `搜索文件 | ${short}`;
    return `文件系统操作 | ${short}`;
  }
  if (lowerName.includes('codepilot-ask-user') || lowerName.includes('askuserquestion')) {
    return `向用户提问 | ${short}`;
  }
  if (lowerName.includes('codepilot-todo') || lowerName.includes('todowrite')) {
    return `更新任务列表 | ${short}`;
  }
  if (lowerName.includes('codepilot-team') || lowerName.includes('__team')) {
    return `团队协作 | ${short}`;
  }
  if (lowerName.includes('codepilot-browser')) {
    return `浏览器操作 | ${short}`;
  }
  if (lowerName.includes('codepilot-notify')) {
    return `发送通知 | ${short}`;
  }
  if (lowerName.includes('codepilot-widget')) {
    return `组件操作 | ${short}`;
  }
  if (lowerName.includes('codepilot-media') || lowerName.includes('codepilot_image')) {
    return `媒体操作 | ${short}`;
  }
  if (lowerName.includes('codepilot-cli-tools')) {
    return `CLI 工具管理 | ${short}`;
  }
  if (lowerName.includes('codepilot-dashboard')) {
    return `仪表盘操作 | ${short}`;
  }
  if (lowerName.includes('github')) {
    return `GitHub 操作 | ${short}`;
  }
  if (lowerName.includes('context7')) {
    return `文档查询 | ${short}`;
  }
  if (lowerName.includes('playwright') || lowerName.includes('chrome-devtools')) {
    return `浏览器自动化 | ${short}`;
  }

  // bare-name builtin that wasn't in the map
  if (BUILTIN_TOOL_NAME_MAP[name]) {
    return BUILTIN_TOOL_NAME_MAP[name];
  }

  // Last resort: return raw name
  return name;
}
