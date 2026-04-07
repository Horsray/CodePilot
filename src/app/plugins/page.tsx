"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Package, Plus, Check, SpinnerGap } from "@/components/ui/icon";
import { showToast } from "@/hooks/useToast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Plugin {
  name: string;
  description: string;
  author?: { name: string; url?: string };
  path: string;
  marketplace: string;
  location: 'plugins' | 'external_plugins';
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
  blocked: boolean;
  enabled: boolean;
}

// 推荐的插件列表 - 来自多个插件市场
const recommendedPlugins = [
  // === UI/UX 设计类插件 ===
  {
    name: "ui-component-generator",
    description: "UI组件生成器 - 生成React/Vue组件、样式优化、响应式设计",
    author: { name: "MadAppGang" },
    marketplace: "mag-claude-plugins",
    tags: ["UI", "前端", "组件"],
  },
  {
    name: "design-system-helper",
    description: "设计系统助手 - 维护设计一致性、颜色/字体规范管理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["UI", "设计系统"],
  },
  {
    name: "css-optimizer",
    description: "CSS优化器 - 清理无用样式、优化CSS性能",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["CSS", "性能"],
  },
  {
    name: "tailwind-helper",
    description: "Tailwind助手 - Tailwind CSS类名建议、自定义配置",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Tailwind", "CSS"],
  },
  {
    name: "figma-to-code",
    description: "Figma转代码 - 将Figma设计转换为代码",
    author: { name: "MadAppGang" },
    marketplace: "mag-claude-plugins",
    tags: ["Figma", "设计", "转换"],
  },
  
  // === 依赖管理类插件 ===
  {
    name: "dependency-updater",
    description: "依赖更新器 - 自动检查更新、安全漏洞扫描、版本管理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["依赖", "安全", "更新"],
  },
  {
    name: "npm-audit-helper",
    description: "NPM审计助手 - 分析依赖安全性、提供修复建议",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["NPM", "安全", "审计"],
  },
  {
    name: "lockfile-manager",
    description: "Lock文件管理器 - 解决依赖冲突、合并lock文件",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["依赖", "Git", "冲突"],
  },
  
  // === 数据库类插件 ===
  {
    name: "mysql-mcp",
    description: "MySQL MCP - 数据库连接、SQL生成、数据操作",
    author: { name: "Anthropic" },
    marketplace: "official",
    tags: ["数据库", "MySQL", "SQL"],
  },
  {
    name: "postgres-mcp",
    description: "PostgreSQL MCP - PostgreSQL数据库管理和查询",
    author: { name: "Anthropic" },
    marketplace: "official",
    tags: ["数据库", "PostgreSQL"],
  },
  {
    name: "database-designer",
    description: "数据库设计师 - 数据库 schema 设计、索引优化",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["数据库", "设计", "优化"],
  },
  
  // === API开发类插件 ===
  {
    name: "openapi-generator",
    description: "OpenAPI生成器 - 从代码生成OpenAPI规范、API文档",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["API", "OpenAPI", "文档"],
  },
  {
    name: "api-testing",
    description: "API测试助手 - 生成API测试用例、自动化测试",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["API", "测试"],
  },
  {
    name: "graphql-helper",
    description: "GraphQL助手 - GraphQL schema设计、查询优化",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["GraphQL", "API"],
  },
  
  // === 云服务类插件 ===
  {
    name: "aws-helper",
    description: "AWS助手 - AWS服务管理、部署辅助",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["AWS", "云", "部署"],
  },
  {
    name: "docker-manager",
    description: "Docker管理器 - Dockerfile生成、容器管理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Docker", "容器"],
  },
  {
    name: "kubernetes-helper",
    description: "K8s助手 - Kubernetes配置生成、部署管理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Kubernetes", "容器编排"],
  },
  
  // === 代码质量类插件 ===
  {
    name: "linter-config",
    description: "Linter配置 - ESLint/Prettier配置管理、规则优化",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["代码质量", "Lint"],
  },
  {
    name: "type-checker",
    description: "类型检查助手 - TypeScript类型优化、类型安全",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["TypeScript", "类型"],
  },
  {
    name: "import-organizer",
    description: "导入组织器 - 自动整理导入语句、循环依赖检测",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["代码组织", "导入"],
  },
  
  // === 工作流类插件 ===
  {
    name: "task-automation",
    description: "任务自动化 - 自动化重复任务、批处理操作",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["自动化", "效率"],
  },
  {
    name: "workflow-designer",
    description: "工作流设计器 - CI/CD流程设计、自动化工作流",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["工作流", "自动化"],
  },
  {
    name: "notification-manager",
    description: "通知管理器 - 集成通知服务、提醒管理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["通知", "集成"],
  },
  
  // Ariff 插件市场 (65个插件) - 开发类
  {
    name: "architect",
    description: "系统架构师 - 设计系统架构、技术选型和模块划分",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["架构", "设计"],
  },
  {
    name: "security-analyst",
    description: "安全分析师 - 检查代码安全漏洞、OWASP合规性",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["安全", "漏洞检测"],
  },
  {
    name: "performance-engineer",
    description: "性能工程师 - 优化代码性能、分析瓶颈",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["性能", "优化"],
  },
  {
    name: "qa-engineer",
    description: "QA工程师 - 测试策略、测试用例设计",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["测试", "QA"],
  },
  {
    name: "refactorer",
    description: "重构专家 - 代码重构建议和实施",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["重构", "代码质量"],
  },
  {
    name: "systematic-debugger",
    description: "系统化调试器 - 根因分析、内存泄漏检测",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["调试", "问题排查"],
  },
  {
    name: "project-planner",
    description: "项目规划师 - 功能拆分、任务规划",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["规划", "项目管理"],
  },
  {
    name: "mentor",
    description: "导师 - 解释概念、代码教学",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["学习", "教学"],
  },
  // Ariff - 反幻觉套件
  {
    name: "hallucination-guard",
    description: "幻觉防护 - 检测AI的推测性语言和未经验证的声明",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["安全", "AI可靠性"],
  },
  {
    name: "cross-checker",
    description: "交叉验证 - 从多个角度验证代码声明",
    author: { name: "Ariff Plugins" },
    marketplace: "ariff-plugins",
    tags: ["验证", "准确性"],
  },
  // MSApps 插件市场 (21个插件) - 工具类
  {
    name: "google-drive-upload",
    description: "Google Drive上传 - 上传文件到Google Drive",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["云存储", "文件"],
  },
  {
    name: "youtube-transcriber",
    description: "YouTube转录 - 转录YouTube视频和播放列表",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["视频", "转录"],
  },
  {
    name: "toggl-time-tracker",
    description: "Toggl时间追踪 - 开始/停止计时器、生成报告",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["时间管理", "生产力"],
  },
  {
    name: "mac-disk-cleaner",
    description: "Mac磁盘清理 - 清理缓存、释放磁盘空间",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["系统工具", "清理"],
  },
  {
    name: "notion-memory",
    description: "Notion记忆 - 跨会话的长期记忆存储",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["知识管理", "记忆"],
  },
  {
    name: "apify-scraper",
    description: "Apify爬虫 - 网页抓取、数据提取",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["爬虫", "数据"],
  },
  {
    name: "wordpress-mcp",
    description: "WordPress管理 - 管理WordPress站点、文章、用户",
    author: { name: "MSApps" },
    marketplace: "msapps-plugins",
    tags: ["CMS", "网站管理"],
  },
  // 官方插件
  {
    name: "code-review",
    description: "代码审查助手 - 自动检查代码质量、潜在bug和性能问题",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["代码质量", "审查"],
  },
  {
    name: "test-gen",
    description: "测试生成器 - 根据代码自动生成单元测试和集成测试",
    author: { name: "CodePilot Official" },
    marketplace: "official", 
    tags: ["测试", "自动化"],
  },
  {
    name: "doc-writer",
    description: "文档生成助手 - 自动为代码生成注释和文档",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["文档", "注释"],
  },
  {
    name: "git-assistant",
    description: "Git助手 - 智能提交信息生成、分支管理建议",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Git", "版本控制"],
  },
  {
    name: "pr-analyzer",
    description: "PR分析器 - 分析Pull Request、生成审查摘要",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Git", "代码审查"],
  },
  {
    name: "commit-message-generator",
    description: "提交信息生成器 - 根据代码变更生成规范的提交信息",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["Git", "效率"],
  },
  {
    name: "error-explainer",
    description: "错误解释器 - 解释错误信息、提供解决方案",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["调试", "学习"],
  },
  {
    name: "api-docs-generator",
    description: "API文档生成器 - 从代码自动生成API文档",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["文档", "API"],
  },
  {
    name: "ci-cd-helper",
    description: "CI/CD助手 - 帮助配置持续集成和部署流程",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["DevOps", "自动化"],
  },
  {
    name: "security-scanner",
    description: "安全扫描器 - 扫描依赖漏洞、配置安全问题",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["安全", "扫描"],
  },
  {
    name: "tdd-workflow",
    description: "TDD工作流 - 测试驱动开发指导和辅助",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["测试", "TDD"],
  },
  {
    name: "refactor-assistant",
    description: "重构助手 - 识别重构机会、提供重构建议",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["重构", "代码质量"],
  },
  {
    name: "performance-optimizer",
    description: "性能优化器 - 识别性能瓶颈、提供优化建议",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["性能", "优化"],
  },
  {
    name: "brainstorming",
    description: "头脑风暴 - 生成创意、解决方案探索",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["创意", "规划"],
  },
  {
    name: "github",
    description: "GitHub助手 - GitHub操作、PR管理、Issue处理",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["GitHub", "协作"],
  },
  {
    name: "canvas-api",
    description: "Canvas API - 与Canvas LMS集成",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["教育", "LMS"],
  },
  {
    name: "root-cause-tracing",
    description: "根因追踪 - 系统性问题分析和根因定位",
    author: { name: "CodePilot Official" },
    marketplace: "official",
    tags: ["调试", "分析"],
  },
];

