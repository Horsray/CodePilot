"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MagnifyingGlass, SpinnerGap, Storefront, Lightning, DownloadSimple, CheckCircle, Star } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import { MarketplaceSkillDetail } from "./MarketplaceSkillDetail";
import { cn } from "@/lib/utils";
import type { MarketplaceSkill } from "@/types";

// 推荐的技能列表 - 分类展示
const recommendedSkills = [
  // 代码质量类
  {
    id: "code-review-pro",
    skillId: "code-review-pro",
    name: "代码审查专家",
    description: "专业的代码审查技能，检查代码质量、潜在bug、性能问题和安全漏洞",
    source: "official",
    installs: 15420,
    isInstalled: false,
    category: "quality",
    tags: ["代码审查", "质量", "安全"],
    rating: 4.8,
  },
  {
    id: "refactor-master",
    skillId: "refactor-master",
    name: "重构大师",
    description: "识别代码坏味道，提供重构建议和自动化重构方案",
    source: "official",
    installs: 12350,
    isInstalled: false,
    category: "quality",
    tags: ["重构", "代码质量"],
    rating: 4.7,
  },
  {
    id: "clean-code",
    skillId: "clean-code",
    name: "代码整洁之道",
    description: "遵循Clean Code原则，提升代码可读性和可维护性",
    source: "official",
    installs: 9870,
    isInstalled: false,
    category: "quality",
    tags: ["Clean Code", "规范"],
    rating: 4.6,
  },
  
  // 测试类
  {
    id: "test-expert",
    skillId: "test-expert",
    name: "测试专家",
    description: "生成单元测试、集成测试，提升测试覆盖率",
    source: "official",
    installs: 11200,
    isInstalled: false,
    category: "testing",
    tags: ["测试", "TDD", "覆盖率"],
    rating: 4.8,
  },
  {
    id: "e2e-tester",
    skillId: "e2e-tester",
    name: "E2E测试助手",
    description: "生成端到端测试用例，支持Playwright、Cypress等框架",
    source: "official",
    installs: 7650,
    isInstalled: false,
    category: "testing",
    tags: ["E2E", "自动化测试"],
    rating: 4.5,
  },
  
  // 文档类
  {
    id: "doc-writer-pro",
    skillId: "doc-writer-pro",
    name: "文档撰写专家",
    description: "自动生成代码注释、API文档、README和技术文档",
    source: "official",
    installs: 18900,
    isInstalled: false,
    category: "documentation",
    tags: ["文档", "注释", "API"],
    rating: 4.9,
  },
  {
    id: "readme-generator",
    skillId: "readme-generator",
    name: "README生成器",
    description: "根据项目结构自动生成专业的README文档",
    source: "official",
    installs: 14300,
    isInstalled: false,
    category: "documentation",
    tags: ["README", "文档"],
    rating: 4.7,
  },
  
  // 架构设计类
  {
    id: "system-architect",
    skillId: "system-architect",
    name: "系统架构师",
    description: "设计系统架构、选择技术栈、规划模块划分",
    source: "official",
    installs: 9800,
    isInstalled: false,
    category: "architecture",
    tags: ["架构", "设计", "系统"],
    rating: 4.8,
  },
  {
    id: "ddd-expert",
    skillId: "ddd-expert",
    name: "DDD领域驱动设计",
    description: "应用领域驱动设计原则，构建可维护的业务系统",
    source: "official",
    installs: 6700,
    isInstalled: false,
    category: "architecture",
    tags: ["DDD", "架构", "设计模式"],
    rating: 4.6,
  },
  
  // 性能优化类
  {
    id: "performance-guru",
    skillId: "performance-guru",
    name: "性能优化专家",
    description: "识别性能瓶颈，提供前端和后端性能优化方案",
    source: "official",
    installs: 8900,
    isInstalled: false,
    category: "performance",
    tags: ["性能", "优化", "瓶颈"],
    rating: 4.7,
  },
  {
    id: "database-optimizer",
    skillId: "database-optimizer",
    name: "数据库优化师",
    description: "优化SQL查询、设计索引、提升数据库性能",
    source: "official",
    installs: 7200,
    isInstalled: false,
    category: "performance",
    tags: ["数据库", "SQL", "索引"],
    rating: 4.6,
  },
  
  // 安全类
  {
    id: "security-auditor",
    skillId: "security-auditor",
    name: "安全审计师",
    description: "检查代码安全漏洞、OWASP合规性、依赖安全性",
    source: "official",
    installs: 10500,
    isInstalled: false,
    category: "security",
    tags: ["安全", "审计", "漏洞"],
    rating: 4.8,
  },
  {
    id: "crypto-expert",
    skillId: "crypto-expert",
    name: "加密专家",
    description: "提供加密方案建议、安全密钥管理、数据保护",
    source: "official",
    installs: 5400,
    isInstalled: false,
    category: "security",
    tags: ["加密", "安全", "隐私"],
    rating: 4.5,
  },
  
  // DevOps类
  {
    id: "devops-engineer",
    skillId: "devops-engineer",
    name: "DevOps工程师",
    description: "配置CI/CD流程、Docker容器化、Kubernetes部署",
    source: "official",
    installs: 11800,
    isInstalled: false,
    category: "devops",
    tags: ["DevOps", "CI/CD", "Docker"],
    rating: 4.7,
  },
  {
    id: "git-master",
    skillId: "git-master",
    name: "Git大师",
    description: "高级Git操作、分支策略、冲突解决、提交规范",
    source: "official",
    installs: 15600,
    isInstalled: false,
    category: "devops",
    tags: ["Git", "版本控制"],
    rating: 4.9,
  },
  
  // 前端开发类
  {
    id: "react-expert",
    skillId: "react-expert",
    name: "React专家",
    description: "React最佳实践、Hooks使用、性能优化、状态管理",
    source: "official",
    installs: 22100,
    isInstalled: false,
    category: "frontend",
    tags: ["React", "前端", "Hooks"],
    rating: 4.9,
  },
  {
    id: "vue-master",
    skillId: "vue-master",
    name: "Vue大师",
    description: "Vue3组合式API、Pinia状态管理、性能优化",
    source: "official",
    installs: 16800,
    isInstalled: false,
    category: "frontend",
    tags: ["Vue", "前端", "Pinia"],
    rating: 4.8,
  },
  {
    id: "css-architect",
    skillId: "css-architect",
    name: "CSS架构师",
    description: "CSS架构设计、Tailwind优化、响应式布局、动画效果",
    source: "official",
    installs: 9200,
    isInstalled: false,
    category: "frontend",
    tags: ["CSS", "Tailwind", "样式"],
    rating: 4.6,
  },
  
  // 后端开发类
  {
    id: "api-designer",
    skillId: "api-designer",
    name: "API设计师",
    description: "RESTful API设计、GraphQL Schema设计、API版本管理",
    source: "official",
    installs: 13400,
    isInstalled: false,
    category: "backend",
    tags: ["API", "REST", "GraphQL"],
    rating: 4.7,
  },
  {
    id: "microservices-expert",
    skillId: "microservices-expert",
    name: "微服务专家",
    description: "微服务架构设计、服务拆分、通信模式、治理策略",
    source: "official",
    installs: 8700,
    isInstalled: false,
    category: "backend",
    tags: ["微服务", "架构", "分布式"],
    rating: 4.6,
  },
  
  // AI/ML类
  {
    id: "ai-integrator",
    skillId: "ai-integrator",
    name: "AI集成专家",
    description: "集成AI API、提示工程优化、AI功能设计",
    source: "official",
    installs: 11200,
    isInstalled: false,
    category: "ai",
    tags: ["AI", "LLM", "集成"],
    rating: 4.8,
  },
  {
    id: "prompt-engineer",
    skillId: "prompt-engineer",
    name: "提示工程师",
    description: "优化提示词、设计提示模板、提升AI输出质量",
    source: "official",
    installs: 9800,
    isInstalled: false,
    category: "ai",
    tags: ["提示工程", "AI", "优化"],
    rating: 4.7,
  },
  
  // 调试排错类
  {
    id: "debug-detective",
    skillId: "debug-detective",
    name: "调试侦探",
    description: "系统化调试方法、根因分析、日志分析、错误追踪",
    source: "official",
    installs: 14500,
    isInstalled: false,
    category: "debugging",
    tags: ["调试", "排错", "分析"],
    rating: 4.8,
  },
  {
    id: "error-explainer-pro",
    skillId: "error-explainer-pro",
    name: "错误解释专家",
    description: "解释复杂错误信息、提供解决方案、预防建议",
    source: "official",
    installs: 18900,
    isInstalled: false,
    category: "debugging",
    tags: ["错误", "调试", "学习"],
    rating: 4.9,
  },
];

