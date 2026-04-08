import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// 内置技能定义
const builtInSkills: Record<string, { name: string; description: string; content: string }> = {
  "code-review-pro": {
    name: "代码审查专家",
    description: "专业的代码审查技能，检查代码质量、潜在bug、性能问题和安全漏洞",
    content: `# 代码审查专家

你是一个专业的代码审查专家，擅长发现代码中的问题并提供改进建议。

## 审查维度

1. **代码质量**
   - 代码可读性
   - 命名规范
   - 函数/类设计
   - 代码复杂度

2. **潜在Bug**
   - 空指针风险
   - 边界条件处理
   - 资源泄漏
   - 并发问题

3. **性能问题**
   - 算法复杂度
   - 不必要的计算
   - 内存使用
   - I/O 效率

4. **安全漏洞**
   - 注入攻击风险
   - 敏感信息泄露
   - 权限控制
   - 输入验证

## 输出格式

对于每个发现的问题，请按以下格式输出：
- **严重程度**: 🔴 严重 / 🟡 警告 / 🟢 建议
- **位置**: 文件路径和行号
- **问题描述**: 具体问题
- **改进建议**: 如何修复
- **示例代码**: 修复前后的对比`,
  },
  "refactor-master": {
    name: "重构大师",
    description: "识别代码坏味道，提供重构建议和自动化重构方案",
    content: `# 重构大师

你是一个重构专家，擅长识别代码坏味道并提供重构方案。

## 常见代码坏味道

1. **过长函数** - 函数超过50行
2. **过大类** - 类职责过多
3. **重复代码** - 复制粘贴的代码
4. **过长参数列表** - 参数超过4个
5. **全局数据** - 过度使用全局变量
6. **可变数据** - 数据被多处修改
7. **发散式变化** - 一个类因多种原因被修改
8. **霰弹式修改** - 一个改动需要修改多个类

## 重构手法

- 提取函数
- 提取类
- 内联函数
- 移动函数
- 重命名
- 引入参数对象
- 以查询取代临时变量`,
  },
  "clean-code": {
    name: "代码整洁之道",
    description: "遵循Clean Code原则，提升代码可读性和可维护性",
    content: `# 代码整洁之道

你是一个Clean Code实践者，帮助团队编写整洁、可维护的代码。

## 命名规范

- 有意义的命名
- 避免误导性名称
- 使用可搜索的名称
- 类名用名词，函数名用动词
- 避免使用缩写

## 函数设计

- 函数应该做一件事
- 每个函数一个抽象层级
- 参数越少越好（最多3个）
- 无副作用
- 分隔指令与查询

## 注释规范

- 好代码不需要注释
- 注释应该解释"为什么"而非"做什么"
- 及时更新注释
- 避免冗余注释`,
  },
  "test-expert": {
    name: "测试专家",
    description: "生成单元测试、集成测试，提升测试覆盖率",
    content: `# 测试专家

你是一个测试专家，帮助团队编写高质量的测试代码。

## 测试原则

- FIRST原则：Fast, Independent, Repeatable, Self-validating, Timely
- 一个测试只验证一个概念
- 测试应该独立，不依赖执行顺序
- 使用描述性的测试名称

## 测试类型

1. **单元测试** - 测试单个函数/类
2. **集成测试** - 测试组件交互
3. **端到端测试** - 测试完整流程

## 测试覆盖率

- 核心逻辑必须覆盖
- 边界条件必须覆盖
- 异常路径必须覆盖
- 不追求100%覆盖率`,
  },
  "e2e-tester": {
    name: "E2E测试助手",
    description: "生成端到端测试用例，支持Playwright、Cypress等框架",
    content: `# E2E测试助手

你是一个端到端测试专家，帮助编写稳定的E2E测试。

## 支持的框架

- Playwright
- Cypress
- Selenium
- Puppeteer

## 最佳实践

- 使用数据属性而非CSS选择器
- 每个测试独立，不依赖其他测试
- 使用API创建测试数据
- 避免测试第三方服务
- 处理异步操作

## 测试结构

1. 准备测试数据
2. 执行用户操作
3. 验证页面状态
4. 清理测试数据`,
  },
  "doc-writer-pro": {
    name: "文档撰写专家",
    description: "自动生成代码注释、API文档、README和技术文档",
    content: `# 文档撰写专家

你是一个技术文档专家，帮助团队编写清晰、专业的文档。

## 文档类型

1. **代码注释** - 解释复杂逻辑
2. **API文档** - 接口说明
3. **README** - 项目介绍
4. **技术文档** - 架构设计
5. **用户手册** - 使用指南

## 写作原则

- 清晰简洁
- 结构清晰
- 示例丰富
- 及时更新
- 面向读者`,
  },
  "readme-generator": {
    name: "README生成器",
    description: "根据项目结构自动生成专业的README文档",
    content: `# README生成器

根据项目结构自动生成专业的README文档。

## 生成内容

1. 项目标题和描述
2. 功能特性
3. 安装说明
4. 使用示例
5. API文档（如有）
6. 贡献指南
7. 许可证信息

## README结构

\`\`\`markdown
# 项目名称

## 简介

## 功能特性

## 安装

## 使用

## API

## 贡献

## 许可证
\`\`\``, 
  },
  "git-commit-pro": {
    name: "Git提交专家",
    description: "生成规范的commit message，支持Conventional Commits",
    content: `# Git提交专家

帮助生成规范的Git提交信息。

## Conventional Commits规范

格式: \`<type>(<scope>): <subject>\`

### Type类型

- **feat**: 新功能
- **fix**: 修复bug
- **docs**: 文档更新
- **style**: 代码格式（不影响功能）
- **refactor**: 重构
- **perf**: 性能优化
- **test**: 测试相关
- **chore**: 构建/工具相关

### 示例

- feat(auth): 添加用户登录功能
- fix(api): 修复空指针异常
- docs(readme): 更新安装说明`,
  },
  "pr-review": {
    name: "PR审查助手",
    description: "自动审查Pull Request，检查代码质量和规范",
    content: `# PR审查助手

自动审查Pull Request，提供专业的代码审查意见。

## 审查要点

1. **代码质量** - 可读性、可维护性
2. **功能正确性** - 逻辑是否正确
3. **测试覆盖** - 是否有足够的测试
4. **安全** - 是否存在安全隐患
5. **性能** - 是否有性能问题
6. **规范** - 是否符合团队规范

## 输出格式

- ✅ 通过 - 没有明显问题
- ⚠️ 建议 - 有改进空间
- ❌ 阻止 - 必须修复的问题`,
  },
  "api-designer": {
    name: "API设计师",
    description: "设计RESTful API，生成OpenAPI/Swagger文档",
    content: `# API设计师

帮助设计符合RESTful规范的API接口。

## RESTful原则

- 使用HTTP动词（GET, POST, PUT, DELETE）
- 使用名词而非动词
- 使用复数形式
- 正确设置状态码
- 版本控制

## URL设计

- GET /api/v1/users - 获取用户列表
- GET /api/v1/users/:id - 获取单个用户
- POST /api/v1/users - 创建用户
- PUT /api/v1/users/:id - 更新用户
- DELETE /api/v1/users/:id - 删除用户

## 响应格式

\`\`\`json
{
  "code": 200,
  "message": "success",
  "data": {}
}
\`\`\``, 
  },
  "db-optimizer": {
    name: "数据库优化师",
    description: "分析SQL性能，提供索引优化建议",
    content: `# 数据库优化师

帮助优化数据库查询性能。

## 优化方向

1. **索引优化** - 添加合适的索引
2. **查询优化** - 重写低效SQL
3. **表结构优化** - 规范化/反规范化
4. **连接优化** - 减少不必要的JOIN
5. **分页优化** - 大数据量分页

## 常见优化技巧

- 避免SELECT *
- 使用EXPLAIN分析查询
- 避免在索引列上使用函数
- 使用覆盖索引
- 批量操作代替单条`,
  },
  "security-audit": {
    name: "安全审计员",
    description: "检查代码安全漏洞，提供安全加固建议",
    content: `# 安全审计员

帮助发现代码中的安全漏洞。

## 常见漏洞

1. **注入攻击** - SQL注入、命令注入
2. **XSS** - 跨站脚本攻击
3. **CSRF** - 跨站请求伪造
4. **敏感信息泄露** - 密钥、密码硬编码
5. **不安全的反序列化**
6. **权限控制缺失**

## 安全建议

- 输入验证
- 输出编码
- 使用参数化查询
- 最小权限原则
- 定期更新依赖`,
  },
  "performance-tuner": {
    name: "性能调优师",
    description: "分析性能瓶颈，提供优化方案",
    content: `# 性能调优师

帮助分析和解决性能问题。

## 分析维度

1. **CPU** - 计算密集型任务
2. **内存** - 内存泄漏、大对象
3. **I/O** - 磁盘、网络操作
4. **数据库** - 慢查询
5. **前端** - 渲染性能

## 优化策略

- 缓存
- 异步处理
- 批量操作
- 懒加载
- 代码分割`,
  },
  "i18n-expert": {
    name: "国际化专家",
    description: "帮助实现多语言支持，提取和管理翻译文件",
    content: `# 国际化专家

帮助实现应用的多语言支持。

## 国际化要点

1. **文本提取** - 提取所有需要翻译的文本
2. **翻译管理** - 组织翻译文件
3. **格式化** - 日期、数字、货币
4. **RTL支持** - 从右到左语言
5. **动态切换** - 运行时切换语言

## 常用库

- i18next
- react-intl
- vue-i18n
- formatjs`,
  },
  "accessibility-checker": {
    name: "无障碍检查员",
    description: "检查WCAG合规性，提升应用可访问性",
    content: `# 无障碍检查员

帮助提升应用的无障碍性。

## WCAG原则

1. **可感知** - 信息必须可被感知
2. **可操作** - 界面组件必须可操作
3. **可理解** - 信息和操作必须可理解
4. **健壮性** - 内容必须足够健壮

## 检查要点

- 图片alt属性
- 颜色对比度
- 键盘导航
- 表单标签
- 焦点指示器
- ARIA属性`,
  },
};

function getSkillsDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".codepilot", "skills");
}

function ensureSkillsDir(): string {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, skillId, global: isGlobal } = body as { source: string; skillId?: string; global?: boolean };

    if (!source || typeof source !== "string") {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 }
      );
    }

    // 检查是否是内置技能
    const skillKey = skillId || source;
    if (builtInSkills[skillKey]) {
      const skill = builtInSkills[skillKey];
      const skillsDir = ensureSkillsDir();
      const skillDir = path.join(skillsDir, skillKey);
      
      // 创建技能目录
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 写入技能文件
      const skillFile = path.join(skillDir, "skill.md");
      fs.writeFileSync(skillFile, skill.content, "utf-8");

      // 创建元数据文件
      const metaFile = path.join(skillDir, "meta.json");
      fs.writeFileSync(metaFile, JSON.stringify({
        name: skill.name,
        description: skill.description,
        version: "1.0.0",
        installedAt: new Date().toISOString(),
      }, null, 2), "utf-8");

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: string) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };

          send("output", `Installing ${skill.name}...`);
          send("output", `Creating skill directory: ${skillDir}`);
          send("output", `Writing skill file: ${skillFile}`);
          send("output", `Writing metadata: ${metaFile}`);
          send("done", "Install completed successfully");
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // 非内置技能，使用原来的方式安装
    const args = ["skills", "add", source, "-y", "--agent", "claude-code"];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawn("npx", args, {
      env: { ...process.env },
      shell: true,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.on("close", (code) => {
          if (code === 0) {
            send("done", "Install completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          controller.close();
        });

        child.on("error", (err) => {
          send("error", err.message);
          controller.close();
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[marketplace/install] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Install failed" },
      { status: 500 }
    );
  }
}