export default function PluginsPage() {
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("installed");
  const [toggling, setToggling] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    fetchInstalledPlugins();
  }, []);

  const fetchInstalledPlugins = async () => {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        setInstalledPlugins(data.plugins || []);
      }
    } catch (error) {
      console.error('Failed to fetch plugins:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePlugin = async (plugin: Plugin) => {
    const pluginKey = `${plugin.name}@${plugin.marketplace}`;
    setToggling(pluginKey);
    
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          pluginKey, 
          enabled: !plugin.enabled 
        }),
      });
      
      if (res.ok) {
        setInstalledPlugins(prev => prev.map(p => 
          p.name === plugin.name && p.marketplace === plugin.marketplace
            ? { ...p, enabled: !p.enabled }
            : p
        ));
        showToast({ 
          type: "success", 
          message: plugin.enabled ? `已禁用：${plugin.name}` : `已启用：${plugin.name}`
        });
      }
    } catch {
      showToast({ type: "error", message: "操作失败" });
    } finally {
      setToggling(null);
    }
  };

  const installPlugin = async (pluginName: string) => {
    setInstalling(pluginName);
    showToast({ type: "info", message: `正在安装 ${pluginName}...` });
    
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginName }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        showToast({ type: "success", message: `插件 ${pluginName} 安装成功` });
        // 刷新已安装插件列表
        await fetchInstalledPlugins();
        // 切换到已安装标签页
        setActiveTab("installed");
      } else {
        showToast({ type: "error", message: data.error || '安装失败' });
      }
    } catch (error) {
      showToast({ type: "error", message: '安装请求失败' });
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package size={28} />
            插件管理
          </h1>
          <p className="text-muted-foreground mt-1">
            管理已安装的 Claude 插件
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="installed">
            已安装
            {installedPlugins.length > 0 && (
              <Badge variant="secondary" className="ml-2">{installedPlugins.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recommended">推荐插件</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="flex-1">
          {installedPlugins.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package size={48} className="text-muted-foreground mb-4" />
                <p className="text-muted-foreground">暂无已安装插件</p>
                <p className="text-xs text-muted-foreground mt-2">
                  使用 <code>claude plugin install &lt;plugin-name&gt;</code> 安装插件
                </p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => setActiveTab("recommended")}
                >
                  查看推荐插件
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-3">
                {installedPlugins.map((plugin) => (
                  <Card key={`${plugin.name}@${plugin.marketplace}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{plugin.name}</CardTitle>
                          <Badge variant="outline">{plugin.marketplace}</Badge>
                          {plugin.blocked && (
                            <Badge variant="destructive">已阻止</Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-1">
                          {plugin.description}
                        </CardDescription>
                        {plugin.author && (
                          <p className="text-xs text-muted-foreground mt-1">
                            by {plugin.author.name}
                          </p>
                        )}
                        <div className="flex gap-1 mt-2">
                          {plugin.hasCommands && (
                            <Badge variant="secondary" className="text-xs">Commands</Badge>
                          )}
                          {plugin.hasSkills && (
                            <Badge variant="secondary" className="text-xs">Skills</Badge>
                          )}
                          {plugin.hasAgents && (
                            <Badge variant="secondary" className="text-xs">Agents</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {toggling === `${plugin.name}@${plugin.marketplace}` ? (
                          <SpinnerGap size={16} className="animate-spin" />
                        ) : (
                          <Switch
                            checked={plugin.enabled}
                            onCheckedChange={() => togglePlugin(plugin)}
                            disabled={plugin.blocked}
                          />
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="recommended" className="flex-1">
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recommendedPlugins.map((plugin) => (
                <Card key={plugin.name} className="flex flex-col">
                  <CardHeader className="flex-1">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{plugin.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          by {plugin.author.name}
                        </p>
                      </div>
                      <Badge variant="outline">{plugin.marketplace}</Badge>
                    </div>
                    <CardDescription className="mt-2">
                      {plugin.description}
                    </CardDescription>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {plugin.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button 
                      variant="outline"
                      className="w-full" 
                      onClick={() => installPlugin(plugin.name)}
                      disabled={installing === plugin.name}
                    >
                      {installing === plugin.name ? (
                        <>
                          <SpinnerGap size={16} className="mr-2 animate-spin" />
                          安装中...
                        </>
                      ) : (
                        <>
                          <Plus size={16} className="mr-2" />
                          安装
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <Card className="mt-4">
        <CardHeader className="py-4">
          <CardTitle className="text-sm">如何安装插件？</CardTitle>
          <CardDescription className="text-xs">
            <p className="mb-2">在终端中使用 Claude CLI 安装插件：</p>
            <code className="bg-muted px-2 py-1 rounded text-xs block mb-2">
              claude plugin install &lt;plugin-name&gt;
            </code>
            <p className="mb-2">例如：</p>
            <code className="bg-muted px-2 py-1 rounded text-xs block">
              claude plugin install code-review
            </code>
            <p className="mt-2">
              安装后刷新页面即可在"已安装"标签页中看到。
            </p>
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