interface MarketplaceBrowserProps {
  onInstalled: () => void;
}

const categories = [
  { id: "all", name: "全部", icon: Storefront },
  { id: "quality", name: "代码质量", icon: Star },
  { id: "testing", name: "测试", icon: CheckCircle },
  { id: "documentation", name: "文档", icon: Lightning },
  { id: "architecture", name: "架构", icon: Lightning },
  { id: "performance", name: "性能", icon: Lightning },
  { id: "security", name: "安全", icon: Lightning },
  { id: "devops", name: "DevOps", icon: Lightning },
  { id: "frontend", name: "前端", icon: Lightning },
  { id: "backend", name: "后端", icon: Lightning },
  { id: "ai", name: "AI/ML", icon: Lightning },
  { id: "debugging", name: "调试", icon: Lightning },
];

export function MarketplaceBrowser({ onInstalled }: MarketplaceBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceSkill[]>([]);
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // 使用本地推荐数据
  const filteredSkills = useCallback(() => {
    let skills = recommendedSkills;
    
    // 按分类筛选
    if (activeCategory !== "all") {
      skills = skills.filter(s => s.category === activeCategory);
    }
    
    // 按搜索词筛选
    if (search) {
      const searchLower = search.toLowerCase();
      skills = skills.filter(s => 
        s.name.toLowerCase().includes(searchLower) ||
        s.description.toLowerCase().includes(searchLower) ||
        s.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }
    
    return skills;
  }, [activeCategory, search]);

  useEffect(() => {
    setResults(filteredSkills());
  }, [filteredSkills]);

  const handleInstallComplete = useCallback(() => {
    onInstalled();
    // 更新安装状态
    if (selected) {
      setResults(prev => 
        prev.map(s => s.id === selected.id ? { ...s, isInstalled: true } : s)
      );
    }
  }, [onInstalled, selected]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: search + categories + results */}
      <div className="w-72 shrink-0 flex flex-col overflow-hidden pl-4">
        {/* Search */}
        <div className="px-2 pt-4 pb-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="搜索技能..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="px-2 pb-2">
          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={activeCategory === cat.id ? "secondary" : "ghost"}
                size="xs"
                className={cn(
                  "text-[10px] h-6 px-2",
                  activeCategory === cat.id && "bg-accent text-accent-foreground"
                )}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-1">
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Storefront size={32} className="opacity-40" />
                <p className="text-xs">没有找到匹配的技能</p>
              </div>
            ) : (
              results.map((skill) => (
                <MarketplaceSkillCard
                  key={skill.id}
                  skill={skill}
                  selected={selected?.id === skill.id}
                  onSelect={() => setSelected(skill)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="shrink-0 w-px bg-border/50" />

      {/* Right: detail */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selected ? (
          <MarketplaceSkillDetail
            key={selected.id}
            skill={selected}
            onInstallComplete={handleInstallComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Storefront size={48} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">技能市场</p>
              <p className="text-xs">选择一个技能查看详情并安装</p>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {categories.slice(1, 7).map((cat) => (
                <Button
                  key={cat.id}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
