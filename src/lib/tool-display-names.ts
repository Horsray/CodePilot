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
  'mcp__filesystem__list_directory_with_sizes': '查看目录(含大小)',
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
  'mcp__fetch__fetch_youtube_transcript': 'YouTube 转录',
  'webfetch__fetch_fetch_readable': '抓取网页(Readable)',
  'webfetch__fetch_fetch_markdown': '抓取网页(Markdown)',

  // GitHub
  'mcp__github__get_file_contents': '获取 GitHub 文件',
  'mcp__github__search_repositories': '搜索 GitHub 仓库',
  'mcp__github__search_code': '搜索 GitHub 代码',
  'mcp__github__search_issues': '搜索 Issue',
  'mcp__github__search_users': '搜索用户',
  'mcp__github__create_issue': '创建 Issue',
  'mcp__github__update_issue': '更新 Issue',
  'mcp__github__get_issue': '获取 Issue',
  'mcp__github__list_issues': '列出 Issue',
  'mcp__github__add_issue_comment': '添加 Issue 评论',
  'mcp__github__create_pull_request': '创建 Pull Request',
  'mcp__github__get_pull_request': '获取 PR',
  'mcp__github__list_pull_requests': '列出 PR',
  'mcp__github__get_pull_request_comments': '获取 PR 评论',
  'mcp__github__get_pull_request_files': '获取 PR 文件',
  'mcp__github__get_pull_request_reviews': '获取 PR Review',
  'mcp__github__get_pull_request_status': '获取 PR 状态',
  'mcp__github__create_pull_request_review': '创建 PR Review',
  'mcp__github__update_pull_request_branch': '更新 PR 分支',
  'mcp__github__merge_pull_request': '合并 PR',
  'mcp__github__create_branch': '创建分支',
  'mcp__github__create_or_update_file': '创建/更新文件',
  'mcp__github__push_files': '推送文件',
  'mcp__github__create_repository': '创建仓库',
  'mcp__github__fork_repository': 'Fork 仓库',
  'mcp__github__list_commits': '列出提交',

  // 记忆
  'mcp__memory__search_nodes': '搜索记忆节点',
  'mcp__memory__read_graph': '读取记忆图谱',
  'mcp__memory__create_entities': '创建记忆实体',
  'mcp__memory__create_relations': '创建记忆关系',
  'mcp__memory__add_observations': '添加记忆观察',
  'mcp__memory__delete_entities': '删除记忆实体',
  'mcp__memory__delete_observations': '删除记忆观察',
  'mcp__memory__delete_relations': '删除记忆关系',
  'mcp__memory__open_nodes': '打开记忆节点',

  // MiniMax
  'mcp__MiniMax__understand_image': '图片理解',
  'mcp__MiniMax__web_search': 'MiniMax 搜索',

  // 百炼搜索
  'mcp__bailian-web-search__bailian_web_search': '百炼搜索',

  // Context7
  'context7_resolve-library-id': '解析库 ID',
  'context7_query-docs': '查询文档',

  // Chrome DevTools 浏览器自动化
  'mcp__chrome-devtools__click': '点击元素',
  'mcp__chrome-devtools__close_page': '关闭页面',
  'mcp__chrome-devtools__drag': '拖拽元素',
  'mcp__chrome-devtools__emulate': '设备模拟',
  'mcp__chrome-devtools__evaluate_script': '执行脚本',
  'mcp__chrome-devtools__fill': '填写输入框',
  'mcp__chrome-devtools__fill_form': '填写表单',
  'mcp__chrome-devtools__get_console_message': '获取控制台消息',
  'mcp__chrome-devtools__get_network_request': '获取网络请求',
  'mcp__chrome-devtools__handle_dialog': '处理弹窗',
  'mcp__chrome-devtools__hover': '悬停元素',
  'mcp__chrome-devtools__lighthouse_audit': 'Lighthouse 审计',
  'mcp__chrome-devtools__list_console_messages': '列出控制台消息',
  'mcp__chrome-devtools__list_network_requests': '列出网络请求',
  'mcp__chrome-devtools__list_pages': '列出页面',
  'mcp__chrome-devtools__navigate_page': '页面导航',
  'mcp__chrome-devtools__new_page': '新建页面',
  'mcp__chrome-devtools__performance_analyze_insight': '性能分析洞察',
  'mcp__chrome-devtools__performance_start_trace': '开始性能追踪',
  'mcp__chrome-devtools__performance_stop_trace': '停止性能追踪',
  'mcp__chrome-devtools__press_key': '按键操作',
  'mcp__chrome-devtools__resize_page': '调整页面大小',
  'mcp__chrome-devtools__select_page': '选择页面',
  'mcp__chrome-devtools__take_memory_snapshot': '内存快照',
  'mcp__chrome-devtools__take_screenshot': '页面截图',
  'mcp__chrome-devtools__take_snapshot': 'DOM 快照',
  'mcp__chrome-devtools__type_text': '输入文本',
  'mcp__chrome-devtools__upload_file': '上传文件',
  'mcp__chrome-devtools__wait_for': '等待条件',

  // Playwright 浏览器自动化
  'mcp__playwright__browser_click': '点击元素',
  'mcp__playwright__browser_close': '关闭浏览器',
  'mcp__playwright__browser_console_messages': '控制台消息',
  'mcp__playwright__browser_drag': '拖拽操作',
  'mcp__playwright__browser_drop': '放置操作',
  'mcp__playwright__browser_evaluate': '执行脚本',
  'mcp__playwright__browser_file_upload': '上传文件',
  'mcp__playwright__browser_fill_form': '填写表单',
  'mcp__playwright__browser_handle_dialog': '处理弹窗',
  'mcp__playwright__browser_hover': '悬停元素',
  'mcp__playwright__browser_navigate': '页面导航',
  'mcp__playwright__browser_navigate_back': '返回上页',
  'mcp__playwright__browser_network_request': '查看网络请求',
  'mcp__playwright__browser_network_requests': '列出网络请求',
  'mcp__playwright__browser_press_key': '按键操作',
  'mcp__playwright__browser_resize': '调整窗口',
  'mcp__playwright__browser_run_code_unsafe': '运行代码(不安全)',
  'mcp__playwright__browser_select_option': '选择下拉项',
  'mcp__playwright__browser_snapshot': '页面快照',
  'mcp__playwright__browser_tabs': '管理标签页',
  'mcp__playwright__browser_take_screenshot': '页面截图',
  'mcp__playwright__browser_type': '输入文本',
  'mcp__playwright__browser_wait_for': '等待条件',

  // RAG 知识库
  'mcp__rag__add_directory': '索引目录',
  'mcp__rag__add_document': '索引文档',
  'mcp__rag__add_file': '索引文件',
  'mcp__rag__add_url': '索引网页',
  'mcp__rag__collection_info': '集合信息',
  'mcp__rag__delete_collection': '删除集合',
  'mcp__rag__delete_source': '删除来源',
  'mcp__rag__list_collections': '列出集合',
  'mcp__rag__search': '知识库搜索',

  // OMC 插件工具
  'mcp__plugin_oh-my-claudecode_t__ast_grep_search': 'AST 代码搜索',
  'mcp__plugin_oh-my-claudecode_t__ast_grep_replace': 'AST 代码替换',
  'mcp__plugin_oh-my-claudecode_t__lsp_hover': 'LSP 悬停信息',
  'mcp__plugin_oh-my-claudecode_t__lsp_goto_definition': '跳转到定义',
  'mcp__plugin_oh-my-claudecode_t__lsp_find_references': '查找引用',
  'mcp__plugin_oh-my-claudecode_t__lsp_diagnostics': '诊断信息',
  'mcp__plugin_oh-my-claudecode_t__lsp_diagnostics_directory': '目录诊断',
  'mcp__plugin_oh-my-claudecode_t__lsp_document_symbols': '文档符号',
  'mcp__plugin_oh-my-claudecode_t__lsp_workspace_symbols': '工作区符号',
  'mcp__plugin_oh-my-claudecode_t__lsp_code_actions': '代码操作',
  'mcp__plugin_oh-my-claudecode_t__lsp_code_action_resolve': '解析代码操作',
  'mcp__plugin_oh-my-claudecode_t__lsp_prepare_rename': '准备重命名',
  'mcp__plugin_oh-my-claudecode_t__lsp_rename': '重命名符号',
  'mcp__plugin_oh-my-claudecode_t__lsp_servers': 'LSP 服务器',
  'mcp__plugin_oh-my-claudecode_t__notepad_read': '读取记事本',
  'mcp__plugin_oh-my-claudecode_t__notepad_write_working': '写入工作记事本',
  'mcp__plugin_oh-my-claudecode_t__notepad_write_priority': '写入优先记事本',
  'mcp__plugin_oh-my-claudecode_t__notepad_write_manual': '手动写入记事本',
  'mcp__plugin_oh-my-claudecode_t__notepad_stats': '记事本统计',
  'mcp__plugin_oh-my-claudecode_t__notepad_prune': '清理记事本',
  'mcp__plugin_oh-my-claudecode_t__project_memory_read': '读取项目记忆',
  'mcp__plugin_oh-my-claudecode_t__project_memory_write': '写入项目记忆',
  'mcp__plugin_oh-my-claudecode_t__project_memory_add_note': '添加项目笔记',
  'mcp__plugin_oh-my-claudecode_t__project_memory_add_directive': '添加项目指令',
  'mcp__plugin_oh-my-claudecode_t__shared_memory_read': '读取共享记忆',
  'mcp__plugin_oh-my-claudecode_t__shared_memory_write': '写入共享记忆',
  'mcp__plugin_oh-my-claudecode_t__shared_memory_list': '列出共享记忆',
  'mcp__plugin_oh-my-claudecode_t__shared_memory_delete': '删除共享记忆',
  'mcp__plugin_oh-my-claudecode_t__shared_memory_cleanup': '清理共享记忆',
  'mcp__plugin_oh-my-claudecode_t__state_read': '读取状态',
  'mcp__plugin_oh-my-claudecode_t__state_write': '写入状态',
  'mcp__plugin_oh-my-claudecode_t__state_get_status': '获取状态',
  'mcp__plugin_oh-my-claudecode_t__state_list_active': '列出活跃状态',
  'mcp__plugin_oh-my-claudecode_t__state_clear': '清除状态',
  'mcp__plugin_oh-my-claudecode_t__session_search': '搜索会话历史',
  'mcp__plugin_oh-my-claudecode_t__trace_timeline': '追踪时间线',
  'mcp__plugin_oh-my-claudecode_t__trace_summary': '追踪摘要',
  'mcp__plugin_oh-my-claudecode_t__python_repl': 'Python REPL',
  'mcp__plugin_oh-my-claudecode_t__list_omc_skills': '列出 OMC 技能',
  'mcp__plugin_oh-my-claudecode_t__load_omc_skills_global': '加载全局技能',
  'mcp__plugin_oh-my-claudecode_t__load_omc_skills_local': '加载本地技能',
  'mcp__plugin_oh-my-claudecode_t__deepinit_manifest': '深度初始化清单',
  'mcp__plugin_oh-my-claudecode_t__wiki_list': '列出 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_read': '读取 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_add': '添加 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_delete': '删除 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_query': '查询 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_ingest': '导入 Wiki',
  'mcp__plugin_oh-my-claudecode_t__wiki_lint': '检查 Wiki',

  // 其他
  'mcp__sequential-thinking__sequentialthinking': '顺序思考',
  'mcp__markitdown__convert_to_markdown': '转为 Markdown',
  'ToolSearch': '搜索工具',
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
  'Team': '团队协作',
  'Task': '任务管理',
  'TodoWrite': '更新任务列表',
  'WebSearch': '联网搜索',
  'WebFetch': '网页抓取',
  'AskUserQuestion': '向用户提问',
  'ExitPlanMode': '退出计划模式',
  'EnterPlanMode': '进入计划模式',
  'EnterWorktree': '进入工作树',
  'ExitWorktree': '退出工作树',
  'TaskStop': '停止任务',
  'TaskCreate': '创建任务',
  'TaskUpdate': '更新任务',
  'TaskGet': '获取任务',
  'TaskList': '列出任务',
  'TaskOutput': '任务输出',
  'NotebookEdit': '编辑笔记本',
  'SendMessage': '发送消息',
  'Monitor': '监控进程',
  'CronCreate': '创建定时任务',
  'CronDelete': '删除定时任务',
  'CronList': '列出定时任务',
  'ToolSearch': '搜索工具',
  'PushNotification': '推送通知',
  'RemoteTrigger': '远程触发',
  'ListMcpResourcesTool': '列出 MCP 资源',
  'ReadMcpResourceTool': '读取 MCP 资源',
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
  if (lowerName === 'team' || lowerName.includes('__team')) {
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
  if (lowerName.includes('plugin_oh-my-claudecode')) {
    return `OMC 工具 | ${short}`;
  }
  if (lowerName.includes('rag__')) {
    return `知识库 | ${short}`;
  }
  if (lowerName.includes('sequential-thinking') || lowerName.includes('sequentialthinking')) {
    return `顺序思考 | ${short}`;
  }
  if (lowerName.includes('markitdown')) {
    return `文档转换 | ${short}`;
  }
  if (lowerName.includes('fetch') && lowerName.includes('youtube')) {
    return `YouTube 转录 | ${short}`;
  }

  // bare-name builtin that wasn't in the map
  if (BUILTIN_TOOL_NAME_MAP[name]) {
    return BUILTIN_TOOL_NAME_MAP[name];
  }

  // Last resort: return raw name
  return name;
}
